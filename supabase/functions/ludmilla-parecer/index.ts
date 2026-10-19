// supabase/functions/ludmilla-parecer/index.ts
// Lê o parecer de acesso (PDF) e diz se é favorável ou tem pendência.
// Mesmo padrão de chamada do datasheet-extract (documento em base64).
//
// QUEM CHAMA: só o robô (worker da Ludmilla na VPS), com a service role. O
// verify_jwt do Supabase só prova que o JWT é DESTE projeto — a chave publicável
// do front também é, e é pública. Sem a checagem abaixo, qualquer um com essa
// chave chamaria a função em laço e queimaria o crédito da Anthropic.
// verify_jwt está DESLIGADO no config.toml de propósito: o gateway só entende
// JWT e a chave nova (sb_secret_...) não é um. A conferência é toda desta
// função (chamadorEhServico) e vale com qualquer flag de deploy.
// O portão é NEGA-POR-OMISSÃO e por igualdade de string, SEM rede (ver
// chamadorEhServico): sem segredo configurado, nega 100% das chamadas.
//
// "inconclusivo" é caminho NORMAL, não erro: o worker anexa o documento de
// qualquer jeito e só deixa de recomendar etapa. Por isso PDF ilegível, falha
// da IA ou resposta fora do formato voltam como HTTP 200 (com ok:false quando o
// problema foi da IA, para o worker distinguir de um parecer inconclusivo).
//
// titular e endereco alimentam a conferência de segurança do worker (ele
// compara com o cadastro e bloqueia o anexo se o titular divergir): na dúvida,
// null — nunca chute. Nada do conteúdo do PDF (nem titular, nem endereço) vai
// para o log.
//
// EXTRATO DE IA: o gasto entra no extrato do console (ai_usage_log) pelo mesmo
// caminho do Zé, que também roda sem usuário logado: consume_ai_quota_servidor
// reserva a linha (e confere a cota do plano do tenant) e
// update_ai_usage_tokens_servidor grava os tokens REAIS. Se a IA falhar, a
// reserva é desfeita — não existe consumo para registrar. Para isso o chamador
// manda `tenant_id` (a linha do extrato exige tenant); sem ele a função ainda lê
// o parecer, mas o gasto fica FORA do extrato e isso vai para o log.
//
// DOIS MODOS. Sem `concessionaria` no corpo (a EDP, em produção) a função é a de
// sempre: o mesmo prompt e a mesma resposta de seis campos — qualquer mudança
// aqui precisa deixar esse caminho IDÊNTICO. Com `concessionaria: 'enel'` o
// prompt é o da ENEL e a resposta ganha `tipo`, `nt` e `uc` (o que o documento
// é, a Nota Técnica e a instalação a que ele se refere), que o robô usa para
// achar o projeto. Os três campos só existem no modo ENEL: na EDP a chave nem
// aparece, o que o robô lê (`?? null`) como "não achei".
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MODELO_IA = 'claude-sonnet-5'
/** Rótulo no extrato de IA do console. */
const TIPO_NO_EXTRATO = 'ludmilla_parecer'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Os três únicos vereditos do contrato (já normalizados: minúscula, sem acento). */
const VEREDITOS = ['favoravel', 'pendencia', 'inconclusivo']
/**
 * Teto próprio da chamada à IA. Sem ele quem corta é o relógio da plataforma,
 * que MATA o isolate — e aí `desfazerReserva` não roda e a reserva fica no
 * extrato cobrada pela estimativa, por uma chamada que não produziu nada (falha
 * de IA não cobra, regra da casa). 110 s é o mesmo teto do `ze-brain`
 * (TETO_MS), e deixa folga para desfazer a reserva depois de abortar.
 */
const TETO_MS = 110_000
/**
 * Menor `pdf_base64` plausível, em caracteres. O menor PDF válido que existe
 * passa de 280 bytes (≈ 380 em base64); 256 caracteres são ≈ 192 bytes, ou
 * seja, abaixo de qualquer PDF real e acima de lixo tipo "abc".
 */
const MIN_PDF_B64 = 256

/** Tipos do documento no modo ENEL (lista branca). */
const TIPOS_ENEL = ['carta_projeto', 'resultado_vistoria', 'troca_relogio', 'outro']
/** A NT da ENEL tem 9 dígitos (nota de serviço tem 12, protocolo de contato 10). */
const MIN_DIGITOS_NT = 9
/**
 * A instalação (UC) vale 7 dígitos ou mais: o cadastro guarda `0088101266`, mas o
 * documento traz `88101266` (8 dígitos) — sem os zeros. Com o mínimo de 9 da NT,
 * metade das UCs reais seria descartada.
 */
const MIN_DIGITOS_UC = 7
/** No modo ENEL, quando nada foi lido (falha ou "inconclusivo"): os três vão null. */
const SEM_DOCUMENTO_ENEL = { tipo: null, nt: null, uc: null }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/**
 * Resposta de "não deu para concluir" — mesmo formato do caminho feliz.
 * `extra` são os campos do modo ENEL; vazio na EDP, que segue com seis campos.
 */
const inconclusivo = (resumo: string, extra: Record<string, unknown> = {}) => json({
  ok: true, veredito: 'inconclusivo', resumo, pendencias: [], titular: null, endereco: null, ...extra,
})

/** A IA (ou a cota) não pôde ler: ok:false + o formato completo do contrato. */
const falhaDaIA = (error: string, extra: Record<string, unknown> = {}) => json({
  ok: false, error, veredito: 'inconclusivo', resumo: '', pendencias: [], titular: null, endereco: null, ...extra,
})

/** minúsculas, sem acento, sem espaço nas pontas: 'Favorável ' → 'favoravel'. */
const normalizar = (valor: unknown): string =>
  String(valor ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()

/**
 * Frases de formato do PRÓPRIO prompt. A IA às vezes copia a linha de formato em
 * vez de preencher ("titular":"nome do titular ou null"). Isso passaria como
 * titular LIDO, o worker compararia com o cadastro, veria divergência e
 * BLOQUEARIA o anexo — o único bloqueio do fluxo, disparado por engano.
 * Ao mexer no prompt, reveja esta lista.
 */
const ECO_DO_PROMPT = [
  /\bou null\b/,                      // "nome do titular ou null", "logradouro e número ou null"
  /^nome do titular\b/,
  /^logradouro e numero\b/,           // já normalizado (sem acento)
  /^uma frase em portugues\b/,
  /favoravel\|pendencia\|inconclusivo/,
  /^\.{2,}$/,                         // o "..." do exemplo de pendências
]

/**
 * SÓ no modo ENEL (a EDP não ganha este filtro): os exemplos que a regra do titular
 * do PROMPT_ENEL ensina — `reescreva como "NOME SOBRENOME"`, `"SOBRENOME, NOME"`.
 * Se a IA copiar o exemplo em vez de preencher, o placeholder passaria como titular
 * LIDO e o worker BLOQUEARIA o anexo por divergir do cadastro — o único bloqueio do
 * fluxo, disparado por um texto que não é nome de ninguém. Já normalizados (sem
 * acento, minúsculos); aceitam aspas e pontuação nas pontas.
 * Ao mexer nas regras do PROMPT_ENEL, reveja esta lista.
 */
const ECO_DO_PROMPT_ENEL = [
  /^\W*nome\s+sobrenome\W*$/,
  /^\W*sobrenome\s*,?\s*nome\W*$/,
]
const ecoDoPromptEnel = (titular: string): boolean =>
  ECO_DO_PROMPT_ENEL.some((re) => re.test(normalizar(titular)))

/**
 * O tipo do documento no modo ENEL: normaliza e confere na lista branca; o que não
 * for texto, ou não estiver nela (inclusive o eco do formato), é 'outro'.
 * Só é chamada no modo ENEL — na EDP o `tipo` da IA nem é lido.
 */
const tipoEnel = (v: unknown): string => {
  const t = typeof v === 'string' ? normalizar(v) : ''
  return TIPOS_ENEL.includes(t) ? t : 'outro'
}

/**
 * Marcadores de "não achei" que a IA devolve em vez de um valor. Já normalizados
 * (minúsculas, sem acento).
 */
const MARCADORES_DE_AUSENCIA = [
  'null', 'none', 'n/a', 'undefined', 'nao informado', 'desconhecido',
  'nao consta', 'nao identificado', 'nao localizado', 'a definir', 'ilegivel',
]
const alternativas = MARCADORES_DE_AUSENCIA.map((m) => m.replace('/', '\\/')).join('|')
/** O texto INTEIRO é um marcador. */
const SO_O_MARCADOR = new RegExp(`^(${alternativas})$`)
/**
 * O marcador aparece na frase, como palavra inteira: "Não consta.", "Não
 * identificado no documento", "Titular não identificado", "(não consta)".
 * Palavra inteira (nada de letra ou dígito colado) para "Nonato" não casar "none".
 *
 * Errar para o lado de casar demais é seguro: titular tratado como "não achei"
 * só faz a conferência cair para o protocolo. O que bloqueia o anexo é o oposto —
 * um texto que não é nome de ninguém passando como titular LIDO.
 */
const COM_O_MARCADOR = new RegExp(`(^|[^a-z0-9])(${alternativas})([^a-z0-9]|$)`)

/**
 * A IA às vezes devolve a PALAVRA "null" (o prompt diz "ou null") em vez do
 * valor JSON null. Se isso passasse, o worker compararia o titular "null" com o
 * cadastro e bloquearia o anexo à toa — ou pior, trataria como dado lido.
 * Só string conta; número, booleano e objeto viram null (não são dado lido).
 *
 * `marcadorEmFrase` escolhe como o "não achei" é reconhecido:
 *  · true  (titular, endereço) — o marcador em QUALQUER ponto da frase, como
 *    palavra inteira. Antes era igualdade exata, e "Não consta." (com ponto) ou
 *    "Não identificado no documento" passavam: duas palavras são "comparáveis" e
 *    o parecer certo era BLOQUEADO por divergir de um "titular" que ninguém escreveu;
 *  · false (resumo) — igualdade exata, como sempre. O resumo vai para a tela, e
 *    "Não consta restrição; conexão aprovada." é um resumo legítimo que
 *    casar por frase jogaria fora.
 */
const textoOuNulo = (valor: unknown, limite: number, marcadorEmFrase = false): string | null => {
  if (typeof valor !== 'string') return null
  const t = valor.trim()
  if (t.length < 3) return null
  const n = normalizar(t)
  // Passariam como titular LIDO, a conferência veria divergência e o anexo seria
  // BLOQUEADO — o único bloqueio do fluxo, disparado por um texto que não é nome.
  if ((marcadorEmFrase ? COM_O_MARCADOR : SO_O_MARCADOR).test(n)) return null
  if (ECO_DO_PROMPT.some((re) => re.test(n))) return null
  return t.slice(0, limite)
}

/**
 * Número do documento (NT, instalação): só os dígitos, sem zeros à esquerda, com
 * pelo menos `minimo` deles. Eco do prompt ("número da Nota Técnica ou null"), texto
 * sem número e número curto demais viram null — um número que não é o do documento
 * nunca pode passar como lido, porque o robô o procura entre os projetos. Só texto
 * conta; número JSON, booleano e objeto não são dado lido.
 */
const numeroOuNulo = (v: unknown, minimo: number): string | null => {
  if (typeof v !== 'string') return null
  const d = v.replace(/\D/g, '').replace(/^0+/, '')
  return d.length >= minimo ? d : null
}

/**
 * O prompt do modo ENEL. Ao mexer nele, reveja ECO_DO_PROMPT: a IA às vezes copia
 * a linha de formato em vez de preencher. (O tipo copiado cai em 'outro' pela lista
 * branca e o nt/uc copiados não têm dígitos, então só o titular, o endereço e o
 * resumo dependem daquela lista.)
 */
const PROMPT_ENEL = [
  'Você lê um documento da ENEL Distribuição São Paulo sobre um projeto de micro ou minigeração distribuída (energia solar).',
  'Responda SOMENTE com um objeto JSON, sem texto antes ou depois, neste formato:',
  '{"tipo":"carta_projeto|resultado_vistoria|troca_relogio|outro","veredito":"favoravel|pendencia|inconclusivo","resumo":"uma frase em português","pendencias":["..."],"titular":"nome do titular ou null","endereco":"logradouro e número ou null","nt":"número da Nota Técnica ou null","uc":"número da instalação ou null"}',
  'Regras:',
  '- "carta_projeto": carta de resposta ao projeto (aprovação, reprovação ou exigências).',
  '- "resultado_vistoria": resultado da vistoria (relatório fotográfico ou vídeo de anti-ilhamento).',
  '- "troca_relogio": troca do medidor (relógio).',
  '- "favoravel": aprovado, inclusive "aprovado, porém solicitamos observar os itens abaixo" — nesse caso liste os itens em "pendencias". "pendencia": reprovado ou com exigência que precisa ser cumprida ANTES da aprovação. "inconclusivo": não dá para dizer.',
  '- "titular": o nome completo do titular na ordem natural (prenome primeiro, sobrenome no fim), sem vírgula. Se o documento trouxer "SOBRENOME, NOME", reescreva como "NOME SOBRENOME".',
  '- "nt": o número da Nota Técnica (NT) do projeto, só dígitos. NÃO confunda com protocolo de atendimento, nota de serviço ou número SF.',
  '- "uc": o número da instalação (unidade consumidora), só dígitos.',
  '- Use null quando o documento não trouxer a informação. Não invente.',
].join('\n')

/**
 * O último objeto JSON BALANCEADO do texto.
 * `match(/\{[\s\S]*\}/)` era guloso: num prefixo com chave ("Formato {ver
 * abaixo}: {...}") capturava os dois blocos juntos, o JSON.parse falhava e um
 * parecer que a IA leu certo voltava 'inconclusivo'. Anda de trás para a frente
 * a partir do último `}` até fechar o nível — não é um parser, é um recorte.
 */
const ultimoObjetoJson = (texto: string): string | null => {
  const fim = texto.lastIndexOf('}')
  if (fim < 0) return null
  let nivel = 0
  for (let i = fim; i >= 0; i--) {
    if (texto[i] === '}') nivel++
    else if (texto[i] === '{' && --nivel === 0) return texto.slice(i, fim + 1)
  }
  return null
}

/**
 * O chamador é o robô? Igualdade de string, NEGA POR OMISSÃO, SEM REDE.
 *
 * Mesmo princípio do sync-library (compara com SUPABASE_SERVICE_ROLE_KEY) e do
 * ze-webhook (segredo ausente nega, nunca "passa por vazio").
 *
 * NÃO sonda mais o Auth. A versão anterior aceitava o token quando a rota de
 * admin do GoTrue devolvia 404 — que é também a resposta de "esta rota não
 * existe". Era fail-open por desenho: se o GoTrue renomear
 * `/auth/v1/admin/users/{id}`, ou se SUPABASE_URL passar a apontar para um proxy
 * que só serve /rest e /functions, a sonda devolve 404 para QUALQUER token não
 * vazio — e aí a chave publicável (que está no bundle do front, pública) entra,
 * e volta o laço queimando crédito da Anthropic, sem nada no código notar. A
 * sonda também custava 1–2 chamadas ao Auth por invocação: com tráfego forjado a
 * 50 req/s o Auth limita por taxa (429) e a sonda do worker LEGÍTIMO é negada
 * junto, parando a leitura de pareceres enquanto durar.
 *
 * Por que DUAS variáveis: no ambiente das functions, SUPABASE_SERVICE_ROLE_KEY
 * guarda a chave NOVA (`sb_secret_...`), enquanto o worker pode estar mandando o
 * JWT legado de service role. Comparar só com ela trancou o worker para fora na
 * primeira versão. LUDMILLA_WORKER_KEY existe para esse caso — é configurada à
 * mão com o valor que o worker usa. Sem nenhuma das duas definidas, a função
 * nega 100% das chamadas: barulhento no primeiro run, nunca aberto no silêncio.
 *
 * Comparação: string inteira, sem startsWith, sem prefixo, sem normalizar, e
 * sem ler `role` de dentro do JWT (sem conferir assinatura, qualquer um forja).
 * `undefined`/`''` é "não configurado" e nunca casa com nada.
 */
function chamadorEhServico(token: string, aceitos: string[]): boolean {
  if (!token) return false
  return aceitos.some((aceito) => aceito === token)
}

/**
 * Os segredos aceitos, já sem os não configurados (undefined/vazio).
 *
 * O `trim()` não é enfeite: o token do chamador é trimado na leitura do
 * cabeçalho, e um segredo gravado com `\n` no fim (um `echo` no workflow de
 * deploy basta) nunca casaria — toda leitura de parecer tomaria 401 PARA SEMPRE,
 * com a mesma frase de "segredo não configurado", que é justamente a que o
 * portão se esforça para não distinguir. Falha fechada, mas indiagnosticável.
 */
function segredosAceitos(): string[] {
  return [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('LUDMILLA_WORKER_KEY')]
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Quem chama: só a service role ─────────────────────────────────────────
  const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  // A chave nova (sb_secret_...) viaja no cabeçalho `apikey` (como o signup-tenant
  // faz); o JWT legado, no Authorization. Vale qualquer um dos dois.
  const doBearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const doApikey = (req.headers.get('apikey') ?? '').trim()
  const aceitos = segredosAceitos()
  const ehServico = chamadorEhServico(doBearer, aceitos) || chamadorEhServico(doApikey, aceitos)
  // A negação é SEMPRE esta, igual para token ausente, vazio, errado ou segredo
  // não configurado: quem sonda não aprende qual condição falhou.
  if (!ehServico) {
    return json({ ok: false, error: 'Não autorizado: esta função só aceita chamadas do robô (service role).' }, 401)
  }

  if (!chaveServico) return json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' }, 500)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }, 500)

  let body: {
    pdf_base64?: unknown; nome_arquivo?: string; protocolo?: string; tenant_id?: string; concessionaria?: string
  } | null
  try { body = await req.json() } catch { return json({ ok: false, error: 'corpo inválido' }, 400) }
  // O único desvio entre os modos: só o valor exato 'enel' liga o modo ENEL. Qualquer
  // outra coisa (ausente, 'edp', 'ENEL') é a EDP de sempre.
  const modoEnel = body?.concessionaria === 'enel'
  /** Os campos que o modo ENEL acrescenta quando nada foi lido; na EDP, nenhum. */
  const semLeitura = modoEnel ? SEM_DOCUMENTO_ENEL : {}
  // Tipo E tamanho, ANTES da reserva no extrato. Um `pdf_base64` numérico ia
  // para a API como `data: 12345`, tomava 400 e a mensagem "IA respondeu 400"
  // fazia quem lê o log concluir "a IA está fora" — e sobrava uma linha de
  // reserva à toa. Agora nem reserva.
  // Limpa o VALOR, não só a conferência: `base64 parecer.pdf` quebra a linha a
  // cada 76 colunas E deixa `\n` no fim. Validar o limpo e mandar o cru fazia a
  // Anthropic recusar o base64 e o log dizer "IA respondeu 400" — exatamente o
  // diagnóstico mentiroso que esta checagem existe para matar. `trim()` não
  // bastava: tirava as pontas e deixava as quebras do meio. O alfabeto do base64
  // não tem espaço em branco, então remover tudo nunca estraga dado bom.
  const pdfBase64 = typeof body?.pdf_base64 === 'string'
    ? body.pdf_base64.replace(/\s+/g, '')
    : body?.pdf_base64
  if (typeof pdfBase64 !== 'string' || pdfBase64.length < MIN_PDF_B64) {
    return json({
      ok: false,
      error: 'pdf_base64 é obrigatório e precisa ser uma string com o PDF em base64',
    }, 400)
  }

  const tenantId = body?.tenant_id ? String(body.tenant_id) : null
  if (tenantId && !UUID.test(tenantId)) return json({ ok: false, error: 'tenant_id inválido' }, 400)

  // ── Extrato de IA: reserva a linha ANTES de gastar (e confere a cota) ─────
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveServico, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  let logId: string | null = null
  if (tenantId) {
    const { data: cota, error: erroCota } = await admin.rpc('consume_ai_quota_servidor', {
      _tenant: tenantId, _kind: TIPO_NO_EXTRATO, _user: null,
    })
    if (erroCota || !cota) {
      console.error('consume_ai_quota_servidor:', erroCota?.code ?? 'sem retorno')
      return falhaDaIA('não foi possível verificar a cota de IA', semLeitura)
    }
    if (cota.allowed === false) return falhaDaIA(`cota de IA indisponível (${cota.reason})`, semLeitura)
    logId = cota.log_id ?? null
  } else {
    console.error('tenant_id ausente: o consumo desta leitura NÃO entra no extrato de IA')
  }

  /** IA não respondeu → não houve consumo → a reserva não pode ficar de lixo no
   *  extrato. Só apaga linha SEM tokens (nunca um lançamento real). */
  const desfazerReserva = async () => {
    if (!logId || !tenantId) return
    const { error } = await admin.from('ai_usage_log').delete()
      .eq('id', logId).eq('tenant_id', tenantId).is('input_tokens', null)
    if (error) console.error('reserva do extrato não desfeita:', error.code)
  }

  // O prompt da EDP é o de sempre, palavra por palavra (há teste que o trava).
  const promptEdp = [
    'Você está lendo um PARECER DE ACESSO da distribuidora EDP para um projeto de geração distribuída.',
    `Protocolo/nota esperado: ${body?.protocolo ?? '(não informado)'}.`,
    '',
    'Responda SOMENTE com um JSON, sem texto em volta, neste formato:',
    '{"veredito":"favoravel|pendencia|inconclusivo","resumo":"uma frase em português",',
    ' "pendencias":["..."],"titular":"nome do titular ou null","endereco":"logradouro e número ou null"}',
    '',
    '- "favoravel": o parecer aprova a conexão (ainda que com condições técnicas normais).',
    '- "pendencia": o parecer pede correção, complementação ou indefere.',
    '- "inconclusivo": não dá para afirmar pelo documento.',
  ].join('\n')
  const prompt = modoEnel ? PROMPT_ENEL : promptEdp

  // Prazo PRÓPRIO da chamada (ver TETO_MS): abortar aqui cai no mesmo catch que
  // desfaz a reserva, enquanto o relógio da plataforma mataria o isolate antes.
  const prazo = new AbortController()
  const alarme = setTimeout(() => prazo.abort(), TETO_MS)
  let resposta: Response
  try {
    resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: prazo.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO_IA,
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
  } catch (e) {
    // rede caiu (ou o prazo estourou): não derruba o worker com 500
    const estourou = e instanceof Error && e.name === 'AbortError'
    console.error('Falha ao chamar a IA:', e instanceof Error ? e.name : 'erro')
    await desfazerReserva()
    return falhaDaIA(estourou ? 'tempo esgotado ao chamar a IA' : 'falha ao chamar a IA', semLeitura)
  } finally {
    // A resposta é inteira (não é stream): quando os cabeçalhos chegam, a IA já
    // terminou de gerar. Daqui para frente só falta ler o corpo, que é rápido —
    // e um abort ali cairia no caminho do "200 ilegível", que cobra de propósito.
    clearTimeout(alarme)
  }

  if (!resposta.ok) {
    // só o status vai para o log — o corpo do erro pode ecoar trecho do documento
    console.error('IA respondeu', resposta.status)
    await desfazerReserva()
    return falhaDaIA(`IA respondeu ${resposta.status}`, semLeitura)
  }

  let data: {
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
    content?: { type: string; text?: string }[]
  }
  try {
    data = await resposta.json()
  } catch {
    // a IA respondeu 200 (e cobrou), só não dá para ler: a linha do extrato fica
    // e ele estima — melhor que sumir com um gasto que provavelmente existiu
    console.error('Resposta da IA não era JSON')
    return falhaDaIA('falha ao ler a resposta da IA', semLeitura)
  }

  // Tokens REAIS no extrato — também quando a resposta não serve (cortada,
  // recusada, fora do formato): o gasto aconteceu.
  if (logId && tenantId && typeof data.usage?.input_tokens === 'number' && typeof data.usage?.output_tokens === 'number') {
    const { data: gravou, error: erroTokens } = await admin.rpc('update_ai_usage_tokens_servidor', {
      _log_id: logId, _tenant: tenantId, _model: MODELO_IA,
      _input_tokens: data.usage.input_tokens, _output_tokens: data.usage.output_tokens,
    })
    if (erroTokens || gravou !== true) console.error('tokens não lançados no extrato:', erroTokens?.code ?? gravou)
  }
  if (data.stop_reason === 'max_tokens') console.error('Resposta cortada por max_tokens', data.usage)

  const texto = (data.content ?? []).filter((c) => c.type === 'text')
    .map((c) => c.text ?? '').join('')
  const bruto = ultimoObjetoJson(texto)
  if (!bruto) return inconclusivo('não consegui ler o parecer', semLeitura)

  try {
    const r = JSON.parse(bruto)
    // Normaliza ANTES da lista branca: "favorável" (com acento, saída plausível
    // em português) e "Favoravel " cairiam em 'inconclusivo', o worker não
    // recomendaria etapa e o valor da entrega sumia no silêncio. O valor
    // DEVOLVIDO segue sendo o canônico sem acento.
    const pedido = normalizar(r.veredito)
    const veredito = VEREDITOS.includes(pedido) ? pedido : 'inconclusivo'
    // Só no modo ENEL, e SÓ DENTRO deste ramo: na EDP o `tipo` da IA não é nem lido
    // (um valor esquisito, como um objeto, faria o String() lançar e a EDP, que lia
    // o parecer, passaria a responder 'inconclusivo'). Mesma regra do veredito:
    // normaliza e confere na lista branca. Na EDP o objeto fica vazio e a resposta
    // é a de seis campos de sempre.
    const doDocumento = modoEnel
      ? {
        tipo: tipoEnel(r.tipo),
        nt: numeroOuNulo(r.nt, MIN_DIGITOS_NT),
        uc: numeroOuNulo(r.uc, MIN_DIGITOS_UC),
      }
      : {}
    const titular = textoOuNulo(r.titular, 150, true)
    return json({
      ok: true, veredito,
      // Pelo mesmo filtro do titular: o resumo também vem, às vezes, como eco da
      // linha de formato ("uma frase em português"), e esse texto vai PARA A TELA
      // do cartão. Dizer que não houve resumo é mais honesto que mostrar o eco.
      resumo: textoOuNulo(r.resumo, 500) ?? 'a IA não resumiu o parecer',
      pendencias: Array.isArray(r.pendencias) ? r.pendencias.map(String).slice(0, 10) : [],
      // No modo ENEL, o exemplo do prompt ("NOME SOBRENOME") copiado não é titular.
      titular: modoEnel && titular !== null && ecoDoPromptEnel(titular) ? null : titular,
      endereco: textoOuNulo(r.endereco, 200, true),
      ...doDocumento,
    })
  } catch {
    // não loga o erro: a mensagem do JSON.parse cita trecho do texto lido
    return inconclusivo('resposta da IA fora do formato', semLeitura)
  }
})

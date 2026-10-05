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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MODELO_IA = 'claude-sonnet-5'
/** Rótulo no extrato de IA do console. */
const TIPO_NO_EXTRATO = 'ludmilla_parecer'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Resposta de "não deu para concluir" — mesmo formato do caminho feliz. */
const inconclusivo = (resumo: string) => json({
  ok: true, veredito: 'inconclusivo', resumo, pendencias: [], titular: null, endereco: null,
})

/** A IA (ou a cota) não pôde ler: ok:false + o formato completo do contrato. */
const falhaDaIA = (error: string) => json({
  ok: false, error, veredito: 'inconclusivo', resumo: '', pendencias: [], titular: null, endereco: null,
})

/**
 * A IA às vezes devolve a PALAVRA "null" (o prompt diz "ou null") em vez do
 * valor JSON null. Se isso passasse, o worker compararia o titular "null" com o
 * cadastro e bloquearia o anexo à toa — ou pior, trataria como dado lido.
 */
const textoOuNulo = (valor: unknown, limite: number): string | null => {
  if (valor == null || typeof valor === 'object') return null
  const t = String(valor).trim()
  if (!t || /^(null|none|n\/a|undefined|nao informado|não informado|desconhecido)$/i.test(t)) return null
  return t.slice(0, limite)
}

/**
 * O chamador é a service role?
 *
 * Mesmo princípio do sync-library (compara com SUPABASE_SERVICE_ROLE_KEY) e do
 * ze-webhook (segredo ausente nega, nunca "passa por vazio"), com um acréscimo
 * que a realidade pediu: neste projeto a variável SUPABASE_SERVICE_ROLE_KEY da
 * função guarda a chave NOVA (`sb_secret_...`), e não o JWT legado de service
 * role — que é o que o worker pode estar usando. Só comparar com a variável
 * trancaria o worker para fora sem aviso.
 *
 * O JWT legado NÃO é aceito pelo conteúdo (decodificar `role` sem conferir a
 * assinatura qualquer um forja, e o deploy desta casa costuma ser
 * --no-verify-jwt). Quem confirma é o próprio Auth: pedir um usuário
 * inexistente na rota de ADMIN dá 404 só para a service role (anon e usuário
 * comum levam 403, sem credencial 401), e não devolve dado nenhum. A listagem de
 * usuários não serve de sonda: dá 500 neste projeto mesmo para a service role.
 */
async function chamadorEhServico(token: string, chaveServico: string | undefined): Promise<boolean> {
  if (!token) return false
  if (chaveServico && token === chaveServico) return true
  try {
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/admin/users/00000000-0000-0000-0000-000000000000`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    })
    await r.body?.cancel()
    return r.status === 404
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Quem chama: só a service role ─────────────────────────────────────────
  const chaveServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  // A chave nova (sb_secret_...) viaja no cabeçalho `apikey` (como o signup-tenant
  // faz); o JWT legado, no Authorization. Vale qualquer um dos dois.
  const doBearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const doApikey = (req.headers.get('apikey') ?? '').trim()
  const ehServico = (await chamadorEhServico(doBearer, chaveServico))
    || (doApikey !== doBearer && await chamadorEhServico(doApikey, chaveServico))
  if (!ehServico) {
    return json({ ok: false, error: 'Não autorizado: esta função só aceita chamadas do robô (service role).' }, 401)
  }

  if (!chaveServico) return json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' }, 500)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }, 500)

  let body: { pdf_base64?: string; nome_arquivo?: string; protocolo?: string; tenant_id?: string } | null
  try { body = await req.json() } catch { return json({ ok: false, error: 'corpo inválido' }, 400) }
  if (!body?.pdf_base64) return json({ ok: false, error: 'pdf_base64 é obrigatório' }, 400)

  const tenantId = body.tenant_id ? String(body.tenant_id) : null
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
      return falhaDaIA('não foi possível verificar a cota de IA')
    }
    if (cota.allowed === false) return falhaDaIA(`cota de IA indisponível (${cota.reason})`)
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

  const prompt = [
    'Você está lendo um PARECER DE ACESSO da distribuidora EDP para um projeto de geração distribuída.',
    `Protocolo/nota esperado: ${body.protocolo ?? '(não informado)'}.`,
    '',
    'Responda SOMENTE com um JSON, sem texto em volta, neste formato:',
    '{"veredito":"favoravel|pendencia|inconclusivo","resumo":"uma frase em português",',
    ' "pendencias":["..."],"titular":"nome do titular ou null","endereco":"logradouro e número ou null"}',
    '',
    '- "favoravel": o parecer aprova a conexão (ainda que com condições técnicas normais).',
    '- "pendencia": o parecer pede correção, complementação ou indefere.',
    '- "inconclusivo": não dá para afirmar pelo documento.',
  ].join('\n')

  let resposta: Response
  try {
    resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO_IA,
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.pdf_base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
  } catch (e) {
    // rede caiu: não derruba o worker com 500
    console.error('Falha ao chamar a IA:', e instanceof Error ? e.name : 'erro')
    await desfazerReserva()
    return falhaDaIA('falha ao chamar a IA')
  }

  if (!resposta.ok) {
    // só o status vai para o log — o corpo do erro pode ecoar trecho do documento
    console.error('IA respondeu', resposta.status)
    await desfazerReserva()
    return falhaDaIA(`IA respondeu ${resposta.status}`)
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
    return falhaDaIA('falha ao ler a resposta da IA')
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
  const bruto = texto.match(/\{[\s\S]*\}/)?.[0]
  if (!bruto) return inconclusivo('não consegui ler o parecer')

  try {
    const r = JSON.parse(bruto)
    const veredito = ['favoravel', 'pendencia', 'inconclusivo'].includes(r.veredito) ? r.veredito : 'inconclusivo'
    return json({
      ok: true, veredito,
      resumo: String(r.resumo ?? '').slice(0, 500),
      pendencias: Array.isArray(r.pendencias) ? r.pendencias.map(String).slice(0, 10) : [],
      titular: textoOuNulo(r.titular, 150),
      endereco: textoOuNulo(r.endereco, 200),
    })
  } catch {
    // não loga o erro: a mensagem do JSON.parse cita trecho do texto lido
    return inconclusivo('resposta da IA fora do formato')
  }
})

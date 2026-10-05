// supabase/functions/ludmilla-parecer/index.ts
// Lê o parecer de acesso (PDF) e diz se é favorável ou tem pendência.
// Mesmo padrão de chamada do datasheet-extract (documento em base64).
//
// "inconclusivo" é caminho NORMAL, não erro: o worker anexa o documento de
// qualquer jeito e só deixa de recomendar etapa. Por isso PDF ilegível, falha
// da IA ou resposta fora do formato voltam como HTTP 200.
//
// titular e endereco alimentam a conferência de segurança do worker (ele
// compara com o cadastro e bloqueia o anexo se o titular divergir): na dúvida,
// null — nunca chute. Nada do conteúdo do PDF (nem titular, nem endereço) vai
// para o log.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MODELO_IA = 'claude-sonnet-5'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Resposta de "não deu para concluir" — mesmo formato do caminho feliz. */
const inconclusivo = (resumo: string, extra: Record<string, unknown> = {}) => json({
  ok: true, veredito: 'inconclusivo', resumo, pendencias: [], titular: null, endereco: null, ...extra,
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }, 500)

  let body: { pdf_base64?: string; nome_arquivo?: string; protocolo?: string } | null
  try { body = await req.json() } catch { return json({ ok: false, error: 'corpo inválido' }, 400) }
  if (!body?.pdf_base64) return json({ ok: false, error: 'pdf_base64 é obrigatório' }, 400)

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

  let data: { stop_reason?: string; usage?: unknown; content?: { type: string; text?: string }[] }
  try {
    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
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

    if (!resposta.ok) {
      // só o status vai para o log — o corpo do erro pode ecoar trecho do documento
      console.error('IA respondeu', resposta.status)
      return json({
        ok: false, error: `IA respondeu ${resposta.status}`, veredito: 'inconclusivo',
        resumo: '', pendencias: [], titular: null, endereco: null,
      }, 200)
    }
    data = await resposta.json()
  } catch (e) {
    // rede caiu ou resposta não era JSON: não derruba o worker com 500
    console.error('Falha ao chamar a IA:', e instanceof Error ? e.name : 'erro')
    return json({
      ok: false, error: 'falha ao chamar a IA', veredito: 'inconclusivo',
      resumo: '', pendencias: [], titular: null, endereco: null,
    }, 200)
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

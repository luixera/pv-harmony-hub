import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * ENGENHEIRO BIDU — o projetista automático da casa.
 *
 * Esta função é a conversa com ele. Duas coisas acontecem aqui:
 *
 *  1. Ele RESPONDE, sabendo do projeto aberto e das habilidades que já lhe
 *     ensinaram (tabela `bidu_skills` — o "treinamento" vive no banco, nunca
 *     fixo em código, mesmo princípio do Motor de Engenharia).
 *
 *  2. Ele APRENDE. Quando a mensagem é uma instrução ("daqui em diante,
 *     na CEMIG, faça X"), ele devolve a habilidade em forma estruturada e o
 *     front a grava. É o "mando lá e ele aprende" que o usuário pediu.
 *
 * Deployada com --no-verify-jwt: a checagem do header Authorization é feita
 * aqui, como nas demais funções do projeto.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODELO_IA = 'claude-opus-4-8'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

interface Corpo {
  mensagem: string
  projectId?: string | null
  /** Últimas trocas, para ele não perder o fio da conversa. */
  historico?: { autor: 'user' | 'bidu'; conteudo: string }[]
}

function promptDoSistema(habilidades: { titulo: string; instrucao: string }[], projeto: string | null): string {
  const treinamento = habilidades.length === 0
    ? 'Ainda não te ensinaram nenhuma habilidade específica.'
    : habilidades.map((h, i) => `${i + 1}. ${h.titulo}\n   ${h.instrucao}`).join('\n')

  return `Você é o Engenheiro Bidu, projetista da GD Manager Energy — uma empresa que
homologa projetos de geração distribuída fotovoltaica junto às concessionárias.

Você é responsável pelos projetos mais peculiares, especialmente os da CEMIG.
Fala português do Brasil, de forma direta e técnica, como um engenheiro
experiente falando com um colega. Sem formalidade excessiva e sem enrolação.

O QUE VOCÊ JÁ SABE (habilidades que te ensinaram):
${treinamento}

${projeto ? `PROJETO ABERTO AGORA:\n${projeto}` : 'Nenhum projeto aberto no momento — a conversa é geral.'}

REGRAS DE CONDUTA, e elas importam:
- Se não souber, diga que não sabe. Nunca invente número de projeto: disjuntor,
  bitola, corrente e tensão errados viram risco real na obra.
- Quando a pergunta depender de um dado que você não tem, peça o dado.
- Não repita de volta a pergunta do usuário; responda.

QUANDO A MENSAGEM FOR UM ENSINAMENTO:
Se a mensagem estabelece uma regra, um procedimento ou uma preferência para o
futuro ("sempre que...", "na CEMIG faça...", "daqui pra frente..."), você deve
registrá-la como habilidade. Responda confirmando com suas palavras o que
entendeu — para o usuário poder corrigir se você entendeu errado.

Responda SEMPRE em JSON puro, sem cercas de código, neste formato:
{
  "resposta": "sua resposta em português",
  "habilidade": { "titulo": "resumo curto", "instrucao": "a regra completa" } | null
}
"habilidade" só vem preenchida quando a mensagem for de fato um ensinamento.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ ok: false, error: 'sem autorização' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: auth } } },
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ ok: false, error: 'sessão inválida' }, 401)

    const body = await req.json() as Corpo
    if (!body?.mensagem?.trim()) return json({ ok: false, error: 'mensagem vazia' }, 400)

    // O RLS já limita ao tenant de quem chamou.
    const { data: habilidades } = await supabase
      .from('bidu_skills').select('titulo, instrucao').eq('enabled', true)

    // Contexto do projeto, quando a conversa é dentro de um.
    let projeto: string | null = null
    if (body.projectId) {
      const { data: p } = await supabase
        .from('projects')
        .select('code, status, energy_concessionaires(name), project_general_data(holder_name, city, state, uc_number, phase_type, circuit_breaker_current), project_equipment(inverter_brand, inverter_model, inverter_power, inverter_quantity, module_brand, module_model, module_power, module_quantity, total_installed_power)')
        .eq('id', body.projectId).maybeSingle()
      if (p) {
        const g = (p as Record<string, any>).project_general_data
        const e = (p as Record<string, any>).project_equipment
        const c = (p as Record<string, any>).energy_concessionaires
        projeto = [
          `Código: ${(p as Record<string, any>).code}`,
          `Etapa: ${(p as Record<string, any>).status}`,
          c?.name ? `Concessionária: ${c.name}` : null,
          g?.holder_name ? `Titular: ${g.holder_name}` : null,
          g?.city ? `Local: ${g.city}/${g.state ?? ''}` : null,
          g?.uc_number ? `UC: ${g.uc_number}` : null,
          g?.phase_type ? `Fase do padrão: ${g.phase_type}` : null,
          g?.circuit_breaker_current ? `Disjuntor: ${g.circuit_breaker_current}` : null,
          e ? `Inversor: ${e.inverter_brand ?? ''} ${e.inverter_model ?? ''} — ${e.inverter_power ?? '?'}kW x${e.inverter_quantity ?? '?'}` : null,
          e ? `Módulos: ${e.module_brand ?? ''} ${e.module_model ?? ''} — ${e.module_power ?? '?'}Wp x${e.module_quantity ?? '?'}` : null,
          e?.total_installed_power ? `Potência total: ${e.total_installed_power} kWp` : null,
        ].filter(Boolean).join('\n')
      }
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }, 500)

    await supabase.rpc('consume_ai_quota', { _kind: 'bidu_chat' })

    const mensagens = [
      ...(body.historico ?? []).slice(-10).map(m => ({
        role: m.autor === 'bidu' ? 'assistant' : 'user',
        content: m.conteudo,
      })),
      { role: 'user', content: body.mensagem },
    ]

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO_IA,
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        system: promptDoSistema(habilidades ?? [], projeto),
        messages: mensagens,
      }),
    })
    if (!resp.ok) {
      console.error('Claude API error:', await resp.text())
      return json({ ok: false, error: `Erro na API Claude: ${resp.status}` }, 502)
    }

    const data = await resp.json()
    const texto = (data.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('\n').trim()

    // O modelo às vezes embrulha o JSON em cercas de código, mesmo instruído.
    const limpo = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    let parsed: { resposta?: string; habilidade?: { titulo: string; instrucao: string } | null }
    try {
      parsed = JSON.parse(limpo)
    } catch {
      // Não sendo JSON, a fala ainda vale — melhor entregar do que falhar.
      parsed = { resposta: texto, habilidade: null }
    }

    return json({
      ok: true,
      resposta: parsed.resposta ?? texto,
      habilidade: parsed.habilidade ?? null,
      uso: data.usage ?? null,
    })
  } catch (e) {
    console.error('[bidu-chat]', e)
    return json({ ok: false, error: e instanceof Error ? e.message : 'falha inesperada' }, 500)
  }
})

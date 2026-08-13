import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * LEITOR DE DATASHEET — preenche os dados técnicos que o Motor de Engenharia usa.
 *
 * Por que existe (relato do usuário, ago/2026): o motor avisava "0 de 4 dados
 * técnicos" para um módulo cujo datasheet estava anexado e completo. O dado
 * existia; ninguém tinha digitado no catálogo. Digitar 4 campos por módulo e 8
 * por inversor, para cada equipamento novo, não escala — e é justamente o tipo
 * de leitura que o modelo faz bem.
 *
 * A ARMADILHA que este prompt existe para evitar (ensinada pelo usuário):
 * datasheet de módulo quase nunca é de um modelo só. "RM-600-630W-182R/132TB"
 * cobre 600, 605, 610, 615, 620, 625 e 630 Wp — uma COLUNA por potência. Ler a
 * coluna errada, ou ler a tabela bifacial (BNPI) em vez da STC, entrega números
 * plausíveis e ERRADOS, que passariam despercebidos e furariam o
 * dimensionamento. Por isso: coluna escolhida pela potência do modelo, tabela
 * STC obrigatória, e conferência aritmética no servidor (Vmp × Imp ≈ potência).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODELO_IA = 'claude-opus-4-8'

interface ExtractRequest {
  base64: string
  mimeType: string
  type: 'inverter' | 'module'
  brand?: string
  model: string
  /** Potência nominal do item no catálogo — Wp (módulo) ou kW (inversor). */
  power?: number | null
}

interface ExtractResponse {
  ok: boolean
  specs?: Record<string, number>
  /** Qual coluna/variante do datasheet a IA usou — vai para a tela, é o que
   *  permite ao projetista conferir sem abrir o PDF. */
  coluna?: string
  warnings?: string[]
  error?: string
}

// ── Campos aceitos e faixa plausível ─────────────────────────────────────────
// A faixa não é preciosismo: é a rede que segura um valor lido da tabela errada
// (bifacial, NOCT) ou de outra linha. Fora da faixa, o campo é descartado com
// aviso — melhor faltar dado (o motor usa o padrão das Regras) do que calcular
// com número errado sem ninguém perceber.
const CAMPOS: Record<'module' | 'inverter', Record<string, [number, number]>> = {
  module: {
    voc_v: [10, 100],
    vmp_v: [10, 100],
    isc_a: [1, 40],
    imp_a: [1, 40],
  },
  inverter: {
    mppt_count: [1, 12],
    strings_per_mppt: [1, 8],
    mppt_vmin_v: [20, 800],
    mppt_vmax_v: [80, 1500],
    max_dc_voltage_v: [100, 1500],
    max_mppt_current_a: [1, 100],
    max_ac_current_a: [1, 300],
    ac_phases: [1, 3],
    ac_voltage_v: [100, 800],
    // microinversor
    dc_inputs: [1, 8],
    micro_max_per_branch: [1, 20],
    is_microinverter: [1, 1],
  },
}

function buildPrompt(req: ExtractRequest): string {
  const alvo = [req.brand, req.model].filter(Boolean).join(' ')
  const potencia = req.power != null && Number.isFinite(req.power)
    ? `${req.power} ${req.type === 'module' ? 'Wp' : 'kW'}`
    : '(não informada — deduza do nome do modelo)'

  const comum = `Você é um engenheiro eletricista lendo o datasheet de um equipamento fotovoltaico
para alimentar um motor de dimensionamento. Precisão vale mais que cobertura:
**dado que você não tem certeza, você OMITE** — o sistema tem valores-padrão
para o que faltar, mas não tem como perceber um número errado.

EQUIPAMENTO ALVO
- Modelo: ${alvo}
- Potência nominal cadastrada: ${potencia}

REGRA MAIS IMPORTANTE — DATASHEET DE FAMÍLIA
Um datasheet quase sempre cobre uma FAMÍLIA de modelos, não um só. O nome no
cabeçalho traz a faixa (ex.: "RM-600-630W-182R/132TB" cobre 600, 605, 610, 615,
620, 625 e 630 Wp; "SG3.0/4.0/5.0/6.0RS-L" cobre quatro inversores). As tabelas
elétricas trazem **uma coluna por modelo/potência**: a primeira coluna diz QUAL
grandeza é (Voc, Isc...), e cada coluna seguinte traz o valor daquela grandeza
para um modelo específico.

Então: identifique a potência/variante do EQUIPAMENTO ALVO acima e leia
**exatamente a coluna dele**. Cruze a linha da grandeza com a coluna do modelo.
- Se a potência não foi informada, deduza do nome do modelo (ex.: "RM-620W" → 620 Wp).
- Se a coluna exata do alvo NÃO existir no documento, **não interpole e não
  aproxime**: devolva "specs" vazio e explique em "warnings" quais colunas existem.
- Se o datasheet for de um modelo único (sem tabela de colunas), leia direto.`

  const moduloParte = `
TABELA CORRETA — SOMENTE STC
Use exclusivamente a tabela "CARACTERÍSTICAS ELÉTRICAS (STC)" / "Electrical
Characteristics (STC)" — STC = 1000 W/m², 25 °C, AM 1,5.
**NUNCA** use:
- tabelas NOCT / NMOT (800 W/m²) — valores menores;
- tabelas bifaciais: "Especificações (BNPI)", "BNPI", "BPI", "com ganho
  bifacial", "irradiância traseira" — valores MAIORES, que furariam o
  dimensionamento de string e de cabo.
Na dúvida entre duas tabelas, a válida é a que bate com a potência nominal do
alvo: Vmp × Imp ≈ potência nominal (±3%).

CAMPOS A EXTRAIR (todos em STC, na coluna do alvo):
- "voc_v" (V) — Tensão de circuito aberto / Voc / Open circuit voltage
- "isc_a" (A) — Corrente de curto-circuito / Isc / Short circuit current
- "vmp_v" (V) — Tensão de máxima potência / Vmp / Vmpp
  (aparece também como "Tensão máxima de alimentação-Vmpp")
- "imp_a" (A) — Corrente de máxima potência / Imp / Impp
  (aparece também como "Máx. Corrente de Potência-Impp")

CONFERÊNCIA OBRIGATÓRIA antes de responder: Voc > Vmp, Isc > Imp e
Vmp × Imp ≈ potência nominal do alvo. Se não fechar, você leu a coluna ou a
tabela errada — releia.`

  const inversorParte = `
CAMPOS A EXTRAIR (na coluna do modelo alvo):
- "mppt_count" — Número de MPPTs / rastreadores MPP / MPPT number
- "strings_per_mppt" — entradas (strings) POR MPPT. Atenção: muitos datasheets
  informam o TOTAL de entradas CC; se for total, divida pelo número de MPPTs.
- "mppt_vmin_v" e "mppt_vmax_v" — extremos da FAIXA DE TENSÃO MPPT de operação.
  Se houver também "faixa de tensão MPPT a plena carga", use a faixa GERAL, não a de plena carga.
- "max_dc_voltage_v" — Máxima tensão de entrada CC / Max. PV input voltage
- "max_mppt_current_a" — Corrente MÁXIMA DE ENTRADA por MPPT.
  Não confunda com "corrente de curto-circuito máx. por MPPT" (Isc), que é maior.
- "max_ac_current_a" — Corrente máxima de saída CA
- "ac_phases" — 1 monofásico, 2 bifásico, 3 trifásico. Deduza do tipo de
  conexão CA ("220 V / 1Φ", "380 V / 3Φ", "single-phase", "three-phase").
  **Este campo é crítico**: sem ele o sistema deduz a fase pela potência e já
  calculou um inversor monofásico de 3 kW como se fosse trifásico.
- "ac_voltage_v" — Tensão nominal de saída CA
Se — e somente se — o documento indicar MICROINVERSOR (várias entradas CC
independentes, uma por módulo, sem janela de string), acrescente:
- "is_microinverter": 1
- "dc_inputs" — quantos módulos entram em um micro
- "micro_max_per_branch" — máximo de micros no mesmo ramal CA (se declarado)`

  return `${comum}
${req.type === 'module' ? moduloParte : inversorParte}

RESPONDA SÓ COM ESTE JSON, sem texto em volta, sem markdown:
{
  "specs": { "campo": número, ... },
  "coluna": "descrição curta de onde você leu (ex.: 'tabela STC, coluna 620 Wp')",
  "warnings": ["o que não deu para ler e por quê"]
}
Omita do "specs" todo campo que você não encontrou ou não tem certeza. Use
ponto decimal. Não invente, não estime, não copie de outro modelo da família.`
}

function contentBlock(req: ExtractRequest) {
  return req.mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: req.mimeType, data: req.base64 } }
}

/**
 * Só entra o que é número finito, de campo conhecido e dentro da faixa
 * plausível. Depois, as conferências de coerência física do módulo — é aqui que
 * uma leitura da tabela bifacial morre, mesmo parecendo boa.
 */
function sanitizar(
  bruto: unknown,
  tipo: 'module' | 'inverter',
  potencia: number | null | undefined,
  warnings: string[],
): Record<string, number> {
  const faixas = CAMPOS[tipo]
  const out: Record<string, number> = {}
  // Guarda também o valor CRU (antes do filtro de faixa) porque as conferências
  // de par precisam ver os dois lados. Com a faixa de MPPT lida invertida
  // (mín. 560 / máx. 40), o 40 cai sozinho por estar fora da faixa e o 560
  // sobrevive — virando um "mínimo" de 560 V que ninguém questiona.
  const crus: Record<string, number> = {}
  for (const [k, v] of Object.entries((bruto ?? {}) as Record<string, unknown>)) {
    const faixa = faixas[k]
    if (!faixa) continue
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
    if (!Number.isFinite(n)) continue
    crus[k] = n
    if (n < faixa[0] || n > faixa[1]) {
      warnings.push(`"${k}" veio ${n}, fora do esperado (${faixa[0]}–${faixa[1]}) — descartado`)
      continue
    }
    out[k] = n
  }

  /** Par incoerente derruba os DOIS lados, mesmo que um já tenha caído na faixa. */
  const derrubaPar = (a: string, b: string, incoerente: boolean, motivo: string) => {
    if (crus[a] == null || crus[b] == null || !incoerente) return
    warnings.push(motivo)
    delete out[a]; delete out[b]
  }

  if (tipo === 'inverter') {
    if (out.ac_phases != null) out.ac_phases = Math.round(out.ac_phases)
    for (const k of ['mppt_count', 'strings_per_mppt', 'dc_inputs', 'micro_max_per_branch']) {
      if (out[k] != null) out[k] = Math.round(out[k])
    }
    derrubaPar('mppt_vmin_v', 'mppt_vmax_v', crus.mppt_vmin_v >= crus.mppt_vmax_v,
      'faixa de MPPT com mínimo ≥ máximo — as duas tensões foram descartadas')
    derrubaPar('mppt_vmax_v', 'max_dc_voltage_v', crus.mppt_vmax_v > crus.max_dc_voltage_v,
      'tensão máx. de MPPT maior que a tensão CC máxima — descartadas por incoerência')
    return out
  }

  // ── módulo ────────────────────────────────────────────────────────────────
  derrubaPar('voc_v', 'vmp_v', crus.voc_v <= crus.vmp_v,
    'Voc ≤ Vmp é impossível — os dois valores foram descartados')
  derrubaPar('isc_a', 'imp_a', crus.isc_a <= crus.imp_a,
    'Isc ≤ Imp é impossível — os dois valores foram descartados')
  // Vmp × Imp tem de dar a potência nominal. É o que separa a tabela STC da
  // bifacial (que dá ~10% a mais) e pega coluna trocada.
  // Limite de 3%: na coluna certa o produto fecha em ~0,1% (620 W → 41,40 ×
  // 14,99 = 620,6), então 3% é folgado para arredondamento e ainda pega uma
  // coluna 20 W distante (600 lido para 620 dá 3,1%). Colunas VIZINHAS (5 W de
  // passo, 0,8%) não têm como ser separadas por aritmética — por isso a tela
  // mostra QUAL coluna a IA usou, para conferência humana.
  if (potencia && potencia > 0 && out.vmp_v != null && out.imp_a != null) {
    const calculada = out.vmp_v * out.imp_a
    const erro = Math.abs(calculada - potencia) / potencia
    if (erro > 0.03) {
      warnings.push(
        `Vmp × Imp = ${calculada.toFixed(0)} W, mas o módulo é de ${potencia} W ` +
        `(${(erro * 100).toFixed(0)}% de diferença): provável leitura da coluna ou da tabela errada ` +
        `(bifacial/NOCT). Todos os valores elétricos foram descartados — confira o datasheet.`,
      )
      delete out.voc_v; delete out.vmp_v; delete out.isc_a; delete out.imp_a
    }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const json = (body: ExtractResponse, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }, 500)

  try {
    const body: ExtractRequest = await req.json()
    if (!body?.base64 || !body?.mimeType) return json({ ok: false, error: 'Nenhum documento enviado' }, 400)
    if (body.type !== 'module' && body.type !== 'inverter') return json({ ok: false, error: 'Tipo inválido' }, 400)
    if (!body.model?.trim()) return json({ ok: false, error: 'Modelo do equipamento não informado' }, 400)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'Login necessário' }, 401)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: quota, error: quotaError } = await userClient
      .rpc('consume_ai_quota', { _kind: 'datasheet_extract' })
    if (quotaError) {
      console.error('Erro ao verificar cota:', quotaError)
      return json({ ok: false, error: 'Não foi possível verificar a cota de IA' }, 500)
    }
    if (!quota?.allowed) {
      const msg = quota?.reason === 'quota_exceeded'
        ? `Cota de análises de IA do seu plano atingida (${quota.used}/${quota.quota} neste mês).`
        : 'Seu plano não inclui análises de IA ou a assinatura está suspensa.'
      return json({ ok: false, error: msg })
    }

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO_IA,
        max_tokens: 3000,
        // ler a coluna certa de uma tabela de família exige raciocínio, não OCR
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: [contentBlock(body), { type: 'text', text: buildPrompt(body) }] }],
      }),
    })
    if (!claudeResp.ok) {
      console.error('Claude API error:', await claudeResp.text())
      return json({ ok: false, error: `Erro na API Claude: ${claudeResp.status}` }, 502)
    }
    const claudeData = await claudeResp.json()

    if (quota?.log_id && claudeData?.usage) {
      const { error: usageErr } = await userClient.rpc('update_ai_usage_tokens', {
        _log_id: quota.log_id,
        _model: MODELO_IA,
        _input_tokens: claudeData.usage.input_tokens ?? null,
        _output_tokens: claudeData.usage.output_tokens ?? null,
      })
      if (usageErr) console.error('update_ai_usage_tokens:', usageErr)
    }
    if (claudeData.stop_reason === 'refusal') {
      return json({ ok: false, error: 'A leitura foi recusada pelos filtros do modelo' })
    }

    const textBlock = (claudeData.content ?? []).find((b: { type: string }) => b.type === 'text')
    const rawText = textBlock?.text || '{}'
    let parsed: { specs?: unknown; coluna?: unknown; warnings?: unknown }
    try {
      const m = rawText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(m ? m[0] : rawText)
    } catch {
      console.error('Resposta não-JSON:', rawText.slice(0, 1500))
      return json({ ok: false, error: 'Não foi possível interpretar o datasheet' }, 422)
    }

    const warnings: string[] = Array.isArray(parsed.warnings)
      ? (parsed.warnings as unknown[]).filter((w): w is string => typeof w === 'string').slice(0, 8)
      : []
    const specs = sanitizar(parsed.specs, body.type, body.power, warnings)

    if (Object.keys(specs).length === 0) {
      return json({
        ok: false,
        warnings,
        error: 'Nenhum dado técnico pôde ser lido com segurança deste documento',
      })
    }

    return json({
      ok: true,
      specs,
      coluna: typeof parsed.coluna === 'string' ? parsed.coluna.slice(0, 120) : undefined,
      warnings,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return json({ ok: false, error: error instanceof Error ? error.message : 'Erro inesperado' }, 500)
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Uma imagem como data URL (data:image/jpeg;base64,...) ou base64 cru + mime. */
interface ImageInput {
  base64: string
  mimeType: string
}

interface ReviewRequest {
  /** Página do documento original (render do PDF ou foto). */
  original: ImageInput
  /** Render do NOSSO diagrama recriado (opcional — sem ele a revisão compara só contra o JSON). */
  render?: ImageInput
  /** Estado atual reconhecido/desenhado, no mesmo schema do diagram-recognize. */
  current: {
    components: unknown[]
    connections: unknown[]
    groups?: unknown[]
  }
}

interface RecognizedComponent {
  id: string
  kind: string
  label: string
  stage?: number
  branch?: boolean
  x?: number
  y?: number
}

interface RecognizedConnection {
  from: string
  to: string
  label?: string
}

interface RecognizedGroup {
  title: string
  x: number
  y: number
  w: number
  h: number
}

// ── Vocabulário (sincronizado manualmente com src/utils/cadEngine/symbols.ts) ─
const KIND_CATALOG = `
- pv-array: conjunto/arranjo de módulos fotovoltaicos (retângulo com linhas diagonais)
- inverter: inversor (caixa dividida ao meio, lado CC com +/-, lado CA com onda senoidal)
- breaker: disjuntor bipolar (linha com uma lâmina diagonal entre dois contatos)
- breaker-tripolar: disjuntor tripolar (igual ao bipolar, com uma lâmina/traço extra)
- dc-switch: chave/seccionadora CC (lâmina diagonal simples entre dois contatos, sem marca de disparo)
- meter: medidor de energia convencional (círculo com "M")
- meter-bidirectional: medidor de energia bidirecional (caixa retangular, geralmente rotulada "kWh")
- utility-grid: rede da concessionária / ponto de conexão com a distribuidora
- dps: DPS, dispositivo de proteção contra surto (caixa pequena com seta/raio, geralmente em derivação vertical)
- fuse: fusível (caixa retangular pequena no meio de um condutor)
- ground: aterramento (símbolo de terra: linha com barras horizontais decrescentes)
- distribution-panel: quadro de distribuição / quadro geral (caixa maior com divisórias internas)
`.trim()

function buildPrompt(currentJson: string, hasRender: boolean): string {
  return `Você é um ENGENHEIRO ELETRICISTA REVISOR, especialista em projetos fotovoltaicos de
geração distribuída no Brasil e em diagramas unifilares aceitos pelas concessionárias.

Sua tarefa: revisar uma RECRIAÇÃO digital de um diagrama unifilar contra o DOCUMENTO ORIGINAL.

Você recebeu:
1. A imagem do DOCUMENTO ORIGINAL (primeiro anexo).
${hasRender ? '2. A imagem da RECRIAÇÃO atual no nosso editor (segundo anexo).' : ''}
${hasRender ? '3.' : '2.'} O JSON da recriação atual:
${currentJson}

VOCABULÁRIO DE COMPONENTES — use APENAS estes "kind":
${KIND_CATALOG}

REVISE COMO UM ENGENHEIRO, nesta ordem:
1. COMPLETUDE: todo componente elétrico desenhado no original está na recriação? Algo foi
   inventado que não existe no original? (Ignore carimbo, tabela de legenda do original,
   planta de localização, selos de aviso — não são componentes.)
2. TIPOS: cada componente tem o "kind" certo? (disjuntor bipolar vs tripolar; medidor
   convencional vs bidirecional; chave CC vs disjuntor; etc.)
3. DISPOSIÇÃO: as posições x/y (0–100, centro do símbolo na área do diagrama do ORIGINAL,
   x esquerda→direita, y topo→baixo) preservam a disposição do original? O que está acima/
   abaixo, à esquerda/à direita, alinhado em coluna/linha?
4. LIGAÇÕES: o fluxo elétrico está certo (geração → rede)? Derivações (DPS, aterramento)
   conectam no ponto certo? Bitolas escritas nos trechos (ex.: "2#6mm² + #6mm²") estão como
   "label" da conexão certa?
5. GRUPOS: caixas de agrupamento do original (ex.: "QG - Sistema Fotovoltaico") existem com
   título e área (x/y/w/h em 0–100) aproximadamente certos?
6. COERÊNCIA ELÉTRICA (cheque de engenheiro): a cadeia faz sentido? Tipicamente:
   módulos → (chave CC) → (DPS CC em derivação) → inversor → (DPS CA em derivação) →
   disjuntor CA → medição → rede, com aterramento/BEP. Se o ORIGINAL contradisser o típico,
   o original manda — você recria o documento, não o corrige.

REGRAS:
- Nunca inclua dados pessoais do documento (titular, endereço, ART, CPF/CNPJ, nomes).
- "label" de componente: rótulo técnico curto em português.
- Prefira corrigir a remover; remova só o que claramente não existe no original.
- "stage" (inteiro, 0 = geração, crescente até a rede) e "branch" (true = derivação) devem
  ser mantidos/corrigidos junto.
- Em "notes", liste em português, telegráfico, cada correção que você fez (máx. 10 itens).
  Se estava tudo certo, "notes": [].

Retorne APENAS JSON válido, sem markdown, com o diagrama COMPLETO já corrigido:
{
  "components": [
    { "id": "c1", "kind": "pv-array", "label": "Módulos FV", "x": 5, "y": 80, "stage": 0, "branch": false }
  ],
  "connections": [ { "from": "c1", "to": "c2", "label": "2#6mm² + #6mm²" } ],
  "groups": [ { "title": "QG - Sistema Fotovoltaico", "x": 20, "y": 70, "w": 30, "h": 28 } ],
  "notes": ["movido o medidor pra coluna da direita, alinhado com a rede"]
}`
}

const KIND_ALIASES: Record<string, string> = {
  'solar-array': 'pv-array', 'solar-panel': 'pv-array', 'pv-panel': 'pv-array', 'module-array': 'pv-array',
  'photovoltaic-array': 'pv-array', 'array': 'pv-array', 'modules': 'pv-array', 'painel-solar': 'pv-array',
  'circuit-breaker': 'breaker', 'breaker-bipolar': 'breaker', 'disjuntor': 'breaker', 'disjuntor-bipolar': 'breaker',
  'circuit-breaker-tripolar': 'breaker-tripolar', 'disjuntor-tripolar': 'breaker-tripolar',
  'dc-disconnect': 'dc-switch', 'disconnect-switch': 'dc-switch', 'chave-cc': 'dc-switch', 'switch': 'dc-switch',
  'energy-meter': 'meter', 'meter-conventional': 'meter', 'medidor': 'meter',
  'bidirectional-meter': 'meter-bidirectional', 'meter-bidirecional': 'meter-bidirectional', 'medidor-bidirecional': 'meter-bidirectional',
  'grid': 'utility-grid', 'utility': 'utility-grid', 'power-grid': 'utility-grid', 'rede': 'utility-grid',
  'surge-protector': 'dps', 'surge-protection': 'dps', 'spd': 'dps',
  'fuse-box': 'fuse', 'fusivel': 'fuse',
  'earth': 'ground', 'earthing': 'ground', 'grounding': 'ground', 'aterramento': 'ground', 'bep': 'ground',
  'distribution-board': 'distribution-panel', 'panel': 'distribution-panel', 'quadro': 'distribution-panel',
  'quadro-de-distribuicao': 'distribution-panel',
}
function normalizeKind(kind: unknown): string {
  if (typeof kind !== 'string') return ''
  const k = kind.trim().toLowerCase()
  return KIND_ALIASES[k] ?? k
}

const VALID_KINDS = new Set([
  'pv-array', 'inverter', 'breaker', 'breaker-tripolar', 'dc-switch', 'meter',
  'meter-bidirectional', 'utility-grid', 'dps', 'fuse', 'ground', 'distribution-panel',
])

/** Aceita data URL ou base64 cru; devolve o bloco de imagem da API. */
function imageBlock(img: ImageInput) {
  let data = img.base64
  let mediaType = img.mimeType
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(data)
  if (m) { mediaType = m[1]; data = m[2] }
  const valid = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  return { type: 'image', source: { type: 'base64', media_type: valid.includes(mediaType) ? mediaType : 'image/jpeg', data } }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body: ReviewRequest = await req.json()
    if (!body?.original?.base64 || !body?.current) {
      return new Response(JSON.stringify({ ok: false, error: 'Faltou o original ou o estado atual' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Autenticação + cota (mesmo mecanismo do Claudinho/diagram-recognize) ─
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Login necessário' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: quota, error: quotaError } = await userClient
      .rpc('consume_ai_quota', { _kind: 'diagram_review' })
    if (quotaError) {
      console.error('Erro ao verificar cota:', quotaError)
      return new Response(JSON.stringify({ ok: false, error: 'Não foi possível verificar a cota de IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!quota?.allowed) {
      return new Response(JSON.stringify({ ok: false, error: 'Seu plano não inclui análises de IA ou a cota do mês acabou.' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const currentJson = JSON.stringify({
      components: body.current.components ?? [],
      connections: body.current.connections ?? [],
      groups: body.current.groups ?? [],
    })

    const content: any[] = [imageBlock(body.original)]
    if (body.render?.base64) content.push(imageBlock(body.render))
    content.push({ type: 'text', text: buildPrompt(currentJson, !!body.render?.base64) })

    // Opus + adaptive thinking: a revisão é a etapa de maior valor da importação
    // (rara e crítica) — modelo mais capaz compensa aqui.
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content }],
      }),
    })

    if (!claudeResp.ok) {
      const err = await claudeResp.text()
      console.error('Claude API error:', err)
      return new Response(JSON.stringify({ ok: false, error: `Erro na API Claude: ${claudeResp.status}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const claudeData = await claudeResp.json()

    // Completa o lançamento de uso com os tokens reais — alimenta o extrato
    // de IA do console master (best-effort: falha não afeta a revisão).
    if (quota?.log_id && claudeData?.usage) {
      const { error: usageErr } = await userClient.rpc('update_ai_usage_tokens', {
        _log_id: quota.log_id,
        _model: 'claude-opus-4-8',
        _input_tokens: claudeData.usage.input_tokens ?? null,
        _output_tokens: claudeData.usage.output_tokens ?? null,
      })
      if (usageErr) console.error('update_ai_usage_tokens:', usageErr)
    }

    if (claudeData.stop_reason === 'refusal') {
      return new Response(JSON.stringify({ ok: false, error: 'A revisão foi recusada pelos filtros do modelo' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const textBlock = (claudeData.content ?? []).find((b: { type: string }) => b.type === 'text')
    const rawText = textBlock?.text || '{}'

    let parsed: any
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
    } catch {
      console.error('Failed to parse review response:', rawText.slice(0, 2000))
      return new Response(JSON.stringify({ ok: false, error: 'Não foi possível interpretar a revisão' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sanitização — idêntica ao diagram-recognize
    const notes: string[] = Array.isArray(parsed.notes) ? parsed.notes.filter((n: unknown) => typeof n === 'string').slice(0, 10) : []
    const norm = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : undefined
    const rawComponents: RecognizedComponent[] = Array.isArray(parsed.components) ? parsed.components : []
    console.log(`diagram-review: revisão devolveu ${rawComponents.length} componente(s), notes: ${notes.length}`)
    const components = rawComponents.reduce<RecognizedComponent[]>((acc, c) => {
      const kind = normalizeKind(c?.kind)
      if (!c || typeof c.id !== 'string' || typeof c.label !== 'string' || !VALID_KINDS.has(kind)) return acc
      acc.push({ ...c, kind, stage: Number.isFinite(c.stage) ? c.stage : 0, branch: c.branch === true, x: norm(c.x), y: norm(c.y) })
      return acc
    }, [])
    const ids = new Set(components.map((c) => c.id))
    const rawConnections: RecognizedConnection[] = Array.isArray(parsed.connections) ? parsed.connections : []
    const connections = rawConnections
      .filter((c) => c && ids.has(c.from) && ids.has(c.to) && c.from !== c.to)
      .map((c) => ({
        from: c.from, to: c.to,
        label: typeof c.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 60) : undefined,
      }))
    const rawGroups: RecognizedGroup[] = Array.isArray(parsed.groups) ? parsed.groups : []
    const groups = rawGroups.reduce<RecognizedGroup[]>((acc, g) => {
      const x = norm(g?.x), y = norm(g?.y), w = norm(g?.w), h = norm(g?.h)
      if (typeof g?.title !== 'string' || !g.title.trim() || x === undefined || y === undefined || !w || !h) return acc
      acc.push({ title: g.title.trim().slice(0, 80), x, y, w, h })
      return acc
    }, [])

    if (components.length === 0) {
      console.log('diagram-review: 0 componentes válidos — resposta bruta:', rawText.slice(0, 2000))
      return new Response(JSON.stringify({ ok: false, error: 'A revisão não devolveu um diagrama válido' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, components, connections, groups, notes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Tipos ────────────────────────────────────────────────────────────────────

interface RecognizeRequest {
  base64: string      // base64 sem prefixo data:...
  mimeType: string     // 'application/pdf' | 'image/jpeg' | 'image/png'
}

interface RecognizedComponent {
  id: string
  kind: string
  label: string
  stage?: number
  branch?: boolean
  x?: number   // posição normalizada 0-100 no documento (esquerda→direita)
  y?: number   // posição normalizada 0-100 no documento (topo→baixo)
}

interface RecognizedConnection {
  from: string
  to: string
  label?: string  // especificação do condutor escrita no trecho (ex.: "2#6mm² + #6mm²")
}

interface RecognizedGroup {
  title: string
  x: number
  y: number
  w: number
  h: number
}

interface RecognizeResponse {
  ok: boolean
  components?: RecognizedComponent[]
  connections?: RecognizedConnection[]
  groups?: RecognizedGroup[]
  warnings?: string[]
  error?: string
}

// ── Vocabulário de símbolos ──────────────────────────────────────────────────
// Mantido sincronizado manualmente com KIND_LABEL/SYMBOL_DEFS em
// src/utils/cadEngine/symbols.ts (o edge function roda isolado do bundle do
// app, sem acesso a esse import) — ao adicionar um ComponentKind novo lá,
// adicionar a descrição correspondente aqui.
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

function buildPrompt(): string {
  return `Você é um especialista em leitura de diagramas unifilares de sistemas fotovoltaicos.

Analise o diagrama unifilar enviado (PDF ou imagem) e identifique cada componente elétrico
desenhado, ONDE ele fica na sequência do fluxo elétrico, e como eles se conectam entre si.

VOCABULÁRIO DE COMPONENTES — use OBRIGATORIAMENTE apenas estes "kind" (nunca invente um novo):
${KIND_CATALOG}

Para cada componente, além do tipo, informe:
- "x" e "y": a posição do CENTRO do símbolo no desenho do diagrama, em percentual de 0 a 100 —
  "x": 0 = borda esquerda da ÁREA DO DIAGRAMA, 100 = borda direita; "y": 0 = topo, 100 = base.
  Considere só a área onde o diagrama elétrico está desenhado (ignore carimbo, tabela de
  legenda, planta de localização — eles não fazem parte da área 0-100). Precisão aproximada
  (~5%) é suficiente; o importante é preservar a DISPOSIÇÃO RELATIVA: o que está acima/abaixo,
  à esquerda/à direita, alinhado com o quê.
- "stage": um número inteiro (0, 1, 2, 3...) representando a posição dele no fluxo principal da
  geração (0) até a rede da concessionária (o maior número); um componente em derivação recebe
  o MESMO "stage" do ponto do condutor principal de onde ele deriva.
- "branch": true se o componente NÃO fica no condutor principal (é uma derivação — DPS,
  aterramento, ou qualquer proteção que sai do condutor principal em vez de estar em série nele);
  false se ele está em série no fluxo principal.

Informe também, quando existirem no diagrama:
- "groups": caixas de agrupamento desenhadas em volta de conjuntos de componentes (ex.:
  "QG - Sistema Fotovoltaico", "MEDIÇÃO E DISJUNTOR GERAL") — com "title" (o texto do grupo,
  sem dados pessoais) e "x"/"y"/"w"/"h" em percentual 0-100 da mesma área do diagrama
  (x,y = canto superior-esquerdo da caixa).
- Em cada conexão, "label": a especificação do condutor escrita naquele trecho, se houver
  (ex.: "2#6mm² + #6mm²") — só o texto da bitola/especificação, nada mais.

REGRAS:
1. Ignore textos que não sejam do diagrama em si (título, carimbo, planta de localização, dados
   do titular, coordenadas geográficas, ART, endereço, CPF/CNPJ, nomes de pessoas — não inclua
   NADA disso na resposta, mesmo que apareça no documento).
2. Cada componente ganha um "id" curto e único (ex.: "c1", "c2", ...).
3. "label" do componente é um rótulo curto em português — pode reaproveitar o texto do diagrama
   quando fizer sentido, mas sem dados pessoais.
4. "connections" liga os "id" dos componentes na direção do fluxo elétrico (da geração para a
   rede); um componente em derivação conecta ao componente do condutor principal mais próximo.
5. Se não conseguir identificar um componente com confiança, prefira OMITIR a inventar.
6. Se algo no diagrama não corresponder a nenhum "kind" do vocabulário, não o inclua na resposta
   e explique em "warnings" (texto curto, sem dados pessoais).

Retorne APENAS JSON válido, sem markdown, no formato exato:
{
  "components": [
    { "id": "c1", "kind": "pv-array", "label": "Módulos FV", "x": 5, "y": 80, "stage": 0, "branch": false },
    { "id": "c2", "kind": "inverter", "label": "Inversor", "x": 25, "y": 80, "stage": 1, "branch": false },
    { "id": "c3", "kind": "dps", "label": "DPS CA", "x": 35, "y": 92, "stage": 1, "branch": true }
  ],
  "connections": [
    { "from": "c1", "to": "c2", "label": "2#6mm² + #6mm²" },
    { "from": "c2", "to": "c3" }
  ],
  "groups": [
    { "title": "QG - Sistema Fotovoltaico", "x": 20, "y": 70, "w": 30, "h": 28 }
  ],
  "warnings": []
}`
}

/**
 * Variações comuns que a IA às vezes usa em vez do "kind" exato do
 * vocabulário (plural, inglês, sinônimo) — normalizadas antes de validar
 * contra `VALID_KINDS`, pra uma resposta quase-certa não virar "0
 * componentes reconhecidos" só por causa de uma string ligeiramente
 * diferente.
 */
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

function buildContentBlock(doc: RecognizeRequest) {
  if (doc.mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } }
  }
  const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const mediaType = validImageTypes.includes(doc.mimeType) ? doc.mimeType : 'image/jpeg'
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: doc.base64 } }
}

const VALID_KINDS = new Set([
  'pv-array', 'inverter', 'breaker', 'breaker-tripolar', 'dc-switch', 'meter',
  'meter-bidirectional', 'utility-grid', 'dps', 'fuse', 'ground', 'distribution-panel',
])

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY não configurada' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body: RecognizeRequest = await req.json()
    if (!body?.base64 || !body?.mimeType) {
      return new Response(JSON.stringify({ ok: false, error: 'Nenhum arquivo enviado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Autenticação + cota de IA (mesmo mecanismo do Claudinho) ────────────
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
      .rpc('consume_ai_quota', { _kind: 'diagram_recognize' })
    if (quotaError) {
      console.error('Erro ao verificar cota:', quotaError)
      return new Response(JSON.stringify({ ok: false, error: 'Não foi possível verificar a cota de IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!quota?.allowed) {
      const msg = quota?.reason === 'quota_exceeded'
        ? `Cota de análises de IA do seu plano atingida (${quota.used}/${quota.quota} neste mês).`
        : 'Seu plano não inclui análises de IA ou a assinatura está suspensa.'
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const contentBlocks: any[] = [buildContentBlock(body), { type: 'text', text: buildPrompt() }]

    const model = 'claude-haiku-4-5-20251001' // mesmo modelo confirmado no claudinho-verifica

    const claudeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
    if (body.mimeType === 'application/pdf') claudeHeaders['anthropic-beta'] = 'pdfs-2024-09-25'

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: claudeHeaders,
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        messages: [{ role: 'user', content: contentBlocks }],
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
    const rawText = claudeData.content?.[0]?.text || '{}'

    let parsed: any
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
    } catch {
      console.error('Failed to parse Claude response:', rawText)
      return new Response(JSON.stringify({ ok: false, error: 'Não foi possível interpretar o diagrama' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sanitiza: só aceita componentes com "kind" do vocabulário conhecido (com
    // normalização de sinônimos/variações, ver KIND_ALIASES) e conexões cujas
    // duas pontas existam entre os componentes aceitos.
    const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w: unknown) => typeof w === 'string') : []
    const rawComponents: RecognizedComponent[] = Array.isArray(parsed.components) ? parsed.components : []
    console.log(`diagram-recognize: IA devolveu ${rawComponents.length} componente(s) bruto(s), kinds:`, rawComponents.map((c) => c?.kind))
    const norm = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : undefined
    const components = rawComponents.reduce<RecognizedComponent[]>((acc, c) => {
      const kind = normalizeKind(c?.kind)
      const ok = !!c && typeof c.id === 'string' && typeof c.label === 'string' && VALID_KINDS.has(kind)
      if (!ok) { warnings.push(`Componente ignorado (tipo não reconhecido): ${c?.kind ?? '?'}`); return acc }
      const stage = Number.isFinite(c.stage) ? c.stage : 0
      acc.push({ ...c, kind, stage, branch: c.branch === true, x: norm(c.x), y: norm(c.y) })
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
      console.log('diagram-recognize: 0 componentes válidos após normalização — resposta bruta:', rawText.slice(0, 2000))
      return new Response(JSON.stringify({ ok: false, error: 'Nenhum componente reconhecido no diagrama enviado' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const response: RecognizeResponse = { ok: true, components, connections, groups, warnings }
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Unexpected error:', error)
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

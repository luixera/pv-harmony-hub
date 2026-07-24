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
}

interface RecognizedConnection {
  from: string
  to: string
}

interface RecognizeResponse {
  ok: boolean
  components?: RecognizedComponent[]
  connections?: RecognizedConnection[]
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
desenhado e como eles se conectam entre si (fluxo do arranjo fotovoltaico até a rede da
concessionária, incluindo derivações de proteção como DPS/aterramento/chaves).

VOCABULÁRIO DE COMPONENTES — use OBRIGATORIAMENTE apenas estes "kind" (nunca invente um novo):
${KIND_CATALOG}

REGRAS:
1. Ignore textos que não sejam de um componente do diagrama em si (título, carimbo, planta de
   localização, dados do titular, coordenadas, ART, endereço, CPF/CNPJ, nomes de pessoas — não
   inclua NADA disso na resposta, mesmo que apareça no documento).
2. Cada componente ganha um "id" curto e único (ex.: "c1", "c2", ...).
3. "label" é um rótulo curto em português do componente (ex.: "Módulos FV", "Inversor",
   "Disjuntor CA", "Medidor Bidirecional") — pode reaproveitar o texto do diagrama quando fizer
   sentido, mas sem dados pessoais.
4. "connections" liga os "id" dos componentes na direção do fluxo elétrico (da geração para a
   rede); um componente em derivação (DPS, aterramento) conecta ao ponto do condutor principal
   mais próximo dele.
5. Se não conseguir identificar um componente com confiança, prefira OMITIR a inventar.
6. Se algo no diagrama não corresponder a nenhum "kind" do vocabulário, não o inclua na resposta
   e explique em "warnings" (texto curto, sem dados pessoais).

Retorne APENAS JSON válido, sem markdown, no formato exato:
{
  "components": [
    { "id": "c1", "kind": "pv-array", "label": "Módulos FV" },
    { "id": "c2", "kind": "inverter", "label": "Inversor" }
  ],
  "connections": [
    { "from": "c1", "to": "c2" }
  ],
  "warnings": []
}`
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

    // Sanitiza: só aceita componentes com "kind" do vocabulário conhecido e
    // conexões cujas duas pontas existam entre os componentes aceitos.
    const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w: unknown) => typeof w === 'string') : []
    const rawComponents: RecognizedComponent[] = Array.isArray(parsed.components) ? parsed.components : []
    const components = rawComponents.filter((c) => {
      const ok = c && typeof c.id === 'string' && typeof c.label === 'string' && VALID_KINDS.has(c.kind)
      if (!ok) warnings.push(`Componente ignorado (tipo não reconhecido): ${c?.kind ?? '?'}`)
      return ok
    })
    const ids = new Set(components.map((c) => c.id))
    const rawConnections: RecognizedConnection[] = Array.isArray(parsed.connections) ? parsed.connections : []
    const connections = rawConnections.filter((c) => c && ids.has(c.from) && ids.has(c.to) && c.from !== c.to)

    if (components.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Nenhum componente reconhecido no diagrama enviado' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const response: RecognizeResponse = { ok: true, components, connections, warnings }
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

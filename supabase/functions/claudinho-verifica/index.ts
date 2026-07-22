import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Tipos ────────────────────────────────────────────────────────────────────

interface DocumentInput {
  base64: string      // base64 sem prefixo data:...
  mimeType: string    // 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic'
  hint?: string       // tipo sugerido pelo usuário (opcional)
}

interface AnalyzeRequest {
  mode: 'analyze' | 'compare'
  documents: DocumentInput[]
}

interface FieldResult {
  value: string | null
  confidence: number   // 0-100
  source: string       // qual documento originou
}

interface TitleComparison {
  energy_bill_name: string | null
  document_name: string | null
  document_type_detected: string   // 'rg' | 'cnh' | 'cnpj' | 'contrato_social' | 'outro'
  match: boolean
  similarity: number   // 0-100
  unexpected_document: boolean  // documento não é RG/CNH/CNPJ esperado
}

interface AnalyzeResponse {
  ok: boolean
  mode: 'analyze' | 'compare'
  // campos extraídos (só no modo analyze)
  holder_name?: FieldResult
  cpf_cnpj?: FieldResult
  address?: FieldResult
  address_number?: FieldResult
  neighborhood?: FieldResult
  city?: FieldResult
  state?: FieldResult
  cep?: FieldResult
  uc_number?: FieldResult
  phase_type?: FieldResult
  concessionaire_hint?: FieldResult
  inverter_brand?: FieldResult
  inverter_model?: FieldResult
  inverter_power?: FieldResult
  inverter_quantity?: FieldResult
  module_brand?: FieldResult
  module_model?: FieldResult
  module_power?: FieldResult
  module_quantity?: FieldResult
  circuit_breaker_current?: FieldResult
  document_types_detected?: string[]
  // comparativo (ambos os modos)
  title_comparison?: TitleComparison
  error?: string
}

// ── Prompt de análise completa ────────────────────────────────────────────────

function buildAnalyzePrompt(): string {
  return `Você é o Claudinho Verifica, especialista em análise de documentos para homologação fotovoltaica no Brasil.

Analise TODOS os documentos recebidos e extraia as informações abaixo.

REGRAS IMPORTANTES:
1. Para cada campo, informe o valor extraído e uma confiança de 0 a 100.
2. Se um campo não for encontrado, use null e confiança 0.
3. Identifique o tipo de cada documento recebido.
4. Compare o nome do titular na conta de energia com o nome no documento de identidade (RG, CNH ou Cartão CNPJ).
5. Para similaridade de nomes: 100 = idêntico, 80+ = mesmo nome com variações menores, <60 = pessoas diferentes.
6. phase_type deve ser: "monofasico", "bifasico" ou "trifasico" (baseado na classe de tensão da conta).
7. document_type_detected deve ser: "rg", "cnh", "cnpj", "contrato_social", "purchase_order", "energy_bill", "outro".
8. unexpected_document = true se o documento de identidade enviado NÃO for RG, CNH ou Cartão CNPJ.
9. NOME DO TITULAR NO DOCUMENTO DE IDENTIDADE — atenção máxima:
   - RG/CNH contêm VÁRIOS nomes. O titular é SEMPRE o campo "NOME" (o nome do
     portador do documento), NUNCA a "FILIAÇÃO" / "NOME DO PAI" / "NOME DA MÃE".
   - Em CNH, o nome do titular fica logo após o rótulo "NOME"; a filiação vem
     abaixo, rotulada "FILIAÇÃO" (dois nomes: pai e mãe). Ignore a filiação.
   - Em RG, o titular é o campo "NOME"; ignore "FILIAÇÃO"/"PAI"/"MÃE".
   - Em Cartão CNPJ, o titular é a "RAZÃO SOCIAL" / "NOME EMPRESARIAL".
   - Se houver dúvida entre nome do portador e filiação, prefira o que estiver
     rotulado como "NOME" e reduza a confiança.

Retorne APENAS JSON válido sem markdown, no formato exato:
{
  "holder_name": { "value": "...", "confidence": 95, "source": "energy_bill" },
  "cpf_cnpj": { "value": "...", "confidence": 88, "source": "rg" },
  "address": { "value": "Rua das Flores", "confidence": 90, "source": "energy_bill" },
  "address_number": { "value": "123", "confidence": 85, "source": "energy_bill" },
  "neighborhood": { "value": "Centro", "confidence": 80, "source": "energy_bill" },
  "city": { "value": "São Paulo", "confidence": 97, "source": "energy_bill" },
  "state": { "value": "SP", "confidence": 99, "source": "energy_bill" },
  "cep": { "value": "01310-100", "confidence": 70, "source": "energy_bill" },
  "uc_number": { "value": "7001234567", "confidence": 91, "source": "energy_bill" },
  "phase_type": { "value": "bifasico", "confidence": 85, "source": "energy_bill" },
  "concessionaire_hint": { "value": "CPFL Energia", "confidence": 94, "source": "energy_bill" },
  "inverter_brand": { "value": null, "confidence": 0, "source": "" },
  "inverter_model": { "value": null, "confidence": 0, "source": "" },
  "inverter_power": { "value": null, "confidence": 0, "source": "" },
  "inverter_quantity": { "value": null, "confidence": 0, "source": "" },
  "module_brand": { "value": null, "confidence": 0, "source": "" },
  "module_model": { "value": null, "confidence": 0, "source": "" },
  "module_power": { "value": null, "confidence": 0, "source": "" },
  "module_quantity": { "value": null, "confidence": 0, "source": "" },
  "circuit_breaker_current": { "value": null, "confidence": 0, "source": "" },
  "document_types_detected": ["energy_bill", "rg"],
  "title_comparison": {
    "energy_bill_name": "João da Silva",
    "document_name": "João da Silva",
    "document_type_detected": "rg",
    "match": true,
    "similarity": 100,
    "unexpected_document": false
  }
}`
}

function buildComparePrompt(): string {
  return `Você é o Claudinho Verifica. Analise os documentos recebidos e compare o nome do titular.

TAREFA: Identificar o nome do titular na CONTA DE ENERGIA e o nome no DOCUMENTO DE IDENTIDADE.

REGRAS:
1. document_type_detected: "rg", "cnh", "cnpj", "contrato_social" ou "outro"
2. unexpected_document = true se NÃO for RG, CNH ou Cartão CNPJ
3. similarity 0-100: 100=idêntico, 80+=mesmo nome com variação menor, <60=pessoas diferentes
4. match = true se similarity >= 75
5. O nome no documento de identidade é o campo "NOME" (o portador), NUNCA a
   "FILIAÇÃO"/"NOME DO PAI"/"NOME DA MÃE". Em CNH a filiação vem logo abaixo do
   nome — ignore-a. Em Cartão CNPJ, use a "RAZÃO SOCIAL".

Retorne APENAS JSON válido sem markdown:
{
  "energy_bill_name": "Nome exato da conta de energia",
  "document_name": "Nome exato do documento",
  "document_type_detected": "rg",
  "match": true,
  "similarity": 95,
  "unexpected_document": false
}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildContentBlock(doc: DocumentInput, index: number) {
  // PDFs são enviados como documento nativo; imagens como image block
  if (doc.mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: doc.base64,
      },
    }
  }

  // Para imagens, garantir mime type válido
  const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const mediaType = validImageTypes.includes(doc.mimeType) ? doc.mimeType : 'image/jpeg'

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data: doc.base64,
    },
  }
}

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
    const body: AnalyzeRequest = await req.json()
    const { mode, documents } = body

    if (!documents || documents.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Nenhum documento enviado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Cota de IA por tenant ────────────────────────────────────────────────
    // consume_ai_quota valida o plano do tenant do usuário logado e registra
    // o consumo. Sem usuário logado → sem cota → recusa.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Login necessário para usar o Claudinho' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: quota, error: quotaError } = await userClient
      .rpc('consume_ai_quota', { _kind: mode === 'analyze' ? 'claudinho_analyze' : 'claudinho_compare' })
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
      return new Response(JSON.stringify({ ok: false, error: msg, quota }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Monta o array de conteúdo multimodal para o Claude
    const contentBlocks: any[] = documents.map((doc, i) => buildContentBlock(doc, i))

    // Adiciona o prompt de instrução no final
    const promptText = mode === 'analyze' ? buildAnalyzePrompt() : buildComparePrompt()
    contentBlocks.push({ type: 'text', text: promptText })

    const model = 'claude-haiku-4-5-20251001' // confirmado funcionando neste projeto

    const maxTokens = mode === 'analyze' ? 2000 : 400

    const hasPdf = documents.some(d => d.mimeType === 'application/pdf')
    const claudeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
    if (hasPdf) claudeHeaders['anthropic-beta'] = 'pdfs-2024-09-25'

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: claudeHeaders,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
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
      // Extrai JSON mesmo se vier com texto extra
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
    } catch {
      console.error('Failed to parse Claude response:', rawText)
      return new Response(JSON.stringify({ ok: false, error: 'Não foi possível interpretar os documentos' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (mode === 'compare') {
      return new Response(JSON.stringify({
        ok: true,
        mode: 'compare',
        title_comparison: {
          energy_bill_name: parsed.energy_bill_name ?? null,
          document_name: parsed.document_name ?? null,
          document_type_detected: parsed.document_type_detected ?? 'outro',
          match: parsed.match ?? false,
          similarity: parsed.similarity ?? 0,
          unexpected_document: parsed.unexpected_document ?? false,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // mode === 'analyze'
    const response: AnalyzeResponse = {
      ok: true,
      mode: 'analyze',
      holder_name: parsed.holder_name,
      cpf_cnpj: parsed.cpf_cnpj,
      address: parsed.address,
      address_number: parsed.address_number,
      neighborhood: parsed.neighborhood,
      city: parsed.city,
      state: parsed.state,
      cep: parsed.cep,
      uc_number: parsed.uc_number,
      phase_type: parsed.phase_type,
      concessionaire_hint: parsed.concessionaire_hint,
      inverter_brand: parsed.inverter_brand,
      inverter_model: parsed.inverter_model,
      inverter_power: parsed.inverter_power,
      inverter_quantity: parsed.inverter_quantity,
      module_brand: parsed.module_brand,
      module_model: parsed.module_model,
      module_power: parsed.module_power,
      module_quantity: parsed.module_quantity,
      circuit_breaker_current: parsed.circuit_breaker_current,
      document_types_detected: parsed.document_types_detected ?? [],
      title_comparison: parsed.title_comparison,
    }

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

import { ImapFlow } from 'npm:imapflow'
import { simpleParser } from 'npm:mailparser'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── TIPOS ─────────────────────────────────────────────────────────────────────

interface AttachmentAnalysis {
  summary: string
  classification: string
  confidence: number
  extractedText?: string
}

interface EmailAnalysis {
  summary: string
  classification: string
  suggestedStatus: string | null
  confidence: number
  reasoning: string
}

// ── ENTRADA ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPA_SERVICE_ROLE_KEY')!
  )

  try {
    // 1. Buscar configuração do agente
    const { data: config } = await supabase
      .from('agent_config')
      .select('*')
      .eq('config_key', 'email_agent')
      .maybeSingle()

    const EMAIL        = config?.gmail_email        || Deno.env.get('GMAIL_USER_EMAIL')
    const APP_PASSWORD = config?.gmail_app_password || Deno.env.get('GMAIL_APP_PASSWORD')

    if (!EMAIL || !APP_PASSWORD) {
      return new Response(
        JSON.stringify({ error: 'Email ou App Password não configurado. Acesse /email-updates → Configurar.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (config && !config.is_active) {
      return new Response(
        JSON.stringify({ error: 'Agente inativo' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Iniciar scan run
    const { data: scanRun } = await supabase
      .from('email_scan_runs')
      .insert({ status: 'running' })
      .select()
      .single()

    if (!scanRun) throw new Error('Falha ao criar scan run')

    // 3. Buscar projetos com protocolo ativo
    const { data: projects } = await supabase
      .from('projects')
      .select('id, code, protocol_number, status')
      .not('protocol_number', 'is', null)
      .not('status', 'in', '("completed","finalizado")')
      .eq('is_deleted', false)

    const protocols = (projects || [])
      .filter(p =>
        p.protocol_number &&
        !p.protocol_number.toLowerCase().includes('sem protocolo')
      )
      .map(p => ({
        projectId: p.id,
        code:      p.code,
        protocol:  p.protocol_number!,
        status:    p.status,
      }))

    // 4. Conectar via IMAP com App Password
    const client = new ImapFlow({
      host:   'imap.gmail.com',
      port:   993,
      secure: true,
      auth: {
        user: EMAIL,
        pass: APP_PASSWORD.replace(/\s+/g, ''), // remove espaços do app password
      },
      logger: false,
    })

    await client.connect()

    let totalFound            = 0
    let totalAttachments      = 0
    const counts              = { approved: 0, rejected: 0, pending: 0, inspection: 0 }
    let globalAttachmentCount = 0
    const MAX_SCAN_ATTACHMENTS = 20

    const lock = await client.getMailboxLock('INBOX')

    try {
      const since = new Date()
      since.setDate(since.getDate() - 3)

      // 5. Para cada protocolo, buscar emails
      for (const proj of protocols) {
        let uids: number[] = []

        try {
          uids = (await client.search(
            { since, subject: proj.protocol },
            { uid: true }
          )) as number[]
        } catch {
          continue
        }

        if (!uids || uids.length === 0) continue

        for await (const msg of client.fetch(
          uids,
          { uid: true, envelope: true, source: true },
          { uid: true }
        )) {
          const messageId = (msg.envelope?.messageId || `imap-uid-${msg.uid}`).trim()

          // Verificar duplicata
          const { data: existing } = await supabase
            .from('email_updates')
            .select('id')
            .eq('gmail_message_id', messageId)
            .maybeSingle()

          if (existing) continue

          // Parsear email
          let parsed: any
          try {
            parsed = await simpleParser(msg.source as any)
          } catch {
            continue
          }

          const bodyText   = (parsed.text || '').replace(/\s+/g, ' ').trim().substring(0, 3000)
          const subject    = parsed.subject    || '(sem assunto)'
          const sender     = parsed.from?.text || 'desconhecido'
          const receivedAt = parsed.date?.toISOString() || new Date().toISOString()

          // Analisar corpo com Claude
          const bodyAnalysis = await analyzeEmailBody(bodyText, proj.protocol, subject)

          // Salvar email_update
          const { data: savedUpdate } = await supabase
            .from('email_updates')
            .insert({
              gmail_message_id:    messageId,
              subject,
              sender,
              received_at:         receivedAt,
              email_body:          bodyText,
              project_id:          proj.projectId,
              protocol_number:     proj.protocol,
              ai_summary:          bodyAnalysis.summary,
              ai_classification:   bodyAnalysis.classification,
              ai_suggested_status: bodyAnalysis.suggestedStatus,
              ai_confidence:       bodyAnalysis.confidence,
              ai_reasoning:        bodyAnalysis.reasoning,
              status:              'pending',
              scan_run_id:         scanRun.id,
            })
            .select()
            .single()

          if (!savedUpdate) continue
          totalFound++

          // ── PROCESSAR ANEXOS ──────────────────────────────────────────────

          const supportedAtts = (parsed.attachments || [])
            .filter((a: any) =>
              a.contentType === 'application/pdf' ||
              a.contentType?.startsWith('image/')
            )
            .slice(0, 5) // Max 5 por email

          let bestAttConfidence     = 0
          let bestAttClassification: string | null = null
          let bestAttSummary        = ''
          let processedCount        = 0

          for (const att of supportedAtts) {
            if (globalAttachmentCount >= MAX_SCAN_ATTACHMENTS) {
              console.warn('Limite de anexos por varredura atingido')
              break
            }

            try {
              const base64   = (att.content as any).toString('base64')
              const analysis = await analyzeAttachment(base64, att.contentType, att.filename || 'documento', proj.protocol)

              await supabase
                .from('email_attachments')
                .insert({
                  email_update_id:     savedUpdate.id,
                  filename:            att.filename || 'documento',
                  mime_type:           att.contentType,
                  size_bytes:          att.size || 0,
                  gmail_attachment_id: `imap-${msg.uid}-${processedCount}`,
                  extracted_text:      analysis.extractedText || null,
                  ai_summary:          analysis.summary,
                  ai_classification:   analysis.classification,
                  ai_confidence:       analysis.confidence,
                  processing_status:   'processed',
                })

              if (analysis.confidence > bestAttConfidence && analysis.classification !== 'unknown') {
                bestAttConfidence     = analysis.confidence
                bestAttClassification = analysis.classification
                bestAttSummary        = analysis.summary
              }

              processedCount++
              globalAttachmentCount++
              totalAttachments++

            } catch (e: any) {
              await supabase
                .from('email_attachments')
                .insert({
                  email_update_id:     savedUpdate.id,
                  filename:            att.filename || 'documento',
                  mime_type:           att.contentType,
                  size_bytes:          att.size || 0,
                  gmail_attachment_id: `imap-${msg.uid}-${processedCount}`,
                  processing_status:   'failed',
                  processing_error:    e.message,
                })
            }
          }

          // ── CONSOLIDAR ANÁLISE ────────────────────────────────────────────

          const finalClassification =
            bestAttClassification && bestAttConfidence >= 70
              ? bestAttClassification
              : bodyAnalysis.classification

          const finalSummary =
            bestAttClassification && bestAttConfidence >= 70
              ? `[Email] ${bodyAnalysis.summary}\n\n[Anexo: ${supportedAtts[0]?.filename || 'documento'}] ${bestAttSummary}`
              : bodyAnalysis.summary

          const finalStatus = getSuggestedStatus(finalClassification)

          await supabase
            .from('email_updates')
            .update({
              attachments_count:         supportedAtts.length,
              attachments_processed:     processedCount,
              attachments_summary:       bestAttSummary || null,
              attachment_classification: bestAttClassification,
              ai_classification:         finalClassification,
              ai_summary:                finalSummary,
              ai_suggested_status:       finalStatus,
              ai_confidence:             bestAttConfidence >= 70 ? bestAttConfidence : bodyAnalysis.confidence,
            })
            .eq('id', savedUpdate.id)

          const cl = finalClassification as keyof typeof counts
          if (cl in counts) counts[cl]++
        }
      }
    } finally {
      lock.release()
      await client.logout()
    }

    // 6. Finalizar scan run
    await supabase
      .from('email_scan_runs')
      .update({
        finished_at:           new Date().toISOString(),
        emails_analyzed:       protocols.length,
        projects_found:        totalFound,
        approved_count:        counts.approved,
        rejected_count:        counts.rejected,
        pending_count:         counts.pending,
        inspection_count:      counts.inspection,
        attachments_processed: totalAttachments,
        status:                'completed',
      })
      .eq('id', scanRun.id)

    // 7. Notificar admin/staff se achou novidades
    if (totalFound > 0) {
      const { data: staff } = await supabase
        .from('profiles')
        .select('id')
        .in('role', ['admin', 'staff'])

      for (const member of staff || []) {
        await supabase
          .from('notifications')
          .insert({
            user_id:    member.id,
            title:      '📧 Varredura de emails concluída',
            message:    `${totalFound} atualização(ões): ${counts.approved} aprovação(ões), ${counts.rejected} reprovação(ões), ${counts.pending} pendência(s). ${totalAttachments} anexo(s) analisado(s).`,
            type:       'email_scan',
            project_id: null,
            read:       false,
          })
      }
    }

    return new Response(
      JSON.stringify({ ok: true, found: totalFound, attachments: totalAttachments }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Scan error:', error)

    try {
      const supabase2 = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPA_SERVICE_ROLE_KEY')!
      )
      await supabase2
        .from('email_scan_runs')
        .update({ status: 'error', error_message: error.message, finished_at: new Date().toISOString() })
        .eq('status', 'running')
    } catch (_) { /* silent */ }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── ANALISAR CORPO DO EMAIL ───────────────────────────────────────────────────

async function analyzeEmailBody(
  body: string,
  protocol: string,
  subject: string
): Promise<EmailAnalysis> {
  const prompt = `Você é especialista em homologação fotovoltaica no Brasil.

Analise o email referente ao protocolo "${protocol}".

ASSUNTO: ${subject}
CORPO: ${body || '(corpo vazio)'}

Retorne APENAS JSON válido sem markdown:
{
  "summary": "Resumo em 2-3 frases em português claro para o gestor",
  "classification": "approved|rejected|pending|inspection|informational|unknown",
  "suggestedStatus": "status sugerido ou null",
  "confidence": 0-100,
  "reasoning": "explicação breve"
}

CLASSIFICAÇÃO:
- approved: DEFERIDO, APROVADO, LIBERADO, AUTORIZADO, CONEXÃO LIBERADA, PARECER FAVORÁVEL
- rejected: INDEFERIDO, REPROVADO, EXIGÊNCIA, PENDÊNCIA TÉCNICA, DIVERGÊNCIA, NÃO APROVADO, REQUISITO
- pending: DOCUMENTAÇÃO PENDENTE, AGUARDANDO, FALTA, COMPLEMENTAR, PRAZO
- inspection: VISTORIA, INSPEÇÃO, AGENDAMENTO, VISITA TÉCNICA
- informational: confirmação de recebimento, atualização de prazo, acuse de recebimento
- unknown: não conseguiu classificar

suggestedStatus (usar exatamente estes valores de status_key):
- approved → "approved"
- rejected → "pendencia"
- pending → "pendencia"
- inspection → "vistoria_solicitada"
- demais → null

Se confidence < 60 use classification "unknown" e suggestedStatus null.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    const data   = await res.json()
    const text   = data.content?.[0]?.text || '{}'
    const parsed = JSON.parse(text)
    return {
      summary:         parsed.summary         || 'Análise indisponível.',
      classification:  parsed.classification  || 'unknown',
      suggestedStatus: parsed.suggestedStatus || null,
      confidence:      parsed.confidence      || 0,
      reasoning:       parsed.reasoning       || '',
    }
  } catch {
    return { summary: 'Não foi possível analisar o email.', classification: 'unknown', suggestedStatus: null, confidence: 0, reasoning: 'Erro ao processar.' }
  }
}

// ── ANALISAR ANEXO ────────────────────────────────────────────────────────────

async function analyzeAttachment(
  base64Data: string,
  mimeType: string,
  filename: string,
  protocol: string
): Promise<AttachmentAnalysis> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!

  if (mimeType === 'application/pdf') {
    const extracted = extractTextFromPdf(base64Data)
    if (extracted.length >= 100) {
      return await analyzePdfAsText(extracted, filename, protocol, apiKey)
    } else {
      return await analyzePdfWithVision(base64Data, filename, protocol, apiKey)
    }
  }

  return await analyzeImageWithVision(base64Data, mimeType, filename, protocol, apiKey)
}

function extractTextFromPdf(base64Data: string): string {
  try {
    const binary = atob(base64Data)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const texts: string[] = []
    const btRegex = /BT([\s\S]*?)ET/g
    let match
    while ((match = btRegex.exec(text)) !== null) {
      const strRegex = /\(([^)]{1,200})\)/g
      let strMatch
      while ((strMatch = strRegex.exec(match[1])) !== null) {
        const s = strMatch[1].replace(/\\n/g, ' ').replace(/\\r/g, ' ').trim()
        if (s.length > 2) texts.push(s)
      }
    }
    return texts.join(' ').replace(/\s+/g, ' ').trim().substring(0, 4000)
  } catch { return '' }
}

async function analyzePdfAsText(text: string, filename: string, protocol: string, apiKey: string): Promise<AttachmentAnalysis> {
  const prompt = `Analise o documento referente ao protocolo "${protocol}".\nArquivo: ${filename}\n\nCONTEÚDO:\n${text}\n\nRetorne APENAS JSON válido:\n{"summary":"resumo 2-3 frases","classification":"approved|rejected|pending|inspection|informational|unknown","confidence":0-100}\n\napproved: DEFERIDO, APROVADO, LIBERADO\nrejected: INDEFERIDO, REPROVADO, EXIGÊNCIA\npending: AGUARDANDO, COMPLEMENTAR\ninspection: VISTORIA, INSPEÇÃO`
  try {
    const res    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }) })
    const data   = await res.json()
    const parsed = JSON.parse(data.content?.[0]?.text || '{}')
    return { summary: parsed.summary || '', classification: parsed.classification || 'unknown', confidence: parsed.confidence || 0, extractedText: text.substring(0, 500) }
  } catch { return { summary: 'Erro ao analisar PDF', classification: 'unknown', confidence: 0 } }
}

async function analyzePdfWithVision(base64Data: string, filename: string, protocol: string, apiKey: string): Promise<AttachmentAnalysis> {
  try {
    const res    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'pdfs-2024-09-25' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }, { type: 'text', text: `Protocolo: "${protocol}"\nArquivo: ${filename}\n\nRetorne APENAS JSON:\n{"summary":"resumo","classification":"approved|rejected|pending|inspection|informational|unknown","confidence":0-100}` }] }] }) })
    const data   = await res.json()
    const parsed = JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim())
    return { summary: parsed.summary || '', classification: parsed.classification || 'unknown', confidence: parsed.confidence || 0 }
  } catch { return { summary: 'PDF não interpretado', classification: 'unknown', confidence: 0 } }
}

async function analyzeImageWithVision(base64Data: string, mimeType: string, filename: string, protocol: string, apiKey: string): Promise<AttachmentAnalysis> {
  try {
    const res    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } }, { type: 'text', text: `Imagem do protocolo "${protocol}" (${filename}).\nRetorne APENAS JSON:\n{"summary":"O que aparece em 2-3 frases","classification":"approved|rejected|pending|inspection|informational|unknown","confidence":0-100}\napproved: DEFERIDO, APROVADO\nrejected: INDEFERIDO, REPROVADO, EXIGÊNCIA\nSe ilegível: unknown` }] }] }) })
    const data   = await res.json()
    const parsed = JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim())
    return { summary: parsed.summary || '', classification: parsed.classification || 'unknown', confidence: parsed.confidence || 0 }
  } catch { return { summary: 'Imagem não interpretada', classification: 'unknown', confidence: 0 } }
}

function getSuggestedStatus(classification: string): string | null {
  const map: Record<string, string> = {
    approved:   'approved',
    rejected:   'pendencia',
    pending:    'pendencia',
    inspection: 'vistoria_solicitada',
  }
  return map[classification] || null
}

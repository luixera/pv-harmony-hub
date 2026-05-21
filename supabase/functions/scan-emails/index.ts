import { ImapFlow } from 'npm:imapflow'
import { simpleParser } from 'npm:mailparser'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── TIPOS ─────────────────────────────────────────────────────────────────────

interface ProjectItem {
  projectId: string
  code: string
  protocol: string
  status: string
  concessionaireId: string | null
}

interface ConcessionaireItem {
  id: string
  name: string
}

interface ParsedEmail {
  messageId: string
  subject: string
  sender: string
  receivedAt: string
  bodyText: string
  attachments: any[]
}

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
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPA_SERVICE_ROLE_KEY')!
  )

  try {
    // 1. Verificar configuração
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

    // 3. Carregar projetos com protocolo
    const { data: rawProjects } = await supabase
      .from('projects')
      .select('id, code, protocol_number, status, concessionaire_id')
      .not('protocol_number', 'is', null)
      .not('status', 'in', '("completed","finalizado")')
      .eq('is_deleted', false)

    const protocols: ProjectItem[] = (rawProjects || [])
      .filter(p => p.protocol_number && !p.protocol_number.toLowerCase().includes('sem protocolo'))
      .map(p => ({
        projectId:        p.id,
        code:             p.code,
        protocol:         p.protocol_number!,
        status:           p.status,
        concessionaireId: p.concessionaire_id || null,
      }))

    // 4. Carregar concessionárias ativas
    const { data: rawConc } = await supabase
      .from('energy_concessionaires')
      .select('id, name')
      .eq('is_active', true)

    const concessionaires: ConcessionaireItem[] = (rawConc || [])
      .map(c => ({ id: c.id, name: c.name }))

    // Mapa rápido concessionaireId → name
    const concMap = new Map(concessionaires.map(c => [c.id, c.name]))

    // 5. Conectar via IMAP
    const client = new ImapFlow({
      host:   'imap.gmail.com',
      port:   993,
      secure: true,
      auth: { user: EMAIL, pass: APP_PASSWORD.replace(/\s+/g, '') },
      logger: false,
    })
    await client.connect()

    // Contadores globais
    let totalFound            = 0
    let totalAttachments      = 0
    const counts              = { approved: 0, rejected: 0, pending: 0, inspection: 0 }
    let globalAttachmentCount = 0
    const MAX_SCAN_ATTACHMENTS = 20
    const MAX_EMAILS_PER_CONC  = 8

    // Set de messageIds já processados nesta sessão (evita duplicata entre as duas buscas)
    const processedIds = new Set<string>()

    const lock = await client.getMailboxLock('INBOX')
    const since = new Date()
    since.setDate(since.getDate() - 3)

    try {
      // ════════════════════════════════════════════════════════════════════
      // FASE 1 — Busca por número de protocolo (comportamento original)
      // ════════════════════════════════════════════════════════════════════

      for (const proj of protocols) {
        let uids: number[] = []
        try {
          uids = (await client.search({ since, subject: proj.protocol }, { uid: true })) as number[]
        } catch { continue }
        if (!uids || uids.length === 0) continue

        for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
          const messageId = (msg.envelope?.messageId || `imap-uid-${msg.uid}`).trim()

          const { data: existing } = await supabase
            .from('email_updates').select('id, match_type, project_id').eq('gmail_message_id', messageId).maybeSingle()

          if (existing) {
            processedIds.add(messageId)
            // Se já existe mas estava sem vínculo de protocolo (ex: veio de concessionária antes),
            // atualiza para refletir o protocolo agora vinculado
            if (!existing.project_id || existing.match_type === 'concessionaire') {
              const concName = proj.concessionaireId ? (concMap.get(proj.concessionaireId) || null) : null
              await supabase.from('email_updates').update({
                project_id:          proj.projectId,
                protocol_number:     proj.protocol,
                concessionaire_id:   proj.concessionaireId,
                concessionaire_name: concName,
                protocol_matched:    true,
                match_type:          existing.match_type === 'concessionaire' ? 'both' : 'protocol',
              }).eq('id', existing.id)
            }
            continue
          }
          if (processedIds.has(messageId)) continue
          processedIds.add(messageId)

          let parsed: any
          try { parsed = await simpleParser(msg.source as any) } catch { continue }

          const email = extractParsed(parsed, msg.uid)
          const concName = proj.concessionaireId ? (concMap.get(proj.concessionaireId) || null) : null

          const bodyAnalysis = await analyzeEmailBody(email.bodyText, proj.protocol, email.subject)

          const { data: savedUpdate } = await supabase.from('email_updates').insert({
            gmail_message_id:    messageId,
            subject:             email.subject,
            sender:              email.sender,
            received_at:         email.receivedAt,
            email_body:          email.bodyText,
            project_id:          proj.projectId,
            protocol_number:     proj.protocol,
            concessionaire_id:   proj.concessionaireId,
            concessionaire_name: concName,
            protocol_matched:    true,
            match_type:          'protocol',
            ai_summary:          bodyAnalysis.summary,
            ai_classification:   bodyAnalysis.classification,
            ai_suggested_status: bodyAnalysis.suggestedStatus,
            ai_confidence:       bodyAnalysis.confidence,
            ai_reasoning:        bodyAnalysis.reasoning,
            status:              'pending',
            scan_run_id:         scanRun.id,
          }).select().single()

          if (!savedUpdate) continue
          totalFound++

          const { processed, bestConf, bestClass, bestSummary } =
            await processAttachments(supabase, email.attachments, savedUpdate.id, msg.uid, proj.protocol, globalAttachmentCount, MAX_SCAN_ATTACHMENTS)

          globalAttachmentCount += processed
          totalAttachments      += processed

          await consolidateUpdate(supabase, savedUpdate.id, bodyAnalysis, bestConf, bestClass, bestSummary, email.attachments)
          const cl = (bestConf >= 70 && bestClass ? bestClass : bodyAnalysis.classification) as keyof typeof counts
          if (cl in counts) counts[cl]++
        }
      }

      // ════════════════════════════════════════════════════════════════════
      // FASE 2 — Busca por remetente das concessionárias (com body + PDF)
      // ════════════════════════════════════════════════════════════════════

      for (const conc of concessionaires) {
        const fromTerm = `@${conc.name.toLowerCase()}`

        let uids: number[] = []
        try {
          uids = (await client.search({ since, from: fromTerm }, { uid: true })) as number[]
        } catch { continue }
        if (!uids || uids.length === 0) continue

        // Limite menor na Fase 2 para controlar tempo total
        if (uids.length > MAX_EMAILS_PER_CONC) uids = uids.slice(-MAX_EMAILS_PER_CONC)

        for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
          const messageId = (msg.envelope?.messageId || `imap-uid-${msg.uid}`).trim()

          // Já processado na Fase 1 → só atualiza concessionária
          if (processedIds.has(messageId)) {
            await supabase.from('email_updates')
              .update({ concessionaire_id: conc.id, concessionaire_name: conc.name, match_type: 'both' })
              .eq('gmail_message_id', messageId)
            continue
          }

          // Já existe no banco → atualiza concessionária
          const { data: existing } = await supabase
            .from('email_updates').select('id, match_type').eq('gmail_message_id', messageId).maybeSingle()

          if (existing) {
            processedIds.add(messageId)
            await supabase.from('email_updates')
              .update({
                concessionaire_id:   conc.id,
                concessionaire_name: conc.name,
                match_type: existing.match_type === 'protocol' ? 'both' : existing.match_type,
              })
              .eq('gmail_message_id', messageId)
            continue
          }

          processedIds.add(messageId)

          let parsed: any
          try { parsed = await simpleParser(msg.source as any) } catch { continue }

          const email = extractParsed(parsed, msg.uid)

          // Busca protocolo no ASSUNTO + CORPO (CEMIG coloca o número no texto do email)
          const fullText = `${email.subject} ${email.bodyText}`.toLowerCase()
          let matchedProj: ProjectItem | null = null
          for (const proj of protocols) {
            if (fullText.includes(proj.protocol.toLowerCase())) {
              matchedProj = proj
              break
            }
          }

          // Só chama Claude se encontrou protocolo — evita timeout
          let bodyAnalysis: EmailAnalysis | null = matchedProj
            ? await analyzeEmailBody(email.bodyText, matchedProj.protocol, email.subject)
            : null

          const { data: savedUpdate } = await supabase.from('email_updates').insert({
            gmail_message_id:    messageId,
            subject:             email.subject,
            sender:              email.sender,
            received_at:         email.receivedAt,
            email_body:          email.bodyText || null,
            project_id:          matchedProj?.projectId || null,
            protocol_number:     matchedProj?.protocol  || null,
            concessionaire_id:   conc.id,
            concessionaire_name: conc.name,
            protocol_matched:    !!matchedProj,
            match_type:          'concessionaire',
            ai_summary:          bodyAnalysis?.summary          || null,
            ai_classification:   bodyAnalysis?.classification   || 'unknown',
            ai_suggested_status: bodyAnalysis?.suggestedStatus  || null,
            ai_confidence:       bodyAnalysis?.confidence       || 0,
            ai_reasoning:        bodyAnalysis?.reasoning        || null,
            status:              'pending',
            scan_run_id:         scanRun.id,
          }).select().single()

          if (!savedUpdate) continue
          totalFound++

          // Processa PDF/imagem apenas quando há protocolo vinculado
          if (matchedProj && email.attachments.length > 0 && bodyAnalysis) {
            const { processed, bestConf, bestClass, bestSummary } =
              await processAttachments(supabase, email.attachments, savedUpdate.id, msg.uid, matchedProj.protocol, globalAttachmentCount, MAX_SCAN_ATTACHMENTS)
            globalAttachmentCount += processed
            totalAttachments      += processed
            await consolidateUpdate(supabase, savedUpdate.id, bodyAnalysis, bestConf, bestClass, bestSummary, email.attachments)
            const cl = (bestConf >= 70 && bestClass ? bestClass : bodyAnalysis.classification) as keyof typeof counts
            if (cl in counts) counts[cl]++
          }
        }
      }

    } finally {
      lock.release()
      await client.logout()
    }

    // 6. Finalizar scan run
    await supabase.from('email_scan_runs').update({
      finished_at:           new Date().toISOString(),
      emails_analyzed:       protocols.length + concessionaires.length,
      projects_found:        totalFound,
      approved_count:        counts.approved,
      rejected_count:        counts.rejected,
      pending_count:         counts.pending,
      inspection_count:      counts.inspection,
      attachments_processed: totalAttachments,
      status:                'completed',
    }).eq('id', scanRun.id)

    // 7. Notificações
    if (totalFound > 0) {
      const { data: staff } = await supabase.from('profiles').select('id').in('role', ['admin', 'staff'])
      for (const member of staff || []) {
        await supabase.from('notifications').insert({
          user_id:    member.id,
          title:      '📧 Claudinho dos Emails — varredura concluída',
          message:    `${totalFound} atualização(ões) encontrada(s): ${counts.approved} aprovação(ões), ${counts.rejected} reprovação(ões), ${counts.pending} pendência(s). ${totalAttachments} anexo(s) analisado(s).`,
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
      const s2 = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPA_SERVICE_ROLE_KEY')!)
      await s2.from('email_scan_runs')
        .update({ status: 'error', error_message: error.message, finished_at: new Date().toISOString() })
        .eq('status', 'running')
    } catch (_) {}
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

// ── HELPERS ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

function extractParsed(parsed: any, uid: number): { messageId: string; subject: string; sender: string; receivedAt: string; bodyText: string; attachments: any[] } {
  // Muitas concessionárias enviam emails HTML-only — fallback para parsed.html com strip de tags
  let bodyText = (parsed.text || '').replace(/\s+/g, ' ').trim()
  if (!bodyText && parsed.html) {
    bodyText = stripHtml(parsed.html)
  }
  return {
    messageId:   `imap-uid-${uid}`,
    subject:     parsed.subject    || '(sem assunto)',
    sender:      parsed.from?.text || 'desconhecido',
    receivedAt:  parsed.date?.toISOString() || new Date().toISOString(),
    bodyText:    bodyText.substring(0, 3000),
    attachments: (parsed.attachments || []).filter((a: any) =>
      a.contentType === 'application/pdf' || a.contentType?.startsWith('image/')
    ).slice(0, 5),
  }
}

async function processAttachments(
  supabase: any,
  attachments: any[],
  updateId: string,
  uid: number,
  protocol: string,
  globalCount: number,
  maxCount: number
): Promise<{ processed: number; bestConf: number; bestClass: string | null; bestSummary: string }> {
  let processed = 0, bestConf = 0
  let bestClass: string | null = null, bestSummary = ''

  for (const att of attachments) {
    if (globalCount + processed >= maxCount) { console.warn('Limite de anexos atingido'); break }
    try {
      const base64   = (att.content as any).toString('base64')
      const analysis = await analyzeAttachment(base64, att.contentType, att.filename || 'documento', protocol)
      await supabase.from('email_attachments').insert({
        email_update_id:     updateId,
        filename:            att.filename || 'documento',
        mime_type:           att.contentType,
        size_bytes:          att.size || 0,
        gmail_attachment_id: `imap-${uid}-${processed}`,
        extracted_text:      analysis.extractedText || null,
        ai_summary:          analysis.summary,
        ai_classification:   analysis.classification,
        ai_confidence:       analysis.confidence,
        processing_status:   'processed',
      })
      if (analysis.confidence > bestConf && analysis.classification !== 'unknown') {
        bestConf = analysis.confidence; bestClass = analysis.classification; bestSummary = analysis.summary
      }
      processed++
    } catch (e: any) {
      await supabase.from('email_attachments').insert({
        email_update_id:     updateId,
        filename:            att.filename || 'documento',
        mime_type:           att.contentType,
        size_bytes:          att.size || 0,
        gmail_attachment_id: `imap-${uid}-${processed}`,
        processing_status:   'failed',
        processing_error:    e.message,
      })
    }
  }
  return { processed, bestConf, bestClass, bestSummary }
}

async function consolidateUpdate(
  supabase: any,
  updateId: string,
  bodyAnalysis: EmailAnalysis,
  bestConf: number,
  bestClass: string | null,
  bestSummary: string,
  attachments: any[]
) {
  const usesAtt           = bestClass && bestConf >= 70
  const finalClassification = usesAtt ? bestClass! : bodyAnalysis.classification
  const finalSummary        = usesAtt
    ? `[Email] ${bodyAnalysis.summary}\n\n[Anexo: ${attachments[0]?.filename || 'documento'}] ${bestSummary}`
    : bodyAnalysis.summary

  await supabase.from('email_updates').update({
    attachments_count:         attachments.length,
    attachments_processed:     attachments.length,
    attachments_summary:       bestSummary || null,
    attachment_classification: bestClass,
    ai_classification:         finalClassification,
    ai_summary:                finalSummary,
    ai_suggested_status:       getSuggestedStatus(finalClassification),
    ai_confidence:             usesAtt ? bestConf : bodyAnalysis.confidence,
  }).eq('id', updateId)
}

// ── ANÁLISE CLAUDE ────────────────────────────────────────────────────────────

async function analyzeEmailBody(body: string, context: string, subject: string): Promise<EmailAnalysis> {
  const prompt = `Você é especialista em homologação fotovoltaica no Brasil.

Analise o email referente a: "${context}".

ASSUNTO: ${subject}
CORPO: ${body || '(corpo vazio)'}

Retorne APENAS JSON válido sem markdown:
{
  "summary": "Resumo em 2-3 frases em português claro para o gestor",
  "classification": "approved|rejected|pending|inspection|informational|unknown",
  "suggestedStatus": "approved|pendencia|vistoria_solicitada|null",
  "confidence": 0-100,
  "reasoning": "explicação breve"
}

approved: DEFERIDO, APROVADO, LIBERADO, AUTORIZADO, CONEXÃO LIBERADA, PARECER FAVORÁVEL
rejected: INDEFERIDO, REPROVADO, EXIGÊNCIA, PENDÊNCIA TÉCNICA, DIVERGÊNCIA, NÃO APROVADO
pending: DOCUMENTAÇÃO PENDENTE, AGUARDANDO, FALTA, COMPLEMENTAR, PRAZO
inspection: VISTORIA, INSPEÇÃO, AGENDAMENTO, VISITA TÉCNICA
informational: confirmação de recebimento, atualização de prazo, acuse de recebimento
unknown: não conseguiu classificar

suggestedStatus: approved→"approved", rejected→"pendencia", pending→"pendencia", inspection→"vistoria_solicitada", demais→null
Se confidence < 60 use unknown e null.`

  try {
    const res    = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    })
    const data   = await res.json()
    const parsed = JSON.parse(data.content?.[0]?.text || '{}')
    return {
      summary:         parsed.summary         || 'Análise indisponível.',
      classification:  parsed.classification  || 'unknown',
      suggestedStatus: parsed.suggestedStatus || null,
      confidence:      parsed.confidence      || 0,
      reasoning:       parsed.reasoning       || '',
    }
  } catch {
    return { summary: 'Não foi possível analisar o email.', classification: 'unknown', suggestedStatus: null, confidence: 0, reasoning: 'Erro.' }
  }
}

async function analyzeAttachment(base64Data: string, mimeType: string, filename: string, protocol: string): Promise<AttachmentAnalysis> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!
  if (mimeType === 'application/pdf') {
    const extracted = extractTextFromPdf(base64Data)
    if (extracted.length >= 100) return await analyzePdfAsText(extracted, filename, protocol, apiKey)
    return await analyzePdfWithVision(base64Data, filename, protocol, apiKey)
  }
  return await analyzeImageWithVision(base64Data, mimeType, filename, protocol, apiKey)
}

function extractTextFromPdf(b64: string): string {
  try {
    const bin = atob(b64), bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const texts: string[] = []
    const btRx = /BT([\s\S]*?)ET/g; let m
    while ((m = btRx.exec(text)) !== null) {
      const sRx = /\(([^)]{1,200})\)/g; let s
      while ((s = sRx.exec(m[1])) !== null) {
        const t = s[1].replace(/\\n/g, ' ').replace(/\\r/g, ' ').trim()
        if (t.length > 2) texts.push(t)
      }
    }
    return texts.join(' ').replace(/\s+/g, ' ').trim().substring(0, 4000)
  } catch { return '' }
}

async function analyzePdfAsText(text: string, filename: string, protocol: string, apiKey: string): Promise<AttachmentAnalysis> {
  try {
    const res    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: `Analise o documento referente a "${protocol}".\nArquivo: ${filename}\n\nCONTEÚDO:\n${text}\n\nRetorne APENAS JSON: {"summary":"resumo 2-3 frases","classification":"approved|rejected|pending|inspection|informational|unknown","confidence":0-100}` }] }) })
    const data   = await res.json()
    const parsed = JSON.parse(data.content?.[0]?.text || '{}')
    return { summary: parsed.summary || '', classification: parsed.classification || 'unknown', confidence: parsed.confidence || 0, extractedText: text.substring(0, 500) }
  } catch { return { summary: 'Erro ao analisar PDF', classification: 'unknown', confidence: 0 } }
}

async function analyzePdfWithVision(b64: string, filename: string, protocol: string, apiKey: string): Promise<AttachmentAnalysis> {
  try {
    const res    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'pdfs-2024-09-25' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: `Protocolo: "${protocol}"\nArquivo: ${filename}\n\nRetorne APENAS JSON: {"summary":"resumo","classification":"approved|rejected|pending|inspection|informational|unknown","confidence":0-100}` }] }] }) })
    const data   = await res.json()
    const parsed = JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim())
    return { summary: parsed.summary || '', classification: parsed.classification || 'unknown', confidence: parsed.confidence || 0 }
  } catch { return { summary: 'PDF não interpretado', classification: 'unknown', confidence: 0 } }
}

async function analyzeImageWithVision(b64: string, mimeType: string, filename: string, protocol: string, apiKey: string): Promise<AttachmentAnalysis> {
  try {
    const res    = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } }, { type: 'text', text: `Imagem relacionada a "${protocol}" (${filename}).\nRetorne APENAS JSON: {"summary":"O que aparece","classification":"approved|rejected|pending|inspection|informational|unknown","confidence":0-100}\napproved: DEFERIDO, APROVADO\nrejected: INDEFERIDO, REPROVADO\nSe ilegível: unknown` }] }] }) })
    const data   = await res.json()
    const parsed = JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim())
    return { summary: parsed.summary || '', classification: parsed.classification || 'unknown', confidence: parsed.confidence || 0 }
  } catch { return { summary: 'Imagem não interpretada', classification: 'unknown', confidence: 0 } }
}

function getSuggestedStatus(cl: string): string | null {
  return ({ approved: 'approved', rejected: 'pendencia', pending: 'pendencia', inspection: 'vistoria_solicitada' } as Record<string,string>)[cl] || null
}

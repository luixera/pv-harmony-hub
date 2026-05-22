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

interface EmailAnalysis {
  summary: string
  classification: string
  suggestedStatus: string | null
  confidence: number
  reasoning: string
}

interface AttachmentAnalysis {
  summary: string
  classification: string
  confidence: number
  extractedText?: string
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

    // 2. Limpar varreduras travadas (>2 min — budget de execução é 90s)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    await supabase.from('email_scan_runs')
      .update({ status: 'error', error_message: 'Timeout — worker limit excedido', finished_at: new Date().toISOString() })
      .eq('status', 'running')
      .lt('started_at', twoMinAgo)

    // 3. Iniciar scan run
    const { data: scanRun } = await supabase
      .from('email_scan_runs')
      .insert({ status: 'running' })
      .select()
      .single()
    if (!scanRun) throw new Error('Falha ao criar scan run')

    const SCAN_START    = Date.now()
    const SCAN_BUDGET_MS = 85_000
    const isOverBudget  = () => Date.now() - SCAN_START > SCAN_BUDGET_MS

    // 4. Carregar concessionárias ativas
    const { data: rawConc } = await supabase
      .from('energy_concessionaires')
      .select('id, name')
      .eq('is_active', true)

    const concessionaires: ConcessionaireItem[] = (rawConc || []).map(c => ({ id: c.id, name: c.name }))
    if (concessionaires.length === 0) {
      await finalizeScan(supabase, scanRun.id, 'completed', 0, 0, 0, {})
      return new Response(JSON.stringify({ ok: true, collected: 0, processed: 0 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ════════════════════════════════════════════════════════════════════
    // ETAPA 1 — Coleta via IMAP (remetente + corpo, sem IA)
    // ════════════════════════════════════════════════════════════════════

    const client = new ImapFlow({
      host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: EMAIL, pass: APP_PASSWORD.replace(/\s+/g, '') },
      logger: false,
    })
    await client.connect()

    let collected = 0
    const since   = new Date()
    since.setDate(since.getDate() - 3) // janela de 3 dias

    const lock = await client.getMailboxLock('INBOX')
    try {
      for (const conc of concessionaires) {
        if (isOverBudget()) { console.log('Budget atingido na coleta'); break }

        // Termo de busca: primeiro segmento do nome da concessionária como domínio
        const fromTerm = conc.name.toLowerCase().split(' ')[0]

        let uids: number[] = []
        try {
          uids = (await client.search({ since, from: fromTerm }, { uid: true })) as number[]
        } catch { continue }
        if (!uids || uids.length === 0) continue

        // Passo 1: envelopes para filtrar duplicatas sem baixar body
        const needsSource: Array<{ uid: number; messageId: string }> = []
        for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          const messageId = (msg.envelope?.messageId || `imap-uid-${msg.uid}`).trim()

          const { data: existing } = await supabase
            .from('email_updates')
            .select('id')
            .eq('gmail_message_id', messageId)
            .maybeSingle()

          if (existing) continue // já está no banco
          needsSource.push({ uid: msg.uid, messageId })
        }

        if (needsSource.length === 0) continue

        // Passo 2: baixa source (body) apenas para emails novos
        const newUids = needsSource.map(n => n.uid)
        for await (const msg of client.fetch(newUids, { uid: true, envelope: true, source: true }, { uid: true })) {
          if (isOverBudget()) { console.log('Budget atingido no download de bodies'); break }

          const messageId = (msg.envelope?.messageId || `imap-uid-${msg.uid}`).trim()
          let parsed: any
          try { parsed = await simpleParser(msg.source as any) } catch { continue }

          const email = extractParsed(parsed, msg.uid)

          // Salva metadados + corpo — sem protocolo, sem IA
          await supabase.from('email_updates').insert({
            gmail_message_id:    messageId,
            subject:             email.subject,
            sender:              email.sender,
            received_at:         email.receivedAt,
            email_body:          email.bodyText,
            concessionaire_id:   conc.id,
            concessionaire_name: conc.name,
            protocol_matched:    false,
            match_type:          'concessionaire',
            ai_classification:   'unknown',
            ai_confidence:       0,
            status:              'pending',
            scan_run_id:         scanRun.id,
          })
          collected++
        }
      }
    } finally {
      lock.release()
      await client.logout()
    }

    console.log(`Etapa 1 concluída: ${collected} emails novos coletados`)

    // ════════════════════════════════════════════════════════════════════
    // ETAPA 2 — Matching via SQL + IA apenas nos emails vinculados
    // ════════════════════════════════════════════════════════════════════

    // Matching roda inteiramente no Postgres — sem loop JS, sem risco de timeout
    const { data: matchedRows, error: matchErr } = await supabase.rpc('match_emails_to_protocols')
    if (matchErr) console.error('Erro no matching SQL:', matchErr.message)

    let processed        = matchedRows?.length ?? 0
    let matched          = 0
    let totalAttachments = 0
    const counts         = { approved: 0, rejected: 0, pending: 0, inspection: 0 }

    // Classificação IA apenas para emails recém-vinculados
    for (const row of (matchedRows || [])) {
      if (isOverBudget()) { console.log('Budget atingido na classificacao IA'); break }

      const bodyAnalysis = await analyzeEmailBody(
        row.email_body || '',
        row.protocol_number,
        row.subject || ''
      )

      await supabase.from('email_updates').update({
        ai_summary:          bodyAnalysis.summary,
        ai_classification:   bodyAnalysis.classification,
        ai_suggested_status: bodyAnalysis.suggestedStatus,
        ai_confidence:       bodyAnalysis.confidence,
        ai_reasoning:        bodyAnalysis.reasoning,
      }).eq('id', row.email_update_id)

      matched++
      const cl = bodyAnalysis.classification as keyof typeof counts
      if (cl in counts) counts[cl]++
    }

    console.log(`Etapa 2: ${processed} vinculados pelo SQL, ${matched} classificados pela IA`)

    // 5. Finalizar scan run
    const scanStatus = isOverBudget() ? 'timeout' : 'completed'
    await finalizeScan(supabase, scanRun.id, scanStatus, collected, matched, totalAttachments, counts)

    // 6. Notificação se encontrou novos matches
    if (matched > 0) {
      const { data: staff } = await supabase.from('profiles').select('id').in('role', ['admin', 'staff'])
      for (const member of staff || []) {
        await supabase.from('notifications').insert({
          user_id:    member.id,
          title:      '📧 Claudinho dos Emails — varredura concluída',
          message:    `${matched} protocolo(s) vinculado(s): ${counts.approved} aprovação(ões), ${counts.rejected} reprovação(ões), ${counts.pending} pendência(s).`,
          type:       'email_scan',
          project_id: null,
          read:       false,
        })
      }
    }

    return new Response(
      JSON.stringify({ ok: true, collected, processed, matched }),
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

async function finalizeScan(
  supabase: any, id: string, status: string,
  collected: number, matched: number, attachments: number,
  counts: Record<string, number>
) {
  await supabase.from('email_scan_runs').update({
    finished_at:           new Date().toISOString(),
    emails_analyzed:       collected,
    projects_found:        matched,
    approved_count:        counts.approved  || 0,
    rejected_count:        counts.rejected  || 0,
    pending_count:         counts.pending   || 0,
    inspection_count:      counts.inspection || 0,
    attachments_processed: attachments,
    status,
  }).eq('id', id)
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

function extractParsed(parsed: any, uid: number) {
  let bodyText = (parsed.text || '').replace(/\s+/g, ' ').trim()
  if (!bodyText && parsed.html) bodyText = stripHtml(parsed.html)
  return {
    messageId:   `imap-uid-${uid}`,
    subject:     parsed.subject    || '(sem assunto)',
    sender:      parsed.from?.text || 'desconhecido',
    receivedAt:  parsed.date?.toISOString() || new Date().toISOString(),
    bodyText:    bodyText.substring(0, 5000),
  }
}

// ── ANÁLISE CLAUDE ────────────────────────────────────────────────────────────

async function analyzeEmailBody(body: string, protocol: string, subject: string): Promise<EmailAnalysis> {
  const prompt = `Você é especialista em homologação fotovoltaica no Brasil.

Analise o email referente ao protocolo: "${protocol}".

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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
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
    return { summary: 'Não foi possível analisar.', classification: 'unknown', suggestedStatus: null, confidence: 0, reasoning: 'Erro.' }
  }
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

function getSuggestedStatus(cl: string): string | null {
  return ({ approved: 'approved', rejected: 'pendencia', pending: 'pendencia', inspection: 'vistoria_solicitada' } as Record<string, string>)[cl] || null
}

import { ImapFlow } from 'npm:imapflow'
import { simpleParser } from 'npm:mailparser'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConcessionaireItem { id: string; name: string }
interface EmailAnalysis {
  summary: string; classification: string
  suggestedStatus: string | null; confidence: number; reasoning: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPA_SERVICE_ROLE_KEY')!
  )

  try {
    // 1. Verificar configuração
    const { data: config } = await supabase
      .from('agent_config').select('*').eq('config_key', 'email_agent').maybeSingle()

    const EMAIL        = config?.gmail_email        || Deno.env.get('GMAIL_USER_EMAIL')
    const APP_PASSWORD = config?.gmail_app_password || Deno.env.get('GMAIL_APP_PASSWORD')

    if (!EMAIL || !APP_PASSWORD) {
      return new Response(
        JSON.stringify({ error: 'Email ou App Password não configurado.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (config && !config.is_active) {
      return new Response(
        JSON.stringify({ error: 'Agente inativo' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Tenant dono desta varredura (multi-tenant): vem da config do agente.
    // Fallback: tenant mais antigo (GD Manager) para config legada sem tenant.
    let tenantId: string | null = config?.tenant_id ?? null
    if (!tenantId) {
      const { data: t } = await supabase.from('tenants')
        .select('id').order('created_at', { ascending: true }).limit(1).single()
      tenantId = t?.id ?? null
    }

    // 2. Limpar varreduras travadas >2 min
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    await supabase.from('email_scan_runs')
      .update({ status: 'error', error_message: 'Timeout', finished_at: new Date().toISOString() })
      .eq('status', 'running').lt('started_at', twoMinAgo)

    // 3. Criar scan run
    const { data: scanRun } = await supabase
      .from('email_scan_runs').insert({ status: 'running', tenant_id: tenantId }).select().single()
    if (!scanRun) throw new Error('Falha ao criar scan run')

    const SCAN_START     = Date.now()
    const SCAN_BUDGET_MS = 85_000
    const isOverBudget   = () => Date.now() - SCAN_START > SCAN_BUDGET_MS

    // ════════════════════════════════════════════════════════════════════
    // ETAPA 1 — Matching SQL + IA (roda PRIMEIRO, antes do IMAP)
    // Garante correlação mesmo que o IMAP dê 546
    // ════════════════════════════════════════════════════════════════════

    const { data: matchedRows, error: matchErr } = await supabase.rpc('match_emails_to_protocols')
    if (matchErr) console.error('Erro no matching SQL:', matchErr.message)

    let matched = 0
    const counts = { approved: 0, rejected: 0, pending: 0, inspection: 0 }

    for (const row of (matchedRows || [])) {
      if (isOverBudget()) { console.log('Budget atingido na IA'); break }
      const ai = await analyzeEmailBody(row.email_body || '', row.protocol_number, row.subject || '')
      await supabase.from('email_updates').update({
        ai_summary: ai.summary, ai_classification: ai.classification,
        ai_suggested_status: ai.suggestedStatus, ai_confidence: ai.confidence, ai_reasoning: ai.reasoning,
      }).eq('id', row.email_update_id)
      matched++
      const cl = ai.classification as keyof typeof counts
      if (cl in counts) counts[cl]++
    }

    console.log(`Matching: ${matchedRows?.length ?? 0} vinculados, ${matched} com IA`)

    // ════════════════════════════════════════════════════════════════════
    // ETAPA 2 — Coleta IMAP: salva emails novos (metadados + corpo)
    // Após a coleta, ETAPA 3 faz matching imediato dos recém-salvos
    // ════════════════════════════════════════════════════════════════════

    const { data: rawConc } = await supabase
      .from('energy_concessionaires').select('id, name').eq('is_active', true)
    const concessionaires: ConcessionaireItem[] = (rawConc || []).map(c => ({ id: c.id, name: c.name }))

    let collected = 0

    if (concessionaires.length > 0 && !isOverBudget()) {
      const client = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: EMAIL, pass: APP_PASSWORD.replace(/\s+/g, '') },
        logger: false,
      })
      await client.connect()

      const since = new Date()
      since.setDate(since.getDate() - 3)

      const lock = await client.getMailboxLock('INBOX')
      try {
        for (const conc of concessionaires) {
          if (isOverBudget()) { console.log('Budget atingido na coleta'); break }

          const fromTerm = conc.name.toLowerCase().split(' ')[0]
          let uids: number[] = []
          try {
            uids = (await client.search({ since, from: fromTerm }, { uid: true })) as number[]
          } catch { continue }
          if (!uids || uids.length === 0) continue

          // Passo 1: envelopes — filtra duplicatas sem baixar body
          const needsSource: Array<{ uid: number; messageId: string }> = []
          for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
            const messageId = (msg.envelope?.messageId || `imap-uid-${msg.uid}`).trim()
            const { data: existing } = await supabase
              .from('email_updates').select('id').eq('gmail_message_id', messageId).maybeSingle()
            if (existing) continue
            needsSource.push({ uid: msg.uid, messageId })
          }

          if (needsSource.length === 0) continue

          // Passo 2: baixa body apenas para emails novos
          const newUids = needsSource.map(n => n.uid)
          for await (const msg of client.fetch(newUids, { uid: true, envelope: true, source: true }, { uid: true })) {
            if (isOverBudget()) { console.log('Budget atingido no download'); break }

            const messageId = (msg.envelope?.messageId || `imap-uid-${msg.uid}`).trim()
            let parsed: any
            try { parsed = await simpleParser(msg.source as any) } catch { continue }

            const email = extractParsed(parsed)
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
              tenant_id:           tenantId,
            })
            collected++
          }
        }
      } finally {
        lock.release()
        await client.logout()
      }
    }

    console.log(`Coleta IMAP: ${collected} emails novos`)

    // ════════════════════════════════════════════════════════════════════
    // ETAPA 3 — 2ª passada de matching: correlaciona emails recém-salvos
    // Garante que "Varrer agora" relaciona os novos emails no mesmo ciclo
    // ════════════════════════════════════════════════════════════════════

    if (collected > 0 && !isOverBudget()) {
      const { data: newMatchedRows, error: matchErr2 } = await supabase.rpc('match_emails_to_protocols')
      if (matchErr2) console.error('Erro no matching pós-coleta:', matchErr2.message)

      for (const row of (newMatchedRows || [])) {
        if (isOverBudget()) { console.log('Budget atingido na IA pós-coleta'); break }
        const ai = await analyzeEmailBody(row.email_body || '', row.protocol_number, row.subject || '')
        await supabase.from('email_updates').update({
          ai_summary: ai.summary, ai_classification: ai.classification,
          ai_suggested_status: ai.suggestedStatus, ai_confidence: ai.confidence, ai_reasoning: ai.reasoning,
        }).eq('id', row.email_update_id)
        matched++
        const cl = ai.classification as keyof typeof counts
        if (cl in counts) counts[cl]++
      }

      console.log(`Correlação pós-coleta: ${newMatchedRows?.length ?? 0} novos vínculos`)
    }

    // 4. Finalizar
    const scanStatus = isOverBudget() ? 'timeout' : 'completed'
    await supabase.from('email_scan_runs').update({
      finished_at:      new Date().toISOString(),
      emails_analyzed:  collected,
      projects_found:   matched,
      approved_count:   counts.approved   || 0,
      rejected_count:   counts.rejected   || 0,
      pending_count:    counts.pending    || 0,
      inspection_count: counts.inspection || 0,
      status:           scanStatus,
    }).eq('id', scanRun.id)

    // 5. Notificações
    if (matched > 0) {
      // Notifica apenas admin/staff do tenant dono da varredura
      const { data: staff } = await supabase.from('profiles').select('id')
        .in('role', ['admin', 'staff']).eq('tenant_id', tenantId)
      for (const member of staff || []) {
        await supabase.from('notifications').insert({
          user_id: member.id,
          title:   '📧 Claudinho dos Emails — varredura concluída',
          message: `${matched} protocolo(s) vinculado(s): ${counts.approved} aprovação(ões), ${counts.rejected} reprovação(ões), ${counts.pending} pendência(s).`,
          type: 'email_scan', project_id: null, read: false,
          tenant_id: tenantId,
        })
      }
    }

    return new Response(
      JSON.stringify({ ok: true, collected, matched }),
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

function extractParsed(parsed: any) {
  // Sempre usa texto puro; se vazio, extrai do HTML (sem tags)
  let bodyText = (parsed.text || '').replace(/\s+/g, ' ').trim()
  const htmlText = parsed.html ? stripHtml(parsed.html) : ''
  // Usa HTML extraído se for mais informativo que o texto puro
  if (htmlText.length > bodyText.length) bodyText = htmlText
  return {
    subject:    parsed.subject    || '(sem assunto)',
    sender:     parsed.from?.text || 'desconhecido',
    receivedAt: parsed.date?.toISOString() || new Date().toISOString(),
    bodyText:   bodyText.substring(0, 5000),
  }
}

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

approved: DEFERIDO, APROVADO, LIBERADO, AUTORIZADO, CONEXÃO LIBERADA, PARECER FAVORÁVEL, PARECER DE ACESSO SEM OBRAS, documentação aprovada
rejected: INDEFERIDO, REPROVADO, EXIGÊNCIA, PENDÊNCIA TÉCNICA, DIVERGÊNCIA, NÃO APROVADO, INDEFERIMENTO
pending: DOCUMENTAÇÃO PENDENTE, AGUARDANDO, FALTA, COMPLEMENTAR, PRAZO, em análise
inspection: VISTORIA, INSPEÇÃO, AGENDAMENTO, VISITA TÉCNICA
informational: confirmação de recebimento, pedido cadastrado, acuse de recebimento
unknown: não conseguiu classificar

suggestedStatus: approved→"approved", rejected→"pendencia", pending→"pendencia", inspection→"vistoria_solicitada", demais→null
Se confidence < 60 use unknown e null.`

  try {
    const res  = await fetch('https://api.anthropic.com/v1/messages', {
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

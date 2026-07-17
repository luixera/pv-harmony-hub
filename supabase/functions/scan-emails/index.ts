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

  // Cada tenant tem a PRÓPRIA caixa de e-mail e a própria config. A varredura
  // roda uma vez por tenant configurado, sem misturar dados entre eles.
  // Body opcional { tenantId } limita a varredura a um tenant (botão "Varrer agora").
  let onlyTenantId: string | null = null
  try {
    const body = await req.json()
    onlyTenantId = body?.tenantId ?? null
  } catch { /* sem body: varre todos */ }

  try {
    let q = supabase.from('agent_config').select('*').eq('config_key', 'email_agent').eq('is_active', true)
    if (onlyTenantId) q = q.eq('tenant_id', onlyTenantId)
    const { data: configs, error: cfgErr } = await q
    if (cfgErr) throw cfgErr

    const ativos = (configs ?? []).filter(c => c.tenant_id && c.gmail_email && c.gmail_app_password)
    if (ativos.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum agente de e-mail ativo e configurado.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Limpa varreduras travadas >2 min (de qualquer tenant)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    await supabase.from('email_scan_runs')
      .update({ status: 'error', error_message: 'Timeout', finished_at: new Date().toISOString() })
      .eq('status', 'running').lt('started_at', twoMinAgo)

    const SCAN_START     = Date.now()
    const SCAN_BUDGET_MS = 85_000
    const isOverBudget   = () => Date.now() - SCAN_START > SCAN_BUDGET_MS

    const resumo: { tenantId: string; collected: number; matched: number; error?: string }[] = []

    for (const config of ativos) {
      if (isOverBudget()) { console.log('Budget global atingido — tenants restantes ficam para a próxima'); break }
      try {
        const r = await scanTenant(supabase, config, isOverBudget)
        resumo.push({ tenantId: config.tenant_id, ...r })
      } catch (e) {
        console.error('Falha na varredura do tenant', config.tenant_id, e)
        resumo.push({ tenantId: config.tenant_id, collected: 0, matched: 0, error: String((e as Error)?.message ?? e) })
      }
    }

    return new Response(
      JSON.stringify({ ok: true, tenants: resumo.length, resumo }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Scan error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

/** Varre a caixa de UM tenant. Tudo aqui é escopado ao tenant da config. */
async function scanTenant(
  supabase: any,
  config: any,
  isOverBudget: () => boolean,
): Promise<{ collected: number; matched: number }> {
  const tenantId     = config.tenant_id as string
  const EMAIL        = config.gmail_email as string
  const APP_PASSWORD = config.gmail_app_password as string

  const { data: scanRun } = await supabase
    .from('email_scan_runs').insert({ status: 'running', tenant_id: tenantId }).select().single()
  if (!scanRun) throw new Error('Falha ao criar scan run')

  try {

    // ════════════════════════════════════════════════════════════════════
    // ETAPA 1 — Matching SQL + IA (roda PRIMEIRO, antes do IMAP)
    // Garante correlação mesmo que o IMAP dê 546
    // ════════════════════════════════════════════════════════════════════

    const { data: matchedRows, error: matchErr } = await supabase
      .rpc('match_emails_to_protocols', { _tenant_id: tenantId })
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

    // Somente as concessionárias DESTE tenant (o service_role ignora o RLS)
    const { data: rawConc } = await supabase
      .from('energy_concessionaires').select('id, name')
      .eq('is_active', true).eq('tenant_id', tenantId)
    const concessionaires: ConcessionaireItem[] = (rawConc || []).map((c: any) => ({ id: c.id, name: c.name }))

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
            // Deduplica DENTRO do tenant: o mesmo e-mail da concessionária pode
            // chegar para vários tenants e cada um precisa do seu registro.
            const { data: existing } = await supabase
              .from('email_updates').select('id')
              .eq('gmail_message_id', messageId).eq('tenant_id', tenantId).maybeSingle()
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
      const { data: newMatchedRows, error: matchErr2 } = await supabase
        .rpc('match_emails_to_protocols', { _tenant_id: tenantId })
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

    return { collected, matched }

  } catch (error: any) {
    console.error('Scan error (tenant ' + tenantId + '):', error)
    // Marca como erro APENAS a varredura deste tenant
    await supabase.from('email_scan_runs')
      .update({ status: 'error', error_message: error.message, finished_at: new Date().toISOString() })
      .eq('id', scanRun.id)
    throw error
  }
}

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

/**
 * notify-dispatch — motor de automações (canal-agnóstico; canal atual: e-mail).
 * Recebe { projectId, event } e dispara as regras habilitadas do tenant para
 * aquele evento. Também aceita { test: { to, subject, body }, projectId } para
 * enviar um teste. Envio de e-mail via Resend.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── valores do projeto para as variáveis do template ──────────────────────────
async function buildValues(projectId: string): Promise<{ values: Record<string, string>; tenantId: string | null }> {
  const { data: p } = await admin.from('projects')
    .select('*, companies:company_id(name, tenant_id), energy_concessionaires:concessionaire_id(name)')
    .eq('id', projectId).maybeSingle()
  if (!p) return { values: {}, tenantId: null }
  const [{ data: g }, { data: e }] = await Promise.all([
    admin.from('project_general_data').select('*').eq('project_id', projectId).maybeSingle(),
    admin.from('project_equipment').select('*').eq('project_id', projectId).maybeSingle(),
  ])
  const company = (p.companies as { name?: string; tenant_id?: string } | null) ?? {}
  const values: Record<string, string> = {
    codigo: p.code ?? '', empresa: company.name ?? '',
    concessionaria: (p.energy_concessionaires as { name?: string } | null)?.name ?? g?.utility_company ?? '',
    titular: g?.holder_name ?? '', cpf_cnpj: g?.holder_cpf_cnpj ?? '',
    email: g?.holder_email ?? '', telefone: g?.holder_phone ?? '',
    endereco: g?.address ?? '', cidade: g?.city ?? '', uf: g?.state ?? '',
    uc: g?.uc_number ?? '', disjuntor: g?.circuit_breaker_current ?? '', fase: g?.phase_type ?? '',
    marca_inversor: e?.inverter_brand ?? '', modelo_inversor: e?.inverter_model ?? '',
    marca_modulo: e?.module_brand ?? '', modelo_modulo: e?.module_model ?? '',
    potencia_total: e?.total_installed_power != null ? `${e.total_installed_power} kWp` : '',
    data: new Date().toLocaleDateString('pt-BR'),
    status: p.status ?? '',
  }
  return { values, tenantId: company.tenant_id ?? p.tenant_id ?? null }
}

const render = (tpl: string, v: Record<string, string>) =>
  (tpl ?? '').replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('NOTIFY_FROM') || 'GD Manager <onboarding@resend.dev>'
  if (!key) return { ok: false, error: 'RESEND_API_KEY não configurada' }
  const recipients = to.split(',').map(s => s.trim()).filter(Boolean)
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: recipients, subject, html }),
  })
  if (!resp.ok) { const t = await resp.text(); return { ok: false, error: `Resend ${resp.status}: ${t}` } }
  return { ok: true }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const body = await req.json()

    // ── Envio de teste ──────────────────────────────────────────────────────
    if (body.test) {
      const { to, subject, body: tplBody } = body.test
      let values: Record<string, string> = {}
      if (body.projectId) values = (await buildValues(body.projectId)).values
      const html = render(tplBody, values).replace(/\n/g, '<br>')
      const r = await sendEmail(to, render(subject ?? 'Teste de automação', values), html)
      return json(r.ok ? { ok: true } : { ok: false, error: r.error }, r.ok ? 200 : 502)
    }

    // ── Disparo por evento ──────────────────────────────────────────────────
    const { projectId, event } = body
    if (!projectId || !event) return json({ error: 'projectId e event obrigatórios' }, 400)

    const { values, tenantId } = await buildValues(projectId)
    if (!tenantId) return json({ ok: true, skipped: 'sem tenant' })

    // Recurso liberado no plano?
    const { data: tenant } = await admin.from('tenants').select('plan_id, plans:plan_id(features)').eq('id', tenantId).maybeSingle()
    const features = (tenant?.plans as { features?: Record<string, boolean> } | null)?.features ?? {}
    if (features.automations !== true) return json({ ok: true, skipped: 'plano sem automações' })

    let q = admin.from('notification_rules').select('*')
      .eq('tenant_id', tenantId).eq('event', event).eq('enabled', true)
    const { data: rules } = await q
    if (!rules || rules.length === 0) return json({ ok: true, sent: 0 })

    let sent = 0
    for (const rule of rules) {
      // filtro de status (para status_changed)
      if (rule.status_filter && rule.status_filter !== values.status) continue
      if (rule.channel !== 'email') continue  // outros canais: futuro
      const subject = render(rule.subject ?? 'Aviso de projeto', values)
      const html = render(rule.body, values).replace(/\n/g, '<br>')
      const r = await sendEmail(rule.destination, subject, html)
      await admin.from('automation_log').insert({
        tenant_id: tenantId, rule_id: rule.id, project_id: projectId,
        channel: 'email', destination: rule.destination,
        status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error,
      })
      if (r.ok) sent++
    }
    return json({ ok: true, sent })
  } catch (e) {
    console.error('notify-dispatch', e)
    return json({ error: 'erro interno' }, 500)
  }
})

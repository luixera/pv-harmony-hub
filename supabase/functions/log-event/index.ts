/**
 * log-event — recebe eventos de observabilidade do frontend e do CI.
 *
 * Precisa aceitar chamadas NÃO autenticadas: o caso mais importante é o login
 * que falhou, quando ainda não existe sessão. Por isso a função é fechada por
 * uma lista de ações permitidas + limite por IP, e o IP/user-agent são lidos
 * dos headers (nunca do corpo, que o cliente controla).
 *
 * Deploys vêm do GitHub Actions e exigem o segredo DEPLOY_LOG_TOKEN.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEPLOY_LOG_TOKEN
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-deploy-token',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Só estas ações podem ser gravadas por quem não está autenticado. */
const ACOES_PUBLICAS: Record<string, { kind: string; severity: string }> = {
  login_failed:        { kind: 'security', severity: 'warning' },
  frontend_error:      { kind: 'error',    severity: 'error' },
  frontend_crash:      { kind: 'error',    severity: 'critical' },
  forbidden_access:    { kind: 'security', severity: 'warning' },
  invalid_form_token:  { kind: 'security', severity: 'warning' },
}

const LIMITE_POR_IP = 60          // eventos
const JANELA_MINUTOS = 10

function corta(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || !v) return null
  return v.slice(0, max)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const action = corta(body.action, 80)
    if (!action) return json({ error: 'ação obrigatória' }, 400)

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || req.headers.get('cf-connecting-ip')
      || null
    const userAgent = req.headers.get('user-agent') ?? null

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Deploy: exige o segredo compartilhado com o GitHub Actions.
    if (action === 'deploy') {
      const token = req.headers.get('x-deploy-token')
      const esperado = Deno.env.get('DEPLOY_LOG_TOKEN')
      if (!esperado || token !== esperado) return json({ error: 'token inválido' }, 403)
      await admin.from('system_events').insert({
        kind: 'deploy', severity: 'info', source: 'ci', action: 'deploy',
        message: corta(body.message, 500), ip, user_agent: userAgent,
        metadata: body.metadata ?? {},
      })
      return json({ ok: true })
    }

    const perfil = ACOES_PUBLICAS[action]
    if (!perfil) return json({ error: 'ação não permitida' }, 403)

    // Freio anti-inundação por IP: protege a tabela de virar vetor de spam.
    if (ip) {
      const desde = new Date(Date.now() - JANELA_MINUTOS * 60_000).toISOString()
      const { count } = await admin.from('system_events')
        .select('id', { count: 'exact', head: true })
        .eq('ip', ip).gte('created_at', desde)
      if ((count ?? 0) >= LIMITE_POR_IP) return json({ ok: true, ignorado: true })
    }

    // Se veio um token válido, aproveita a identidade real do usuário.
    let userId: string | null = null
    let userEmail: string | null = corta(body.user_email, 200)
    let tenantId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      )
      const { data: { user } } = await userClient.auth.getUser()
      if (user) {
        userId = user.id
        userEmail = user.email ?? userEmail
        const { data: p } = await admin.from('profiles')
          .select('tenant_id').eq('id', user.id).maybeSingle()
        tenantId = (p as { tenant_id?: string } | null)?.tenant_id ?? null
      }
    }

    await admin.from('system_events').insert({
      kind: perfil.kind, severity: perfil.severity, source: 'frontend',
      action,
      message: corta(body.message, 1000),
      route: corta(body.route, 300),
      user_id: userId, user_email: userEmail, tenant_id: tenantId,
      ip, user_agent: userAgent,
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
    })

    return json({ ok: true })
  } catch (e) {
    // Nunca propaga erro: registrar log não pode quebrar a tela do usuário.
    console.error('log-event falhou:', e)
    return json({ ok: false }, 200)
  }
})

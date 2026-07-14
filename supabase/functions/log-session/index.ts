/**
 * log-session — registra uma sessão de acesso com IP + geolocalização.
 * Chamada uma vez por login. Resolve o IP do cliente (headers) e a localização
 * aproximada (geo-IP), grava em access_sessions e retorna o session_id.
 *
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'sem auth' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'não autenticado' }, 401)

    const { data: profile } = await userClient.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || req.headers.get('cf-connecting-ip')
      || null
    const userAgent = req.headers.get('user-agent') ?? null

    // Geolocalização aproximada (best-effort, não bloqueia o registro)
    let city: string | null = null, region: string | null = null, country: string | null = null
    if (ip) {
      try {
        const geo = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city`)
        const g = await geo.json()
        if (g.status === 'success') { city = g.city ?? null; region = g.regionName ?? null; country = g.country ?? null }
      } catch (_) { /* ignora falha de geo */ }
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await admin.from('access_sessions').insert({
      user_id: user.id,
      tenant_id: profile?.tenant_id ?? null,
      ip, city, region, country, user_agent: userAgent,
    }).select('id').single()
    if (error) { console.error(error); return json({ error: 'falha ao registrar' }, 500) }

    return json({ sessionId: data.id })
  } catch (e) {
    console.error('log-session', e)
    return json({ error: 'erro interno' }, 500)
  }
})

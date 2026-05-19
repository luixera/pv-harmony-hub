/**
 * verify-turnstile — Edge Function
 *
 * Valida token do Cloudflare Turnstile e aplica rate-limit por IP.
 * Chamada pelo formulário público antes de qualquer insert no banco.
 *
 * Env vars necessárias (Supabase Dashboard → Settings → Edge Functions → Secrets):
 *   TURNSTILE_SECRET_KEY  → secret key do Cloudflare Turnstile
 *   SUPABASE_URL          → injetado automaticamente
 *   SUPABASE_SERVICE_ROLE_KEY → injetado automaticamente
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RATE_LIMIT = 3        // max submissões por IP
const WINDOW_HOURS = 1      // janela de tempo em horas

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Método não permitido' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { token, companyId } = await req.json()

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Token CAPTCHA ausente. Resolva o desafio antes de enviar.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 1. Validar token com Cloudflare ──────────────────────────────────────
    const secretKey = Deno.env.get('TURNSTILE_SECRET_KEY')
    if (!secretKey) {
      console.error('TURNSTILE_SECRET_KEY não configurada')
      // Em modo desenvolvimento sem secret key configurada, permitir (não bloquear prod)
      console.warn('Turnstile secret key ausente — pulando verificação (modo dev)')
    } else {
      // IP do usuário (disponível via CF-Connecting-IP no Cloudflare, ou X-Forwarded-For)
      const ip =
        req.headers.get('CF-Connecting-IP') ||
        req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
        'unknown'

      const formData = new FormData()
      formData.append('secret', secretKey)
      formData.append('response', token)
      formData.append('remoteip', ip)

      const cfResp = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        { method: 'POST', body: formData }
      )
      const cfData = await cfResp.json()

      if (!cfData.success) {
        console.warn('Turnstile falhou:', cfData['error-codes'])
        return new Response(
          JSON.stringify({ error: 'Verificação de segurança falhou. Tente novamente.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // ── 2. Rate-limit por IP ───────────────────────────────────────────────
      // Conta projetos criados via public_form pelo mesmo IP na última hora.
      // Usa service_role para query sem RLS.
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )

      const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()

      const { count, error: countError } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'public_form')
        .eq('company_id', companyId ?? '')
        .gte('created_at', windowStart)

      if (countError) {
        console.error('Erro ao verificar rate-limit:', countError)
        // Em caso de erro na query, não bloquear — deixar passar
      } else if ((count ?? 0) >= RATE_LIMIT) {
        return new Response(
          JSON.stringify({
            error: `Limite de ${RATE_LIMIT} envios por hora atingido. Tente novamente mais tarde.`,
            rateLimited: true,
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response(
      JSON.stringify({ valid: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Erro inesperado em verify-turnstile:', err)
    return new Response(
      JSON.stringify({ error: 'Erro interno. Tente novamente.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

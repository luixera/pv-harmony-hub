/**
 * signup-tenant — Edge Function (autocadastro público self-service)
 *
 * Cria um novo tenant em trial + o primeiro admin, sem intervenção do master.
 * Fluxo:
 *   1. Valida Turnstile (anti-abuso)
 *   2. Garante e-mail único
 *   3. Cria o tenant (status trial, N dias)
 *   4. Cria o admin via service_role (email_confirm: false → confirmação por e-mail)
 *      — a criação via service_role é obrigatória para o handle_new_user
 *        respeitar role='admin' e o tenant_id do metadata.
 *   5. Se a criação do usuário falhar, remove o tenant órfão (rollback).
 *
 * O client, ao receber sucesso, dispara o e-mail de confirmação via
 * supabase.auth.resend({ type: 'signup' }).
 *
 * Secrets: TURNSTILE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TRIAL_DAYS = 14

interface SignupRequest {
  companyName: string
  cnpj?: string
  planSlug: string       // 'basico' | 'pro'
  adminName: string
  adminEmail: string
  adminPassword: string
  turnstileToken?: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const body: SignupRequest = await req.json()
    const { companyName, cnpj, planSlug, adminName, adminEmail, adminPassword, turnstileToken } = body

    // ── Validação de entrada ─────────────────────────────────────────────────
    if (!companyName?.trim() || !adminName?.trim() || !adminEmail?.trim() || !adminPassword) {
      return json({ error: 'Preencha todos os campos obrigatórios.' }, 400)
    }
    if (adminPassword.length < 6) {
      return json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, 400)
    }
    if (!['basico', 'pro'].includes(planSlug)) {
      return json({ error: 'Plano inválido.' }, 400)
    }
    const email = adminEmail.trim().toLowerCase()

    // ── 1. Turnstile ─────────────────────────────────────────────────────────
    const secretKey = Deno.env.get('TURNSTILE_SECRET_KEY')
    if (secretKey) {
      if (!turnstileToken) return json({ error: 'Resolva o desafio de segurança antes de enviar.' }, 400)
      const ip = req.headers.get('CF-Connecting-IP')
        || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'
      const fd = new FormData()
      fd.append('secret', secretKey)
      fd.append('response', turnstileToken)
      fd.append('remoteip', ip)
      const cf = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: fd })
      const cfData = await cf.json()
      if (!cfData.success) return json({ error: 'Verificação de segurança falhou. Tente novamente.' }, 403)
    } else {
      console.warn('TURNSTILE_SECRET_KEY ausente — pulando verificação (dev)')
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // ── 2. E-mail único ──────────────────────────────────────────────────────
    const { data: existing } = await admin
      .from('profiles').select('id').eq('email', email).maybeSingle()
    if (existing) return json({ error: 'Este e-mail já está cadastrado. Faça login.' }, 409)

    // ── 3. Plano + tenant em trial ───────────────────────────────────────────
    const { data: plan, error: planErr } = await admin
      .from('plans').select('id').eq('slug', planSlug).single()
    if (planErr || !plan) return json({ error: 'Plano não encontrado.' }, 400)

    const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString()
    const { data: tenant, error: tErr } = await admin
      .from('tenants')
      .insert({
        name: companyName.trim(),
        cnpj: cnpj?.trim() || null,
        plan_id: plan.id,
        status: 'trial',
        trial_ends_at: trialEnds,
      })
      .select('id')
      .single()
    if (tErr || !tenant) {
      console.error('Erro ao criar tenant:', tErr)
      return json({ error: 'Não foi possível criar a conta. Tente novamente.' }, 500)
    }

    // ── 4. Admin do tenant (não confirmado → confirmação por e-mail) ──────────
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password: adminPassword,
      email_confirm: false,
      user_metadata: {
        name: adminName.trim(),
        role: 'admin',
        tenant_id: tenant.id,
      },
    })

    if (authErr || !authData.user) {
      // Rollback do tenant órfão
      await admin.from('tenants').delete().eq('id', tenant.id)
      console.error('Erro ao criar admin:', authErr)
      const msg = authErr?.message?.includes('already been registered')
        ? 'Este e-mail já está cadastrado. Faça login.'
        : 'Não foi possível criar o usuário. Tente novamente.'
      return json({ error: msg }, 400)
    }

    return json({
      success: true,
      tenantId: tenant.id,
      email,
      trialDays: TRIAL_DAYS,
    })

  } catch (err) {
    console.error('Erro inesperado em signup-tenant:', err)
    return json({ error: 'Erro interno. Tente novamente.' }, 500)
  }
})

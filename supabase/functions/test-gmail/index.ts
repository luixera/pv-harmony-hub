import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { clientId, clientSecret, refreshToken } = await req.json()

    if (!clientId || !clientSecret || !refreshToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'Campos obrigatórios ausentes' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Tentar obter access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()

    if (!tokenData.access_token) {
      await supabase
        .from('agent_config')
        .update({
          last_tested_at:    new Date().toISOString(),
          last_test_success: false,
          last_test_error:   tokenData.error_description || tokenData.error || 'Credenciais inválidas',
        })
        .eq('config_key', 'email_agent')

      return new Response(
        JSON.stringify({ success: false, error: tokenData.error_description || tokenData.error || 'Credenciais inválidas' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Testar acesso ao perfil Gmail
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profile = await profileRes.json()

    if (profile.error) {
      const msg = profile.error.message || 'Acesso ao Gmail negado'
      await supabase
        .from('agent_config')
        .update({ last_tested_at: new Date().toISOString(), last_test_success: false, last_test_error: msg })
        .eq('config_key', 'email_agent')

      return new Response(
        JSON.stringify({ success: false, error: msg }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sucesso — atualizar status no banco
    await supabase
      .from('agent_config')
      .update({
        last_tested_at:    new Date().toISOString(),
        last_test_success: true,
        last_test_error:   null,
      })
      .eq('config_key', 'email_agent')

    return new Response(
      JSON.stringify({
        success:        true,
        emailAddress:   profile.emailAddress,
        messagesTotal:  profile.messagesTotal,
        threadsTotal:   profile.threadsTotal,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('test-gmail error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

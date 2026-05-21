import { ImapFlow } from 'npm:imapflow'
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
    Deno.env.get('SUPA_SERVICE_ROLE_KEY')!
  )

  try {
    const { email, appPassword } = await req.json()

    if (!email || !appPassword) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email e App Password são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Testar conexão IMAP
    const client = new ImapFlow({
      host:   'imap.gmail.com',
      port:   993,
      secure: true,
      auth: {
        user: email.trim(),
        pass: appPassword.replace(/\s+/g, ''),
      },
      logger:           false,
      connectionTimeout: 10000,
    })

    let messagesTotal = 0

    try {
      await client.connect()
      const mailbox = await client.mailboxOpen('INBOX')
      messagesTotal = mailbox.exists || 0
      await client.logout()
    } catch (imapError: any) {
      const msg = imapError.message || 'Falha na conexão IMAP'

      await supabase
        .from('agent_config')
        .update({
          last_tested_at:    new Date().toISOString(),
          last_test_success: false,
          last_test_error:   msg,
        })
        .eq('config_key', 'email_agent')

      return new Response(
        JSON.stringify({ success: false, error: msg }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sucesso
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
        success:       true,
        emailAddress:  email,
        messagesTotal,
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

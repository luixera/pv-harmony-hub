import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateUserRequest {
  email: string
  password: string
  name: string
  role: 'admin' | 'staff' | 'company'
  companyId?: string
  active?: boolean
  tenantId?: string // apenas master pode especificar; admin cria no próprio tenant
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Verify the requesting user is an admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error('No authorization header provided')
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with the user's token to verify they are admin
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Get the current user
    const { data: { user: requestingUser }, error: userError } = await userClient.auth.getUser()
    
    if (userError || !requestingUser) {
      console.error('Error getting user:', userError)
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if the requesting user is an admin (ou master da plataforma)
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role, is_master, tenant_id')
      .eq('id', requestingUser.id)
      .single()

    const isMaster = !!profile?.is_master
    if (profileError || !profile || (profile.role !== 'admin' && !isMaster)) {
      console.error('User is not admin:', profileError)
      return new Response(
        JSON.stringify({ error: 'Apenas administradores podem criar usuários' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the request body
    const { email, password, name, role, companyId, active = true, tenantId }: CreateUserRequest = await req.json()

    // Tenant do novo usuário: master pode escolher; admin cria no próprio tenant
    const targetTenantId = isMaster && tenantId ? tenantId : profile.tenant_id
    if (tenantId && !isMaster && tenantId !== profile.tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Sem permissão para criar usuários em outro tenant' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate required fields
    if (!email || !password || !name || !role) {
      console.error('Missing required fields')
      return new Response(
        JSON.stringify({ error: 'Campos obrigatórios: email, password, name, role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate password length
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'A senha deve ter pelo menos 6 caracteres' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate role
    if (!['admin', 'staff', 'company'].includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Role inválido. Use: admin, staff ou company' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If role is company, companyId is required
    if (role === 'company' && !companyId) {
      return new Response(
        JSON.stringify({ error: 'companyId é obrigatório para usuários do tipo empresa' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Creating user with email:', email, 'role:', role)

    // Create admin client for user creation
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      }
    })

    // 1. Create user in Supabase Auth
    // Note: The handle_new_user trigger will automatically create profile and user_role
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name,
        role,
        company_id: companyId || null, // Pass company_id to trigger
        tenant_id: targetTenantId || null, // handle_new_user usa para o perfil
      }
    })

    if (authError) {
      console.error('Error creating auth user:', authError)
      
      if (authError.message.includes('already been registered')) {
        return new Response(
          JSON.stringify({ error: 'Este email já está cadastrado' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      return new Response(
        JSON.stringify({ error: `Erro ao criar usuário: ${authError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!authData.user) {
      console.error('No user returned from auth.admin.createUser')
      return new Response(
        JSON.stringify({ error: 'Erro ao criar usuário no Auth' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Auth user created with ID:', authData.user.id)

    // 2. The handle_new_user trigger creates profile and user_role automatically
    // We just need to update the profile with company_id and active status if needed
    
    // Wait a moment for the trigger to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // Update profile with company_id and active status (trigger doesn't set these)
    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update({
        company_id: companyId || null,
        active,
      })
      .eq('id', authData.user.id)

    if (profileUpdateError) {
      console.error('Error updating profile:', profileUpdateError)
      // Don't fail - profile was created by trigger, just couldn't update company_id
    }

    console.log('User created successfully:', authData.user.id)

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: authData.user.id,
          email,
          name,
          role,
          companyId,
          active,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

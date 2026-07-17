import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Campos que o admin pode atualizar em um perfil */
const ALLOWED_FIELDS = ['name', 'role', 'company_id', 'active', 'staff_access_mode', 'hide_company_name', 'phone'] as const
type AllowedField = typeof ALLOWED_FIELDS[number]

interface UpdateUserRequest {
  userId: string
  updates: Partial<Record<AllowedField, unknown>>
}

Deno.serve(async (req) => {
  // Handle CORS preflight
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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Verificar token do usuário solicitante
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: requestingUser }, error: userError } = await userClient.auth.getUser()
    if (userError || !requestingUser) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verificar se o solicitante é admin (ou master da plataforma)
    const { data: requesterProfile, error: profileError } = await userClient
      .from('profiles')
      .select('role, is_master, tenant_id')
      .eq('id', requestingUser.id)
      .single()

    const isMaster = !!requesterProfile?.is_master
    if (profileError || !requesterProfile || (requesterProfile.role !== 'admin' && !isMaster)) {
      console.error('Unauthorized update-user attempt by:', requestingUser.id, 'role:', requesterProfile?.role)
      return new Response(
        JSON.stringify({ error: 'Apenas administradores podem atualizar usuários' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse do body
    let body: UpdateUserRequest
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Body inválido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { userId, updates } = body

    if (!userId || !updates || typeof updates !== 'object') {
      return new Response(
        JSON.stringify({ error: 'userId e updates são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Filtrar apenas campos permitidos (whitelist — nunca aceitar campos arbitrários)
    const safeUpdates: Record<string, unknown> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field in updates) {
        safeUpdates[field] = updates[field]
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum campo válido para atualizar' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validações específicas de campo
    if ('role' in safeUpdates) {
      const validRoles = ['admin', 'staff', 'company']
      if (!validRoles.includes(safeUpdates.role as string)) {
        return new Response(
          JSON.stringify({ error: 'Role inválido. Use: admin, staff ou company' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if ('staff_access_mode' in safeUpdates) {
      const validModes = ['global', 'assigned_only']
      if (!validModes.includes(safeUpdates.staff_access_mode as string)) {
        return new Response(
          JSON.stringify({ error: 'staff_access_mode inválido. Use: global ou assigned_only' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Admin client para bypass de RLS (service_role)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Isolamento entre tenants ─────────────────────────────────────────────
    // O adminClient ignora RLS, então o tenant do ALVO precisa ser checado aqui.
    // Sem isso, um admin do tenant A poderia editar um usuário do tenant B.
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('tenant_id')
      .eq('id', userId)
      .maybeSingle()

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: 'Usuário não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!isMaster && targetProfile.tenant_id !== requesterProfile.tenant_id) {
      console.error('Cross-tenant update blocked:', requestingUser.id, '->', userId)
      return new Response(
        JSON.stringify({ error: 'Sem permissão para atualizar usuários de outra empresa' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // A empresa vinculada precisa ser do mesmo tenant do usuário
    if (safeUpdates.company_id) {
      const { data: company } = await adminClient
        .from('companies')
        .select('tenant_id')
        .eq('id', safeUpdates.company_id as string)
        .maybeSingle()
      if (!company || company.tenant_id !== targetProfile.tenant_id) {
        return new Response(
          JSON.stringify({ error: 'Empresa inválida para este usuário' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Aplicar updates
    const { data: updatedProfile, error: updateError } = await adminClient
      .from('profiles')
      .update({ ...safeUpdates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating profile:', updateError)
      return new Response(
        JSON.stringify({ error: `Erro ao atualizar usuário: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sincronizar role em user_roles se mudou
    if ('role' in safeUpdates) {
      await adminClient
        .from('user_roles')
        .upsert(
          { user_id: userId, role: safeUpdates.role },
          { onConflict: 'user_id' }
        )
    }

    console.log('User updated successfully:', userId, 'by admin:', requestingUser.id)

    return new Response(
      JSON.stringify({ success: true, user: updatedProfile }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Unexpected error in update-user:', error)
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

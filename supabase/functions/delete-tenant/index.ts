import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Exclusão DEFINITIVA de um tenant (console master).
 *
 * O SQL vive na RPC `master_delete_tenant`, chamada com o JWT de quem pediu —
 * é ela que confere se é master, recusa o tenant biblioteca e o próprio tenant
 * do usuário, exige o nome digitado e apaga os dados na ordem certa.
 *
 * Aqui ficam só as duas coisas que o Postgres não alcança e que precisam da
 * service role: apagar os usuários no Auth e os arquivos no Storage.
 * A ordem importa: primeiro o SQL (que devolve ids e caminhos), depois o resto.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autorizado' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    let body: { tenantId?: string; confirmName?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Body inválido' }, 400)
    }
    const { tenantId, confirmName } = body
    if (!tenantId || !confirmName) {
      return json({ error: 'tenantId e confirmName são obrigatórios' }, 400)
    }

    // 1) SQL — a própria RPC valida master/biblioteca/tenant próprio/confirmação
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data, error } = await userClient.rpc('master_delete_tenant', {
      _tenant_id: tenantId,
      _confirm_name: confirmName,
    })
    if (error) {
      const msg = error.message || 'Falha ao excluir o tenant'
      const negado = /apenas master|sem sessão|não dá pra excluir|biblioteca|confirmação/i.test(msg)
      return json({ error: msg }, negado ? 403 : 400)
    }

    const result = data as {
      name: string; projects: number; companies: number; users: number
      user_ids: string[]; document_paths: string[]
    }

    // 2) Auth + Storage (service role). Falha aqui não desfaz o SQL — os dados
    //    já saíram; o que sobrar é reportado pra limpeza manual.
    const admin = createClient(supabaseUrl, supabaseServiceKey)
    const sobras: string[] = []

    for (const id of result.user_ids ?? []) {
      const { error: delErr } = await admin.auth.admin.deleteUser(id)
      if (delErr) sobras.push(`usuário ${id}: ${delErr.message}`)
    }

    const docs = (result.document_paths ?? []).filter(Boolean)
    for (let i = 0; i < docs.length; i += 100) {
      const lote = docs.slice(i, i + 100)
      const { error: rmErr } = await admin.storage.from('project-documents').remove(lote)
      if (rmErr) sobras.push(`documentos (lote ${i / 100 + 1}): ${rmErr.message}`)
    }

    // logo do tenant: caminho é `${tenantId}/logo.ext`
    const { data: logos } = await admin.storage.from('tenant-logos').list(tenantId)
    if (logos?.length) {
      const { error: logoErr } = await admin.storage
        .from('tenant-logos')
        .remove(logos.map(f => `${tenantId}/${f.name}`))
      if (logoErr) sobras.push(`logo: ${logoErr.message}`)
    }

    return json({
      ok: true,
      name: result.name,
      projects: result.projects,
      companies: result.companies,
      users: result.users,
      documents: docs.length,
      warnings: sobras,
    })
  } catch (e) {
    console.error('delete-tenant', e)
    return json({ error: e instanceof Error ? e.message : 'Erro inesperado' }, 500)
  }
})

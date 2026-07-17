/**
 * sync-library — Edge Function
 *
 * Copia concessionárias da BIBLIOTECA (tenant is_library = GD Manager) para o
 * tenant do solicitante, com todas as características:
 *   - a concessionária em si
 *   - regras de padrão de entrada
 *   - itens do Pacote do Projetista
 *   - arquivos de template (.docx) no storage
 *
 * Cada tenant fica dono da SUA cópia: editar não afeta a biblioteca nem os
 * outros tenants. O vínculo (source_id) serve só para detectar atualizações e
 * permitir reimportar depois.
 *
 * Modos de chamada:
 *   1. Admin do tenant (JWT): { sourceIds?: string[] }  — omitir = importar tudo
 *   2. Interno no autocadastro (service_role): { tenantId, internalKey }
 *
 * Reimportar SOBRESCREVE a cópia local daquela concessionária (é o que o
 * usuário pede ao clicar em "atualizar"), mas nunca mexe nas outras.
 *
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'concessionaire-templates'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface SyncRequest {
  sourceIds?: string[]
  tenantId?: string      // só no modo interno
  internalKey?: string   // só no modo interno
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body: SyncRequest = await req.json().catch(() => ({}))
    let targetTenantId: string | null = null

    // ── Modo interno (chamado pelo signup-tenant com a service key) ───────────
    if (body.internalKey) {
      if (body.internalKey !== serviceKey) return json({ error: 'Não autorizado' }, 401)
      if (!body.tenantId) return json({ error: 'tenantId é obrigatório' }, 400)
      targetTenantId = body.tenantId
    } else {
      // ── Modo usuário: admin importando para o próprio tenant ────────────────
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) return json({ error: 'Não autorizado' }, 401)

      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user }, error: userErr } = await userClient.auth.getUser()
      if (userErr || !user) return json({ error: 'Não autorizado' }, 401)

      const { data: profile } = await userClient
        .from('profiles').select('role, is_master, tenant_id').eq('id', user.id).single()

      if (!profile || (profile.role !== 'admin' && !profile.is_master)) {
        return json({ error: 'Apenas administradores podem importar da biblioteca' }, 403)
      }
      targetTenantId = profile.tenant_id
    }

    if (!targetTenantId) return json({ error: 'Tenant não identificado' }, 400)

    // ── Biblioteca ───────────────────────────────────────────────────────────
    const { data: libraryTenant } = await admin
      .from('tenants').select('id').eq('is_library', true).maybeSingle()
    if (!libraryTenant) return json({ error: 'Biblioteca não configurada' }, 500)
    if (libraryTenant.id === targetTenantId) {
      return json({ error: 'A biblioteca não importa dela mesma' }, 400)
    }

    let q = admin
      .from('energy_concessionaires')
      .select('id, name, is_active')
      .eq('tenant_id', libraryTenant.id)
      .eq('is_active', true)
    if (body.sourceIds?.length) q = q.in('id', body.sourceIds)

    const { data: sources, error: srcErr } = await q
    if (srcErr) throw srcErr
    if (!sources?.length) return json({ imported: 0, items: [] })

    const now = new Date().toISOString()
    const results: { name: string; status: string; templates: number }[] = []

    for (const src of sources) {
      // Já existe uma cópia desta origem no tenant?
      const { data: existing } = await admin
        .from('energy_concessionaires')
        .select('id')
        .eq('tenant_id', targetTenantId)
        .eq('source_id', src.id)
        .maybeSingle()

      let localId = existing?.id ?? null

      if (localId) {
        await admin.from('energy_concessionaires')
          .update({ name: src.name, source_synced_at: now })
          .eq('id', localId)
      } else {
        const { data: created, error: cErr } = await admin
          .from('energy_concessionaires')
          .insert({
            name: src.name,
            is_active: true,
            tenant_id: targetTenantId,
            source_id: src.id,
            source_synced_at: now,
          })
          .select('id').single()
        if (cErr) { console.error('Erro ao copiar concessionária', src.name, cErr); continue }
        localId = created.id
      }

      // ── Regras de padrão de entrada (substitui as vindas da biblioteca) ────
      await admin.from('concessionaire_entry_rules').delete().eq('concessionaire_id', localId)
      const { data: rules } = await admin
        .from('concessionaire_entry_rules')
        .select('categoria, num_fases, bitola, disjuntor, classe, caixa_medicao, sort_order')
        .eq('concessionaire_id', src.id)
      if (rules?.length) {
        await admin.from('concessionaire_entry_rules').insert(
          rules.map(r => ({ ...r, concessionaire_id: localId, tenant_id: targetTenantId })),
        )
      }

      // ── Arquivos de template ──────────────────────────────────────────────
      // Feito ANTES do pacote: os itens do pacote apontam para o caminho do
      // template, que precisa existir com o caminho novo.
      const pathMap = new Map<string, string>() // caminho na biblioteca → caminho no tenant
      const { data: files } = await admin.storage.from(BUCKET).list(src.id, { limit: 200 })
      let copied = 0
      for (const f of files ?? []) {
        if (f.id === null) continue // pasta (ex.: .backups)
        if (f.name === '.emptyFolderPlaceholder' || f.name.startsWith('.')) continue
        const from = `${src.id}/${f.name}`
        const to = `${localId}/${f.name}`
        // remove antes para a reimportação sobrescrever
        await admin.storage.from(BUCKET).remove([to])
        const { error: copyErr } = await admin.storage.from(BUCKET).copy(from, to)
        if (copyErr) { console.error('Erro ao copiar template', from, copyErr); continue }
        pathMap.set(from, to)
        copied++
      }

      // ── Itens do Pacote do Projetista ─────────────────────────────────────
      const { data: pkg } = await admin
        .from('installer_packages').select('items').eq('concessionaire_id', src.id).maybeSingle()
      if (pkg?.items) {
        const items = (pkg.items as Record<string, unknown>[]).map(it => {
          // aponta o item de template para o arquivo já copiado
          if (it.source_type === 'concessionaire_template' && typeof it.ref === 'string') {
            return { ...it, ref: pathMap.get(it.ref) ?? null }
          }
          return it
        })
        await admin.from('installer_packages')
          .upsert({ concessionaire_id: localId, items }, { onConflict: 'concessionaire_id' })
      }

      results.push({ name: src.name, status: existing ? 'atualizada' : 'importada', templates: copied })
    }

    console.log('sync-library:', targetTenantId, JSON.stringify(results))
    return json({ imported: results.length, items: results })

  } catch (err) {
    console.error('Erro inesperado em sync-library:', err)
    return json({ error: 'Erro interno ao importar da biblioteca' }, 500)
  }
})

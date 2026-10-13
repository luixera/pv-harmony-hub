import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validarCorpo } from '../_shared/ludmillaStatus.ts'

/**
 * LUDMILLA — API DE STATUS (`POST /functions/v1/ludmilla-status`)
 *
 * A porta NOSSA para o status de portal que a robô não consegue ler sozinha.
 * Caso que a motivou (13/10/2026): o Portal GD da Elektro bloqueia navegador
 * automatizado antes da tela de login — até na estação local, no PC de pessoa.
 * Então a pessoa entra, lê a lista de solicitações e entrega aqui o que viu.
 * Daí em diante é o MESMO trilho da varredura (`ludmilla_registrar_varredura`):
 * casamento com o projeto, recomendação, cartão na /ludmilla para confirmar.
 *
 * Autenticação: `Authorization: Bearer gdm_…` (ou `x-api-key`), chave criada
 * na tela da concessionária e guardada no banco só como hash. Esta função não
 * valida a chave: passa-a à RPC `ludmilla_api_status_registrar`, que compara o
 * hash e responde `chave_invalida` / `chave_revogada`. A chave nunca é logada.
 *
 * Corpo:
 *   { "concessionaria": "ELEKTRO",
 *     "protocolos": [ { "protocolo": "…", "status": "…", "titular": "…", "observacao": "…" } ] }
 *
 * Deployada com --no-verify-jwt: a chave da API é a credencial, não o JWT.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** O que cada erro da RPC vira em HTTP — para quem chama saber se é a chave, a conta ou o corpo. */
const STATUS_DO_ERRO: Record<string, number> = {
  chave_invalida: 401,
  chave_revogada: 401,
  conta_nao_encontrada: 404,
  protocolos_invalidos: 400,
}

function chaveDoPedido(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(gdm_[0-9a-f]{40})$/i.exec(auth.trim())
  if (m) return m[1]
  const x = (req.headers.get('x-api-key') ?? '').trim()
  return /^gdm_[0-9a-f]{40}$/i.test(x) ? x : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, erro: 'metodo_invalido', detalhe: 'Use POST.' }, 405)

  const chave = chaveDoPedido(req)
  if (!chave) {
    return json({ ok: false, erro: 'chave_ausente', detalhe: 'Envie a chave em "Authorization: Bearer gdm_…".' }, 401)
  }

  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return json({ ok: false, erro: 'corpo_invalido', detalhe: 'O corpo precisa ser JSON.' }, 400)
  }
  const v = validarCorpo(corpo)
  if (!v.ok) return json({ ok: false, erro: v.erro, detalhe: v.detalhe }, v.erro === 'concessionaria_invalida' ? 400 : 400)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ ok: false, erro: 'configuracao', detalhe: 'Função sem SUPABASE_URL/SERVICE_ROLE_KEY.' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await admin.rpc('ludmilla_api_status_registrar', {
    p_chave: chave,
    p_connector: v.connector,
    p_protocolos: v.protocolos,
  })
  if (error) {
    console.error('ludmilla-status: rpc falhou', { mensagem: error.message, connector: v.connector, itens: v.protocolos.length })
    return json({ ok: false, erro: 'falha_interna', detalhe: 'Não consegui registrar agora. Tente de novo em instantes.' }, 500)
  }

  const r = (data ?? {}) as { ok?: boolean; erro?: string; detalhe?: string; run_id?: string; protocolos?: number; mudancas?: number }
  if (!r.ok) {
    const erro = r.erro ?? 'falha_interna'
    return json({ ok: false, erro, detalhe: r.detalhe ?? null }, STATUS_DO_ERRO[erro] ?? 400)
  }
  // o que quem chamou precisa saber: quantos entraram e quantas recomendações nasceram
  return json({ ok: true, run_id: r.run_id, protocolos: r.protocolos ?? 0, recomendacoes: r.mudancas ?? 0 })
})

/**
 * ZÉ — ações administrativas da tela /ze (só admin do tenant is_library).
 *
 *  estado      → consulta a Evolution e sincroniza situacao/phone_jid.
 *  conectar    → garante ze_config (RPC ze_ativar), cria a instância se não
 *                existir (com webhook), ou reconfigura o webhook e pede QR.
 *  teste_envio → manda "Zé aqui…" para o PRÓPRIO número (único destino
 *                permitido — regra dura 1) e registra em ze_messages.
 *  desconectar → logout da instância.
 *
 * Deployada com --no-verify-jwt: a checagem do Authorization é feita aqui.
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *          EVOLUTION_URL, EVOLUTION_API_KEY, ZE_WEBHOOK_TOKEN
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { EvolutionClient } from '../_shared/evolution.ts'
import { telefoneDoJid } from '../_shared/telefone.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type Acao = 'estado' | 'conectar' | 'teste_envio' | 'desconectar'

interface Config {
  tenant_id: string
  owner_user_id: string
  instance_name: string
  phone_jid: string | null
  situacao: string
  qr_code: string | null
}

const resumo = (c: Config) => ({
  tenant_id: c.tenant_id, instance_name: c.instance_name, phone_jid: c.phone_jid,
  situacao: c.situacao, qr_code: c.qr_code,
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ ok: false, error: 'sem autorização' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'sessão inválida' }, 401)
    const { data: ehAdmin } = await userClient.rpc('ze_admin_ok')
    if (ehAdmin !== true) return json({ ok: false, error: 'só o admin do GD Manager' }, 403)

    const { acao } = await req.json() as { acao: Acao }

    const evoUrl = Deno.env.get('EVOLUTION_URL')
    const evoKey = Deno.env.get('EVOLUTION_API_KEY')
    const token = Deno.env.get('ZE_WEBHOOK_TOKEN')
    if (!evoUrl || !evoKey || !token) {
      return json({ ok: false, error: 'EVOLUTION_URL/EVOLUTION_API_KEY/ZE_WEBHOOK_TOKEN não configurados' }, 500)
    }
    const evo = new EvolutionClient(evoUrl, evoKey)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const webhook = { url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/ze-webhook`, token }

    // A config nasce (ou é lida) pela RPC — o tenant vem da sessão, não do corpo.
    const { data: cfgRaw, error: errCfg } = await userClient.rpc('ze_ativar')
    if (errCfg || !cfgRaw) return json({ ok: false, error: errCfg?.message ?? 'sem configuração' }, 500)
    const cfg = cfgRaw as Config

    const salvar = async (patch: Partial<Config>) => {
      await admin.from('ze_config').update({ ...patch, updated_at: new Date().toISOString() }).eq('tenant_id', cfg.tenant_id)
      Object.assign(cfg, patch)
    }

    switch (acao) {
      case 'estado': {
        const estado = await evo.estado(cfg.instance_name)
        const inst = estado === 'inexistente' ? null : await evo.fetchInstancia(cfg.instance_name)
        const situacao = estado === 'open' ? 'conectado' : estado === 'connecting' ? 'aguardando_qr' : 'desconectado'
        await salvar({
          situacao,
          phone_jid: inst?.ownerJid ?? cfg.phone_jid,
          qr_code: situacao === 'conectado' ? null : cfg.qr_code,
        })
        return json({ ok: true, config: resumo(cfg) })
      }
      case 'conectar': {
        const estado = await evo.estado(cfg.instance_name)
        if (estado === 'inexistente') {
          const { qr_base64 } = await evo.criarInstancia(cfg.instance_name, webhook)
          await salvar({ situacao: 'aguardando_qr', qr_code: qr_base64 })
        } else {
          await evo.setWebhook(cfg.instance_name, webhook)
          const { qr_base64, state } = await evo.conectar(cfg.instance_name)
          if (state === 'open') await salvar({ situacao: 'conectado', qr_code: null })
          else await salvar({ situacao: 'aguardando_qr', qr_code: qr_base64 ?? cfg.qr_code })
        }
        return json({ ok: true, config: resumo(cfg) })
      }
      case 'teste_envio': {
        if (cfg.situacao !== 'conectado' || !cfg.phone_jid) {
          return json({ ok: false, error: 'conecte o WhatsApp primeiro' }, 409)
        }
        const numero = telefoneDoJid(cfg.phone_jid)
        if (!numero) return json({ ok: false, error: `phone_jid sem telefone (${cfg.phone_jid})` }, 409)
        const texto = 'Zé aqui 👋 Teste de envio para mim mesmo. Se você está lendo isto no chat "Você", a fundação está de pé.'
        // REGRA DURA 1: o destino é sempre o número do dono, lido da config.
        const { wa_id } = await evo.enviarTexto(cfg.instance_name, numero, texto)
        await admin.from('ze_messages').insert({ tenant_id: cfg.tenant_id, papel: 'ze', texto, wa_id })
        return json({ ok: true, config: resumo(cfg), wa_id })
      }
      case 'desconectar': {
        await evo.logout(cfg.instance_name)
        await salvar({ situacao: 'desconectado', qr_code: null })
        return json({ ok: true, config: resumo(cfg) })
      }
      default:
        return json({ ok: false, error: `ação desconhecida: ${String(acao)}` }, 400)
    }
  } catch (e) {
    console.error('[ze-admin]', e)
    return json({ ok: false, error: e instanceof Error ? e.message : 'falha inesperada' }, 500)
  }
})

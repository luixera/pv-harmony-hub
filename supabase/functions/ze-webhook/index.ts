/**
 * ZÉ — webhook da Evolution API.
 *
 * Recebe cada evento do WhatsApp do gestor e espelha no banco. Se a mensagem
 * é do gestor para ele mesmo (chat "Você") e NÃO foi o Zé quem mandou, é uma
 * fala do gestor: vira ze_messages(papel='user'); a partir da Entrega 2 o
 * cérebro (ze-brain) é acionado aqui.
 *
 * Autenticação: header `x-ze-token` igual ao secret ZE_WEBHOOK_TOKEN
 * (configurado no webhook da instância pela ze-admin). Deployada com
 * --no-verify-jwt — a Evolution não tem JWT do Supabase.
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ZE_WEBHOOK_TOKEN
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseUpsert, parseConnectionUpdate, parseQrcode, ehSelfChat, type EventoWebhook } from '../_shared/evolution.ts'
import { telefoneDoJid } from '../_shared/telefone.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface Config { tenant_id: string; instance_name: string; phone_jid: string | null; situacao: string }

async function configDaInstancia(instance: string): Promise<Config | null> {
  const { data } = await admin.from('ze_config')
    .select('tenant_id, instance_name, phone_jid, situacao')
    .eq('instance_name', instance).maybeSingle()
  return (data as Config | null) ?? null
}

/** É o eco de algo que o próprio Zé mandou (e não uma fala do gestor)? */
async function ecoDoZe(tenantId: string, waId: string): Promise<boolean> {
  const olhar = async () => {
    const { data } = await admin.from('ze_messages').select('id').eq('tenant_id', tenantId).eq('wa_id', waId).limit(1)
    return (data?.length ?? 0) > 0
  }
  if (await olhar()) return true
  // O sendText devolve o id e só DEPOIS a edge grava em ze_messages; o eco do
  // webhook pode chegar antes. Dois segundos cobrem a corrida.
  await new Promise(r => setTimeout(r, 2000))
  return olhar()
}

async function espelhar(cfg: Config, data: unknown): Promise<string> {
  const m = parseUpsert(data)
  if (!m) return 'ignorado'
  const tenantId = cfg.tenant_id

  const { error: errMsg } = await admin.from('wa_messages').upsert({
    tenant_id: tenantId, jid: m.jid, jid_alt: m.jid_alt, wa_id: m.wa_id, from_me: m.from_me,
    remetente: m.remetente, tipo: m.tipo, texto: m.texto, ts: m.ts,
  }, { onConflict: 'tenant_id,wa_id', ignoreDuplicates: true })
  if (errMsg) console.error('wa_messages', errMsg)

  await admin.from('wa_chats').upsert({
    tenant_id: tenantId, jid: m.jid, is_group: m.is_group,
    nome: m.is_group || m.from_me ? undefined : m.remetente,
    ultima_msg_em: m.ts, ultima_de_mim: m.from_me,
    ...(m.from_me ? { ultima_enviada_em: m.ts } : { ultima_recebida_em: m.ts }),
  }, { onConflict: 'tenant_id,jid' })

  if (!m.is_group && !m.from_me) {
    await admin.from('wa_contacts').upsert({
      tenant_id: tenantId, jid: m.jid, nome_push: m.remetente, telefone: telefoneDoJid(m.jid),
    }, { onConflict: 'tenant_id,jid', ignoreDuplicates: true })
  }

  if (!ehSelfChat(m, cfg.phone_jid)) return 'espelhada'
  if (await ecoDoZe(tenantId, m.wa_id)) return 'eco_do_ze'

  const texto = m.tipo === 'audio' ? `🎤 ${m.texto ?? '[áudio]'}` : (m.texto ?? `[${m.tipo}]`)
  await admin.from('ze_messages').insert({ tenant_id: tenantId, papel: 'user', texto, wa_id: m.wa_id })
  // Entrega 2: acionar ze-brain aqui ({ modo: 'mensagem', tenant_id }).
  return 'fala_do_gestor'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'método' }, 405)
  const esperado = Deno.env.get('ZE_WEBHOOK_TOKEN')
  if (!esperado || req.headers.get('x-ze-token') !== esperado) return json({ error: 'não autorizado' }, 401)

  let evento: EventoWebhook
  try { evento = await req.json() } catch { return json({ error: 'json inválido' }, 400) }
  if (!evento?.event || !evento?.instance) return json({ error: 'evento sem instance/event' }, 400)

  const cfg = await configDaInstancia(evento.instance)
  if (!cfg) return json({ ok: true, acao: 'ignorado', motivo: 'instância desconhecida' })

  try {
    switch (evento.event) {
      case 'qrcode.updated': {
        const qr = parseQrcode(evento.data)
        await admin.from('ze_config')
          .update({ qr_code: qr, situacao: 'aguardando_qr', updated_at: new Date().toISOString() })
          .eq('tenant_id', cfg.tenant_id)
        return json({ ok: true, acao: 'qr' })
      }
      case 'connection.update': {
        const { situacao, wuid } = parseConnectionUpdate(evento.data)
        const patch: Record<string, unknown> = { situacao, updated_at: new Date().toISOString() }
        if (situacao === 'conectado') { patch.qr_code = null; if (wuid) patch.phone_jid = wuid }
        await admin.from('ze_config').update(patch).eq('tenant_id', cfg.tenant_id)
        return json({ ok: true, acao: 'conexao', situacao })
      }
      case 'messages.upsert': {
        // Responde já; a gravação (e a espera de 2 s do eco) segue em segundo plano.
        const trabalho = espelhar(cfg, evento.data).catch(e => { console.error('espelhar', e); return 'erro' })
        if (typeof EdgeRuntime !== 'undefined') {
          EdgeRuntime.waitUntil(trabalho)
          return json({ ok: true, acao: 'em_segundo_plano' })
        }
        return json({ ok: true, acao: await trabalho })
      }
      default:
        return json({ ok: true, acao: 'ignorado', evento: evento.event })
    }
  } catch (e) {
    console.error('[ze-webhook]', e)
    return json({ error: 'erro interno' }, 500)
  }
})

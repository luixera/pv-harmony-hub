/**
 * Evolution API v2 — o que o Zé precisa dela. Módulo puro (fetch padrão, sem
 * `Deno.*`), testado pelo vitest com fixtures em `fixtures/evolution/`.
 *
 * Webhook (POST na nossa edge): { event: 'messages.upsert' | 'connection.update'
 * | 'qrcode.updated', instance, data, … }. O nome do evento chega em minúsculo
 * com ponto; a configuração do webhook usa MAIÚSCULO com sublinhado.
 *
 * REST: header `apikey`.
 */
import { ehGrupo, mesmoNumero, telefoneDoJid } from './telefone.ts';

export type TipoMensagem = 'texto' | 'audio' | 'imagem' | 'documento' | 'video' | 'outro';

export interface MensagemNormalizada {
  jid: string;
  jid_alt: string | null;
  wa_id: string;
  from_me: boolean;
  remetente: string | null;
  tipo: TipoMensagem;
  texto: string | null;
  ts: string;
  is_group: boolean;
}

export interface EventoWebhook {
  event: string;
  instance: string;
  data: unknown;
}

export const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function timestampIso(v: unknown): string {
  let segundos: number | null = null;
  if (typeof v === 'number') segundos = v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) segundos = Number(v);
  else if (obj(v) && typeof (v as Obj).low === 'number') segundos = (v as Obj).low as number;
  return new Date((segundos ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

/** Normaliza o `data` de um messages.upsert. Devolve null se não for mensagem. */
export function parseUpsert(data: unknown): MensagemNormalizada | null {
  const d = obj(data);
  const key = d ? obj(d.key) : null;
  const jid = key ? str(key.remoteJid) : null;
  const waId = key ? str(key.id) : null;
  if (!d || !key || !jid || !waId) return null;

  const msg = obj(d.message) ?? {};
  let tipo: TipoMensagem = 'outro';
  let texto: string | null = null;

  if (str(msg.conversation)) {
    tipo = 'texto';
    texto = msg.conversation as string;
  } else if (obj(msg.extendedTextMessage)) {
    tipo = 'texto';
    texto = str((msg.extendedTextMessage as Obj).text);
  } else if (obj(msg.imageMessage)) {
    tipo = 'imagem';
    texto = str((msg.imageMessage as Obj).caption) ?? '[imagem]';
  } else if (obj(msg.videoMessage)) {
    tipo = 'video';
    texto = str((msg.videoMessage as Obj).caption) ?? '[vídeo]';
  } else if (obj(msg.documentMessage)) {
    tipo = 'documento';
    const nome = str((msg.documentMessage as Obj).fileName) ?? str((msg.documentMessage as Obj).title);
    texto = nome ? `[documento ${nome}]` : '[documento]';
  } else if (obj(msg.audioMessage)) {
    tipo = 'audio';
    const s = (msg.audioMessage as Obj).seconds;
    texto = typeof s === 'number' ? `[áudio ${s}s]` : '[áudio]';
  } else if (obj(msg.stickerMessage)) {
    tipo = 'outro';
    texto = '[figurinha]';
  }

  return {
    jid,
    jid_alt: str(key.remoteJidAlt),
    wa_id: waId,
    from_me: key.fromMe === true,
    remetente: str(d.pushName),
    tipo,
    texto,
    ts: timestampIso(d.messageTimestamp),
    is_group: ehGrupo(jid),
  };
}

/** A mensagem é do gestor para ele mesmo (chat "Você")? */
export function ehSelfChat(m: MensagemNormalizada, phoneJid: string | null): boolean {
  if (!phoneJid || !m.from_me || m.is_group) return false;
  if (m.jid === phoneJid || m.jid_alt === phoneJid) return true;
  return mesmoNumero(telefoneDoJid(m.jid), telefoneDoJid(phoneJid));
}

export function parseConnectionUpdate(data: unknown): {
  situacao: 'conectado' | 'desconectado' | 'aguardando_qr';
  wuid: string | null;
} {
  const d = obj(data) ?? {};
  const state = str(d.state);
  const situacao = state === 'open' ? 'conectado' : state === 'connecting' ? 'aguardando_qr' : 'desconectado';
  return { situacao, wuid: str(d.wuid) };
}

export function parseQrcode(data: unknown): string | null {
  const d = obj(data);
  const q = d ? obj(d.qrcode) : null;
  return q ? str(q.base64) : null;
}

export class EvolutionClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: T | null }> {
    const resp = await fetch(`${this.baseUrl.replace(/\/$/, '')}${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resp.text();
    let json: T | null = null;
    try {
      json = texto ? (JSON.parse(texto) as T) : null;
    } catch {
      json = null;
    }
    // 404 é resposta legítima para "instância não existe" — quem chama decide.
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`Evolution ${resp.status} em ${metodo} ${caminho}: ${texto.slice(0, 200)}`);
    }
    return { status: resp.status, json };
  }

  private webhookCorpo(w: { url: string; token: string }) {
    return {
      webhook: {
        enabled: true,
        url: w.url,
        byEvents: false,
        base64: false,
        headers: { 'x-ze-token': w.token },
        events: [...EVENTOS_WEBHOOK],
      },
    };
  }

  async criarInstancia(nome: string, webhook: { url: string; token: string }): Promise<{ qr_base64: string | null }> {
    const { json } = await this.chamar<Obj>('POST', '/instance/create', {
      instanceName: nome,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      ...this.webhookCorpo(webhook),
    });
    const qr = json ? obj(json.qrcode) : null;
    return { qr_base64: qr ? str(qr.base64) : null };
  }

  async setWebhook(nome: string, webhook: { url: string; token: string }): Promise<void> {
    await this.chamar('POST', `/webhook/set/${nome}`, this.webhookCorpo(webhook));
  }

  async conectar(nome: string): Promise<{ qr_base64: string | null; state: string | null }> {
    const { json } = await this.chamar<Obj>('GET', `/instance/connect/${nome}`);
    const inst = json ? obj(json.instance) : null;
    return { qr_base64: json ? str(json.base64) : null, state: inst ? str(inst.state) : null };
  }

  async estado(nome: string): Promise<'open' | 'connecting' | 'close' | 'inexistente'> {
    const { status, json } = await this.chamar<Obj>('GET', `/instance/connectionState/${nome}`);
    if (status === 404) return 'inexistente';
    const inst = json ? obj(json.instance) : null;
    const s = inst ? str(inst.state) : null;
    return s === 'open' || s === 'connecting' ? s : 'close';
  }

  async fetchInstancia(nome: string): Promise<{ ownerJid: string | null; connectionStatus: string | null } | null> {
    const { json } = await this.chamar<unknown[]>('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(nome)}`);
    const primeiro = Array.isArray(json) ? obj(json[0]) : null;
    if (!primeiro) return null;
    // v2 devolve a instância "achatada"; versões antigas embrulham em { instance: {...} }
    const inst = obj(primeiro.instance) ?? primeiro;
    return {
      ownerJid: str(inst.ownerJid) ?? str(inst.owner),
      connectionStatus: str(inst.connectionStatus) ?? str(inst.status),
    };
  }

  /**
   * ÚNICO ponto de envio do Zé. Quem chama é responsável por passar SÓ o
   * número do dono (regra dura 1 — ele nunca fala com terceiros).
   */
  async enviarTexto(nome: string, numero: string, texto: string): Promise<{ wa_id: string }> {
    const { json } = await this.chamar<Obj>('POST', `/message/sendText/${nome}`, { number: numero, text: texto });
    const key = json ? obj(json.key) : null;
    const id = key ? str(key.id) : null;
    if (!id) throw new Error('Evolution não devolveu key.id no sendText');
    return { wa_id: id };
  }

  async logout(nome: string): Promise<void> {
    await this.chamar('DELETE', `/instance/logout/${nome}`);
  }
}

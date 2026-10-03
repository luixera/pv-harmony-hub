// worker/ludmilla/src/email/caixa.ts
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { chaveProtocolo } from './util.js';

/**
 * A caixa de e-mail, só de leitura. A mesma caixa do Claudinho: nunca marcar
 * como lido, mover ou apagar — a Ludmilla só olha.
 */

export interface MensagemLida {
  messageId: string;
  assunto: string;
  remetente: string;
  recebidoEm: Date | null;
  texto: string;
  anexos: { nome: string; mime: string; bytes: Buffer }[];
}

/** Puro: o que interessa de um e-mail já parseado. Testado com .eml de mentira. */
export function extrairMensagem(p: ParsedMail, uid: number): MensagemLida {
  const anexos = (p.attachments ?? [])
    .filter(a => a.content && (a.filename ?? '').trim() !== '')
    .map(a => ({
      nome: String(a.filename),
      mime: a.contentType || 'application/octet-stream',
      bytes: Buffer.from(a.content as Buffer),
    }));
  return {
    messageId: (p.messageId ?? '').trim() || `imap-uid-${uid}`,
    assunto: (p.subject ?? '').trim(),
    remetente: p.from?.text ?? '',
    recebidoEm: p.date ?? null,
    texto: (p.text ?? '').replace(/\s+/g, ' ').trim(),
    anexos,
  };
}

export interface Caixa {
  /** uids das mensagens cujo assunto OU corpo tem o número do protocolo. */
  procurar(protocolo: string): Promise<number[]>;
  baixar(uids: number[]): AsyncGenerator<MensagemLida>;
  fechar(): Promise<void>;
}

export async function abrirCaixa(c: { email: string; senha: string }): Promise<Caixa> {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: c.email, pass: c.senha.replace(/\s+/g, '') },
    logger: false,
  });
  await client.connect();
  // readOnly = EXAMINE: o servidor recusa qualquer mudança de flag (reforça "só lê"; o fetch já usa PEEK).
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });

  return {
    async procurar(protocolo: string): Promise<number[]> {
      const n = chaveProtocolo(protocolo);
      if (n.length < 8) return [];
      try {
        const uids = await client.search({ or: [{ subject: n }, { body: n }] }, { uid: true });
        return (uids as number[]) ?? [];
      } catch {
        return [];
      }
    },
    async *baixar(uids: number[]): AsyncGenerator<MensagemLida> {
      if (uids.length === 0) return;
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
        let p: ParsedMail;
        try { p = await simpleParser(msg.source as Buffer); } catch { continue; }
        yield extrairMensagem(p, msg.uid);
      }
    },
    async fechar(): Promise<void> {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
}

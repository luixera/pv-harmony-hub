// worker/ludmilla/src/email/caixa.ts
import { ImapFlow, type MailboxLockObject } from 'imapflow';
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
    // Buffer vazio é truthy: checa o tamanho para não anexar um PDF de 0 byte.
    .filter(a => (a.content?.length ?? 0) > 0 && (a.filename ?? '').trim() !== '')
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

/**
 * Puro: interpreta a resposta do SEARCH. A biblioteca devolve `false` (e não lança)
 * quando o servidor responde NO/BAD; tratar isso como "nada encontrado" deixaria a
 * robô cega em silêncio. Lista vazia é resposta válida; qualquer outra coisa é falha.
 */
export function uidsDaBusca(resultado: number[] | false | undefined, protocolo: string): number[] {
  if (Array.isArray(resultado)) return resultado;
  throw new Error(`A busca na caixa de e-mail falhou (protocolo ${protocolo}): o servidor não devolveu a lista de mensagens.`);
}

export interface Caixa {
  /** uids das mensagens cujo assunto OU corpo tem o número do protocolo. */
  procurar(protocolo: string): Promise<number[]>;
  baixar(uids: number[]): AsyncGenerator<MensagemLida>;
  fechar(): Promise<void>;
}

/**
 * Abre a INBOX em só leitura. Quem chama PRECISA de `try/finally` com `caixa.fechar()`:
 * sem isso a conexão e o lock ficam abertos, e o Gmail limita 15 conexões IMAP por
 * conta — a mesma conta que o agente de e-mails do sistema usa.
 */
export async function abrirCaixa(c: { email: string; senha: string }): Promise<Caixa> {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: c.email, pass: c.senha.replace(/\s+/g, '') },
    logger: false,
  });

  // Sem ouvinte de 'error', erro de socket/timeout vira exceção não tratada e derruba o
  // worker inteiro (que também roda a varredura da CPFL e a da Elektro). Guarda o erro;
  // as chamadas seguintes falham com ele em vez de matar o processo.
  let erroDaConexao: Error | null = null;
  client.on('error', (e: Error) => { erroDaConexao = e; });
  const verificarConexao = (): void => {
    if (erroDaConexao) throw new Error(`A conexão com a caixa de e-mail caiu: ${erroDaConexao.message}`, { cause: erroDaConexao });
  };

  let lock: MailboxLockObject;
  try {
    await client.connect();
    // readOnly = EXAMINE: o servidor recusa qualquer mudança de flag (reforça "só lê"; o fetch já usa PEEK).
    lock = await client.getMailboxLock('INBOX', { readOnly: true });
  } catch (e) {
    // Quem chamou nunca recebe o objeto Caixa e não tem como chamar fechar(): fecha o socket aqui.
    client.close();
    throw e;
  }

  return {
    async procurar(protocolo: string): Promise<number[]> {
      verificarConexao();
      const n = chaveProtocolo(protocolo);
      if (n.length < 8) return [];
      // Sem try/catch: busca que falhou NÃO pode virar "não achei" (quem chama decide o que fazer).
      return uidsDaBusca(await client.search({ or: [{ subject: n }, { body: n }] }, { uid: true }), protocolo);
    },
    async *baixar(uids: number[]): AsyncGenerator<MensagemLida> {
      verificarConexao();
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

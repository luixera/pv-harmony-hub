// worker/ludmilla/src/email/caixa.ts
import { ImapFlow, type MailboxLockObject } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { chaveProtocolo } from './util.js';

/**
 * A caixa de e-mail, só de leitura. A mesma caixa do Claudinho: nunca marcar
 * como lido, mover ou apagar — a Ludmilla só olha.
 */

export interface MensagemLida {
  /** o uid do IMAP, para casar a mensagem baixada com o envelope já triado */
  uid: number;
  messageId: string;
  assunto: string;
  remetente: string;
  recebidoEm: Date | null;
  texto: string;
  anexos: { nome: string; mime: string; bytes: Buffer }[];
}

/**
 * O id que vale para o "já tratei esta mensagem". Vem do cabeçalho `Message-ID`;
 * sem ele, cai no uid da caixa.
 *
 * Existe como função sozinha porque o MESMO id tem de sair do envelope e do
 * corpo: é com o do envelope que a pendência é consultada, e é com o do
 * tratamento que ela é registrada. Dois jeitos de calcular = mensagem tratada
 * duas vezes, ou nunca.
 */
export const idDaMensagem = (bruto: string | null | undefined, uid: number): string =>
  (bruto ?? '').trim() || `imap-uid-${uid}`;

/**
 * O pedaço do envelope do IMAP que a triagem usa (o imapflow devolve mais).
 *
 * `date` vem como Date OU como string, dependendo do servidor — por isso
 * `extrairEnvelope` normaliza em vez de confiar.
 */
export interface EnvelopeBruto {
  messageId?: string | null;
  subject?: string | null;
  date?: Date | string | null;
}

/** Assunto, id e data — sem corpo e sem anexos. É o que decide se vale baixar. */
export interface EnvelopeLido {
  uid: number;
  messageId: string;
  assunto: string;
  recebidoEm: Date | null;
}

/** Data que não dá para interpretar vira null, nunca `Invalid Date`. */
const dataDoEnvelope = (d: Date | string | null | undefined): Date | null => {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  if (typeof d !== 'string' || d.trim() === '') return null;
  const q = new Date(d);
  return Number.isNaN(q.getTime()) ? null : q;
};

/** Puro: a triagem olha só isto. Testado sem IMAP. */
export function extrairEnvelope(uid: number, env: EnvelopeBruto | null | undefined): EnvelopeLido {
  return {
    uid,
    messageId: idDaMensagem(env?.messageId, uid),
    assunto: (env?.subject ?? '').trim(),
    recebidoEm: dataDoEnvelope(env?.date),
  };
}

/**
 * Puro: o que interessa de um e-mail já parseado. Testado com .eml de mentira.
 *
 * `messageIdDoEnvelope` vem da triagem e VENCE o do cabeçalho parseado: foi com
 * ele que a pendência respondeu "preciso tratar", e é com ele que o tratamento
 * tem de registrar.
 */
export function extrairMensagem(p: ParsedMail, uid: number, messageIdDoEnvelope?: string | null): MensagemLida {
  const anexos = (p.attachments ?? [])
    // Buffer vazio é truthy: checa o tamanho para não anexar um PDF de 0 byte.
    .filter(a => (a.content?.length ?? 0) > 0 && (a.filename ?? '').trim() !== '')
    .map(a => ({
      nome: String(a.filename),
      mime: a.contentType || 'application/octet-stream',
      bytes: Buffer.from(a.content as Buffer),
    }));
  return {
    uid,
    messageId: idDaMensagem(messageIdDoEnvelope ?? p.messageId, uid),
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
  /**
   * Só o envelope (assunto, id, data): é com isto que se decide o que vale
   * baixar. Spec §5.4, literal: "Mensagem já registrada em
   * `portal_email_mensagens` → **pula sem baixar**". Sem este passo, 20
   * pareceres de 1–2 MB desciam duas vezes por dia, para sempre.
   */
  envelopes(uids: number[]): AsyncGenerator<EnvelopeLido>;
  /** O corpo com os anexos. Chame só para os uids que passaram da triagem. */
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
    async *envelopes(uids: number[]): AsyncGenerator<EnvelopeLido> {
      verificarConexao();
      if (uids.length === 0) return;
      // Sem `source`: o corpo e os anexos NÃO descem aqui. É todo o ponto.
      for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
        yield extrairEnvelope(msg.uid, msg.envelope);
      }
    },
    async *baixar(uids: number[]): AsyncGenerator<MensagemLida> {
      verificarConexao();
      if (uids.length === 0) return;
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
        let p: ParsedMail;
        try { p = await simpleParser(msg.source as Buffer); } catch { continue; }
        yield extrairMensagem(p, msg.uid, msg.envelope?.messageId);
      }
    },
    async fechar(): Promise<void> {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
}

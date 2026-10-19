// worker/ludmilla/src/email/caixa.ts
import { ImapFlow, type MailboxLockObject, type SearchObject } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { chaveProtocolo } from './util.js';

/**
 * A caixa de e-mail, só de leitura. A mesma caixa do Claudinho: nunca marcar
 * como lido, mover ou apagar — a Ludmilla só olha.
 *
 * NADA de dado de cliente vai para o log aqui: só o uid da caixa e a classe do
 * erro. Assunto, remetente e nome de arquivo ficam no banco.
 */

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

export interface MensagemLida {
  /** o uid do IMAP, para casar a mensagem baixada com o envelope já triado */
  uid: number;
  messageId: string;
  assunto: string;
  remetente: string;
  recebidoEm: Date | null;
  texto: string;
  anexos: { nome: string; mime: string; bytes: Buffer }[];
  /**
   * Anexos com conteúdo mas SEM nome de arquivo, que não entram em `anexos`
   * (sem nome não há como identificar o arquivo nem montar a chave dele). Não
   * contam as imagens: logo de assinatura inline quase nunca tem nome, e não é
   * documento de qualquer jeito. Existe para o descarte deixar rastro.
   */
  anexosSemNome: number;
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
  // Buffer vazio é truthy: checa o tamanho para não anexar um PDF de 0 byte.
  const comConteudo = (p.attachments ?? []).filter(a => (a.content?.length ?? 0) > 0);
  const anexos = comConteudo
    .filter(a => (a.filename ?? '').trim() !== '')
    .map(a => ({
      nome: String(a.filename),
      mime: a.contentType || 'application/octet-stream',
      bytes: Buffer.from(a.content as Buffer),
    }));
  // Sem nome o anexo não entra, mas não pode SUMIR: numa regra sem leitura de PDF
  // nem a ressalva "não trouxe PDF" aparecia, e o documento não existia para ninguém.
  const anexosSemNome = comConteudo
    .filter(a => (a.filename ?? '').trim() === '' && !/^image\//i.test(a.contentType ?? ''))
    .length;
  return {
    uid,
    messageId: idDaMensagem(messageIdDoEnvelope ?? p.messageId, uid),
    assunto: (p.subject ?? '').trim(),
    remetente: p.from?.text ?? '',
    recebidoEm: p.date ?? null,
    texto: (p.text ?? '').replace(/\s+/g, ' ').trim(),
    anexos,
    anexosSemNome,
  };
}

/**
 * Interpreta o corpo cru da mensagem; devolve `null` quando o parser não dá
 * conta, e nesse caso LOGA e CONTA.
 *
 * O descarte era silencioso (`try { … } catch { continue; }`): sem linha no
 * banco, `tentativas` não incrementa, e no run seguinte a consulta de pendência
 * responde TRUE de novo — o corpo de 1–2 MB desce outra vez, duas vezes por
 * dia, para sempre, e nada em lugar nenhum diz que existe uma mensagem que a
 * robô não consegue ler. É o mesmo defeito que a correção C1 consertou no outro
 * arquivo.
 *
 * Não há linha para gravar no banco (o parser falhou: não existe `Message-ID`
 * confiável, nem assunto, nem protocolo), então a visibilidade é o log e a
 * contagem `nao_lidas` no `resultado` do run. Do erro vai só o `name`: a
 * mensagem do mailparser pode citar trecho do e-mail.
 */
export async function mensagemDoFonte(
  fonte: Buffer, uid: number, messageIdDoEnvelope?: string | null,
): Promise<MensagemLida | null> {
  try {
    const m = extrairMensagem(await simpleParser(fonte), uid, messageIdDoEnvelope);
    // Só o uid e a quantidade: o nome do outro anexo, o assunto e o corpo são
    // dado de cliente. O uid é o que permite achar a mensagem na caixa.
    if (m.anexosSemNome > 0) {
      log('anexo sem nome de arquivo não foi anexado', { nivel: 'aviso', uid, quantidade: m.anexosSemNome });
    }
    return m;
  } catch (e) {
    log('não consegui interpretar o corpo desta mensagem; ela não foi tratada', {
      nivel: 'falha', uid, classe: (e instanceof Error ? e.name : typeof e) || 'erro',
    });
    return null;
  }
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

/**
 * Puro: a mesma regra de `uidsDaBusca`, para a busca por REMETENTE (ENEL). Falha
 * do servidor LANÇA em vez de virar "não achei": a robô da ENEL parte da caixa, e
 * uma caixa que "não tem nada" por causa de um NO/BAD silencioso é a mesma
 * cegueira em silêncio — só que sem nenhum protocolo para denunciar.
 */
export function uidsDaBuscaPorRemetente(resultado: number[] | false | undefined, remetente: string): number[] {
  if (Array.isArray(resultado)) return resultado;
  throw new Error(`A busca na caixa de e-mail falhou (remetente ${remetente}): o servidor não devolveu a lista de mensagens.`);
}

/**
 * Puro: o critério do SEARCH por remetente. O `since` é o que segura a janela de
 * 30 dias — sem ele a caixa inteira seria lida, e cada mensagem da ENEL custaria
 * IA —, por isso mora numa função que o teste consegue ler.
 */
export function criterioPorRemetente(remetente: string, desde: Date): SearchObject {
  return { from: remetente, since: desde };
}

/** O pedaço do cliente IMAP que a busca usa (o `ImapFlow` real serve; o teste usa um de mentira). */
export interface BuscaImap {
  search(query: SearchObject, options: { uid: true }): Promise<number[] | false | undefined>;
}

/**
 * A busca por remetente inteira, sem a conexão. Sem try/catch de propósito:
 * exceção da conexão e NO/BAD do servidor sobem, e nenhuma delas pode virar
 * "não achei" (a caixa parecer vazia = a robô cega em silêncio).
 */
export async function buscarPorRemetente(client: BuscaImap, remetente: string, desde: Date): Promise<number[]> {
  return uidsDaBuscaPorRemetente(await client.search(criterioPorRemetente(remetente, desde), { uid: true }), remetente);
}

export interface Caixa {
  /** uids das mensagens cujo assunto OU corpo tem o número do protocolo. */
  procurar(protocolo: string): Promise<number[]>;
  /** uids das mensagens DESTE remetente desde a data (granularidade de dia do IMAP). */
  procurarDe(remetente: string, desde: Date): Promise<number[]>;
  /**
   * Só o envelope (assunto, id, data): é com isto que se decide o que vale
   * baixar. Spec §5.4, literal: "Mensagem já registrada em
   * `portal_email_mensagens` → **pula sem baixar**". Sem este passo, 20
   * pareceres de 1–2 MB desciam duas vezes por dia, para sempre.
   */
  envelopes(uids: number[]): AsyncGenerator<EnvelopeLido>;
  /** O corpo com os anexos. Chame só para os uids que passaram da triagem. */
  baixar(uids: number[]): AsyncGenerator<MensagemLida>;
  /**
   * Quantas mensagens o parser não conseguiu interpretar nesta conexão. Entra no
   * `resultado` do run: descarte invisível é documento perdido em silêncio.
   */
  naoLidas(): number;
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

  // mensagens que o parser não conseguiu interpretar nesta conexão (D3)
  let naoLidas = 0;

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
    async procurarDe(remetente: string, desde: Date): Promise<number[]> {
      verificarConexao();
      // Sem try/catch: busca que falhou NÃO pode virar "não achei".
      return buscarPorRemetente(client, remetente, desde);
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
        const m = await mensagemDoFonte(msg.source as Buffer, msg.uid, msg.envelope?.messageId);
        if (!m) { naoLidas++; continue; }
        yield m;
      }
    },
    naoLidas: () => naoLidas,
    async fechar(): Promise<void> {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
}

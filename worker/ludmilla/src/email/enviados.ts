// worker/ludmilla/src/email/enviados.ts
import { ImapFlow, type SearchObject } from 'imapflow';
import type { PastaDaLista } from './caixa.js';

/**
 * A CONFERÊNCIA NA PASTA ENVIADOS — depois de uma queda no meio do envio da cobrança
 * (email/enel/enviar.ts), quando não dá para saber se o e-mail saiu.
 *
 * Decisão do usuário (27/10/2026, plano: "Decisões do usuário na Task 5", item 10):
 *  · IMAP SÓ LEITURA (EXAMINE) na caixa especial `\Sent` — achada pelo `specialUse` que o
 *    servidor informa, nunca pelo nome —, com a MESMA conta e a MESMA credencial do envio;
 *  · espera 30 s; depois até 4 buscas, com 30 s entre elas (o Gmail demora a mostrar o enviado);
 *  · "saiu" = achar o Message-ID do envio OU uma mensagem para o mesmo destinatário, com o
 *    mesmo assunto, de no máximo 1 min antes do início do envio para cá;
 *  · NA DÚVIDA, CONTA COMO SAIU: o erro tem de ser deixar de cobrar, nunca cobrar em dobro.
 *    Por isso `nao_achou` só sai de 4 buscas LIMPAS; qualquer erro de IMAP é `nao_conferiu`.
 * Nunca lança. Nada aqui escreve na caixa, e nada aqui vai para o log: quem chama registra o
 * resultado (achou, não achou, não conferiu) e só o CÓDIGO do erro, nunca a mensagem crua.
 */

export interface ProcuraNosEnviados {
  /** o Message-ID que o worker pôs no e-mail */
  messageId: string;
  /** o destinatário travado (minúsculo) */
  para: string;
  assunto: string;
  /** quando o envio começou */
  inicio: Date;
}

export type ResultadoDaConferencia = 'achou' | 'nao_achou' | 'nao_conferiu';

export interface Conferencia {
  resultado: ResultadoDaConferencia;
  /** quantas buscas foram feitas */
  buscas: number;
  /** o código do último erro de IMAP (`nao_conferiu`); nunca a mensagem */
  codigo: string | null;
}

export const ESPERA_DOS_ENVIADOS_MS = 30_000;
export const BUSCAS_NOS_ENVIADOS = 4;
/** "de no máximo 1 min antes do início do envio para cá" */
export const JANELA_ANTES_DO_INICIO_MS = 60_000;
/** teto de cada busca (conectar, abrir, buscar, ler): IMAP pendurado não segura o envio */
const PRAZO_DE_CADA_BUSCA_MS = 60_000;
/** as últimas da pasta, lidas sem depender do índice de busca do Gmail */
const ULTIMAS_DA_PASTA = 20;
/** e no máximo tantas das achadas pela busca por destinatário (as mais novas) */
const MAX_DA_BUSCA = 50;
const DIA = 86_400_000;

/** O envelope de uma mensagem da `\Sent` (o `FetchMessageObject` do imapflow serve). */
export interface EnvelopeDoEnviado {
  messageId?: string;
  to?: { address?: string }[];
  subject?: string;
  date?: Date | string;
  internalDate?: Date | string;
}

const normalizar = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const dataValida = (d: Date | string | undefined): Date | null => {
  if (d === undefined || d === null) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isFinite(x.getTime()) ? x : null;
};

/** Puro: esta mensagem da `\Sent` é o e-mail que tentamos mandar? Na dúvida, sim. */
export function contaComoSaiu(env: EnvelopeDoEnviado, p: ProcuraNosEnviados): boolean {
  const id = (env.messageId ?? '').trim();
  if (id !== '' && id.toLowerCase() === p.messageId.trim().toLowerCase()) return true;
  const para = normalizar(p.para);
  if (!(env.to ?? []).some(a => normalizar(a?.address ?? '') === para)) return false;
  // assunto diferente = outro e-mail; SEM assunto = dúvida = conta
  if (typeof env.subject === 'string' && env.subject.trim() !== '' && normalizar(env.subject) !== normalizar(p.assunto)) return false;
  const quando = dataValida(env.date) ?? dataValida(env.internalDate);
  // sem data legível = dúvida = conta
  if (quando === null) return true;
  return quando.getTime() >= p.inicio.getTime() - JANELA_ANTES_DO_INICIO_MS;
}

/** O pedaço do cliente IMAP que a conferência usa (o `ImapFlow` real, por `imapGmail`; o teste usa um de mentira). */
export interface ImapDosEnviados {
  connect(): Promise<unknown>;
  list(): Promise<readonly PastaDaLista[]>;
  getMailboxLock(path: string, options: { readOnly: boolean }): Promise<{ release(): void }>;
  /** quantas mensagens a pasta aberta tem (o EXISTS do EXAMINE) */
  total(): number;
  search(query: SearchObject, options: { uid: true }): Promise<number[] | false | undefined>;
  fetch(uids: number[], query: { uid: true; envelope: true; internalDate: true }, options: { uid: true }):
    AsyncIterable<{ uid: number; envelope?: EnvelopeDoEnviado; internalDate?: Date | string }>;
  logout(): Promise<unknown>;
  close(): void;
}

/** O cliente de verdade: Gmail, 993/TLS, a mesma senha de app do IMAP de leitura, sem log da biblioteca. */
export function imapGmail(c: { email: string; senha: string }): ImapDosEnviados {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: c.email, pass: c.senha.replace(/\s+/g, '') },
    logger: false,
  });
  // sem ouvinte de 'error', erro de socket vira exceção não tratada e derruba o worker inteiro;
  // as chamadas pendentes falham sozinhas (e a busca tem prazo)
  client.on('error', () => undefined);
  return {
    connect: () => client.connect(),
    list: () => client.list(),
    getMailboxLock: (path, options) => client.getMailboxLock(path, options),
    total: () => (client.mailbox ? client.mailbox.exists : 0),
    search: (query, options) => client.search(query, options),
    fetch: (uids, query, options) => client.fetch(uids, query, options) as AsyncIterable<{
      uid: number; envelope?: EnvelopeDoEnviado; internalDate?: Date | string;
    }>,
    logout: () => client.logout(),
    close: () => client.close(),
  };
}

export interface DepsDaConferencia {
  abrir: (c: { email: string; senha: string }) => ImapDosEnviados;
  /** as esperas de 30 s (o teste não espera) */
  esperar: (ms: number) => Promise<void>;
}
export const DEPS_DA_CONFERENCIA: DepsDaConferencia = {
  abrir: imapGmail,
  esperar: ms => new Promise(r => setTimeout(r, ms)),
};

/** Erro que a própria conferência levanta, com um código nosso. */
class ErroDaConferencia extends Error {
  constructor(readonly code: string) { super(`conferência na pasta Enviados: ${code}`); this.name = 'ErroDaConferencia'; }
}

/** Só o código do erro de IMAP (o servidor pode citar a caixa na mensagem): nunca o texto. */
export function codigoDoImap(e: unknown): string {
  const x = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; serverResponseCode?: unknown; authenticationFailed?: unknown };
  const ok = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(v);
  if (ok(x.serverResponseCode)) return x.serverResponseCode.toUpperCase();
  if (x.authenticationFailed === true) return 'AUTHENTICATIONFAILED';
  if (ok(x.code)) return x.code;
  return 'IMAP_SEM_CODIGO';
}

async function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, nao) => { relogio = setTimeout(() => nao(new ErroDaConferencia('PRAZO_ESGOTADO')), ms); })]);
  } finally {
    if (relogio !== undefined) clearTimeout(relogio);
  }
}

/** UMA busca: conecta, abre a `\Sent` em só leitura, procura, lê os envelopes e decide. */
async function procurarUmaVez(imap: ImapDosEnviados, p: ProcuraNosEnviados): Promise<boolean> {
  await imap.connect();
  const enviados = (await imap.list()).find(x => x.specialUse === '\\Sent');
  if (!enviados) throw new ErroDaConferencia('SEM_PASTA_SENT');
  // readOnly = EXAMINE: o servidor recusa qualquer mudança (nem a flag de lida muda)
  const lock = await imap.getMailboxLock(enviados.path, { readOnly: true });
  try {
    // SINCE é por DIA: um dia antes, e a hora exata é conferida em contaComoSaiu
    const porDestinatario = await imap.search({ to: p.para, since: new Date(p.inicio.getTime() - DIA) }, { uid: true });
    const total = imap.total();
    const daCauda = total > 0 ? await imap.search({ seq: `${Math.max(1, total - ULTIMAS_DA_PASTA + 1)}:*` }, { uid: true }) : [];
    // busca que falhou NÃO vira "não achei"
    if (!Array.isArray(porDestinatario) || !Array.isArray(daCauda)) throw new ErroDaConferencia('BUSCA_RECUSADA');
    const uids = [...new Set([...porDestinatario.slice(-MAX_DA_BUSCA), ...daCauda])];
    if (uids.length === 0) return false;
    // lê tudo antes de decidir (nada de comando IMAP no meio do fetch)
    const lidos: EnvelopeDoEnviado[] = [];
    for await (const m of imap.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
      lidos.push({ ...(m.envelope ?? {}), internalDate: m.internalDate });
    }
    return lidos.some(env => contaComoSaiu(env, p));
  } finally {
    lock.release();
  }
}

async function fechar(imap: ImapDosEnviados): Promise<void> {
  await comPrazo(Promise.resolve().then(() => imap.logout()), 10_000).catch(() => undefined);
  try { imap.close(); } catch { /* já fechado */ }
}

/** Confere a pasta Enviados. Nunca lança. */
export async function conferirNosEnviados(
  c: { email: string; senha: string }, p: ProcuraNosEnviados, deps: DepsDaConferencia = DEPS_DA_CONFERENCIA,
): Promise<Conferencia> {
  let buscas = 0;
  let codigo: string | null = null;
  try {
    // o Gmail demora a mostrar o enviado: nada de procurar na hora
    await deps.esperar(ESPERA_DOS_ENVIADOS_MS);
    for (let i = 1; i <= BUSCAS_NOS_ENVIADOS; i++) {
      buscas = i;
      let imap: ImapDosEnviados | null = null;
      try {
        imap = deps.abrir(c);
        if (await comPrazo(procurarUmaVez(imap, p), PRAZO_DE_CADA_BUSCA_MS)) return { resultado: 'achou', buscas, codigo: null };
      } catch (e) {
        codigo = codigoDoImap(e);
        // conta sem \Sent não muda esperando: não conferiu, e não se abre outra pasta
        if (codigo === 'SEM_PASTA_SENT') return { resultado: 'nao_conferiu', buscas, codigo };
      } finally {
        if (imap) await fechar(imap);
      }
      if (i < BUSCAS_NOS_ENVIADOS) await deps.esperar(ESPERA_DOS_ENVIADOS_MS);
    }
  } catch (e) {
    return { resultado: 'nao_conferiu', buscas, codigo: codigo ?? codigoDoImap(e) };
  }
  // "não achou" só de buscas LIMPAS; qualquer erro no caminho = não conferiu (na dúvida, saiu)
  return codigo === null ? { resultado: 'nao_achou', buscas, codigo: null } : { resultado: 'nao_conferiu', buscas, codigo };
}

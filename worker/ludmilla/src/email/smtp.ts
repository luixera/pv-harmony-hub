// worker/ludmilla/src/email/smtp.ts
import { randomUUID } from 'node:crypto';
import nodemailer, { type SendMailOptions } from 'nodemailer';

/**
 * O ENVIO por SMTP — só o da cobrança da troca, aprovada por uma pessoa
 * (email/enel/enviar.ts). A MESMA conta Gmail e a MESMA senha de app do IMAP
 * (`credencialDaCaixa`). Nada aqui decide SE envia: isso é das travas (`podeEnviar` e o
 * banco). Aqui se garante COMO: envelope SMTP explícito (só o destinatário travado), sem
 * Cc/Bcc, só texto, sem anexo, sem acesso a arquivo ou URL, sem log da biblioteca (o diálogo
 * SMTP leva o AUTH, isto é, a senha em base64).
 *
 * NUNCA em dobro: a porta (465, ou 587 se a 465 nem conectar) é escolhida pelo `verify`
 * (conectar + TLS + AUTH, sem nada da mensagem). Depois que o `sendMail` começou, nenhuma
 * outra tentativa: o nodemailer marca `command = 'CONN'` também no erro de socket, no timeout
 * e na conexão fechada no meio ou DEPOIS do DATA (smtp-connection), e aí a mensagem pode ter
 * saído. Esse caso (`podeTerSaido`) vai para a conferência na pasta Enviados (enviados.ts).
 *
 * O Message-ID é NOSSO (`novoMessageId`), posto antes do envio: é por ele que a conferência
 * procura o e-mail, e o reenvio (depois de conferir que não saiu) vai com o MESMO.
 */

export interface EmailDeSaida {
  de: string;
  para: string;
  assunto: string;
  texto: string;
  inReplyTo: string | null;
  referencias: string[];
  /** o Message-ID que o e-mail leva (`novoMessageId`): o mesmo no reenvio */
  messageId: string;
}

/** `<uuid@domínio da caixa>`, como o nodemailer faria, mas sabido ANTES do envio. */
export function novoMessageId(de: string): string {
  const dominio = (de.includes('@') ? de.slice(de.lastIndexOf('@') + 1) : '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
  return `<${randomUUID()}@${dominio || 'localhost'}>`;
}

/** O pedaço do transporte que usamos (o teste usa um de mentira). */
export interface TransporteDeEnvio {
  sendMail(o: SendMailOptions): Promise<{ messageId: string }>;
  verify(): Promise<unknown>;
  close(): void;
}

/** 465 (TLS direto) primeiro; 587 (STARTTLS) só se a 465 nem conectar. */
export const PORTAS_DO_SMTP = [465, 587] as const;
export type PortaDoSmtp = (typeof PORTAS_DO_SMTP)[number];
type Caixa = { email: string; senha: string };
export type CriarTransporte = (c: Caixa, porta: PortaDoSmtp) => TransporteDeEnvio;

export function opcoesDoEnvio(m: EmailDeSaida): SendMailOptions {
  return {
    from: m.de,
    to: m.para,
    subject: m.assunto,
    text: m.texto,
    messageId: m.messageId,
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
    ...(m.referencias.length ? { references: m.referencias } : {}),
    // o RCPT TO é EXATAMENTE o destinatário travado: o nodemailer não tira endereço do cabeçalho
    envelope: { from: m.de, to: [m.para] },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/**
 * Os TETOS de tempo de cada conexão SMTP (os padrões do nodemailer são 2 min de conexão e
 * 10 min de silêncio). No nodemailer 10.1.x o `connectionTimeout` cobre o preparo INTEIRO da
 * sessão — DNS, conexão, saudação e STARTTLS (`_connectionDeadline`, `_remainingSetupTime`);
 * depois dele vale o `socketTimeout`, que é por SILÊNCIO: o primeiro travamento derruba a sessão.
 * Uma operação (o `verify` ou o `sendMail`) dura então no máximo `conexaoMs + silencioMs` com um
 * servidor que trava (um servidor que responde devagar, mas sempre abaixo do silêncio, passaria
 * disso — não é o caso do Gmail, que responde em segundos). Entram na conta de `piorCasoDoEnvioMs`.
 */
export const PRAZOS_DO_SMTP = {
  /** DNS + TCP + TLS + saudação (+ STARTTLS na 587): o Gmail leva 1–2 s */
  conexaoMs: 15_000,
  /** a saudação, dentro do prazo da conexão */
  saudacaoMs: 10_000,
  /** o DNS, dentro do prazo da conexão */
  dnsMs: 10_000,
  /** silêncio que derruba a sessão (AUTH, MAIL, RCPT, DATA): o Gmail responde em segundos */
  silencioMs: 25_000,
} as const;

/** O pior caso de UMA operação SMTP (um `verify` ou um `sendMail`, cada um com a sua conexão). */
export const piorCasoDeUmaOperacaoSmtpMs = (): number => PRAZOS_DO_SMTP.conexaoMs + PRAZOS_DO_SMTP.silencioMs;

export function opcoesDoTransporte(c: Caixa, porta: PortaDoSmtp) {
  return {
    host: 'smtp.gmail.com',
    port: porta,
    secure: porta === 465,
    requireTLS: porta !== 465,
    // a senha de app do Gmail aparece com espaços; o IMAP (caixa.ts) já tira, aqui também
    auth: { user: c.email, pass: c.senha.replace(/\s+/g, '') },
    // explícito (é o padrão): certificado do Gmail conferido, nada abaixo de TLS 1.2
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    logger: false,
    debug: false,
    connectionTimeout: PRAZOS_DO_SMTP.conexaoMs,
    greetingTimeout: PRAZOS_DO_SMTP.saudacaoMs,
    dnsTimeout: PRAZOS_DO_SMTP.dnsMs,
    socketTimeout: PRAZOS_DO_SMTP.silencioMs,
  };
}

export function transporteGmail(c: Caixa, porta: PortaDoSmtp): TransporteDeEnvio {
  const t = nodemailer.createTransport(opcoesDoTransporte(c, porta));
  return {
    sendMail: async o => ({ messageId: String((await t.sendMail(o)).messageId ?? '') }),
    verify: () => t.verify(),
    close: () => t.close(),
  };
}

/**
 * Falha de CONEXÃO (o nodemailer marca `command = 'CONN'`). Só vale para a fase do `verify`:
 * lá nada da mensagem existe ainda. No `sendMail`, a mesma marca aparece depois do DATA.
 */
export function deveTentarOutraPorta(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { command?: unknown }).command === 'CONN';
}

/**
 * `conexao` = conectar, TLS ou AUTH (o `verify`): nada da mensagem saiu.
 * `mensagem` = o `sendMail`: sem resposta de recusa do servidor, a mensagem PODE ter saído.
 */
export type FaseDoSmtp = 'conexao' | 'mensagem';

/**
 * O erro que sai deste módulo: SÓ o código, o código de resposta, o comando e a fase. A
 * mensagem crua do nodemailer (que pode citar a caixa, o texto ou a resposta do servidor)
 * fica aqui dentro, e nem a pilha a leva.
 */
export class FalhaDoSmtp extends Error {
  readonly code: string | undefined;
  readonly responseCode: number | undefined;
  readonly command: string | undefined;
  readonly fase: FaseDoSmtp;
  constructor(e: unknown, fase: FaseDoSmtp) {
    const x = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
    const code = typeof x.code === 'string' ? x.code : undefined;
    super(`falha no SMTP (${fase}${code ? `, ${code}` : ''})`);
    this.name = 'FalhaDoSmtp';
    this.code = code;
    this.responseCode = typeof x.responseCode === 'number' ? x.responseCode : undefined;
    this.command = typeof x.command === 'string' ? x.command : undefined;
    this.fase = fase;
  }
}

/** Conecta e autentica (sem mensagem) na 465 e, se ela nem conectar, na 587. Devolve o transporte aberto. */
async function abrirNumaPorta(c: Caixa, criar: CriarTransporte): Promise<{ t: TransporteDeEnvio; porta: PortaDoSmtp }> {
  let ultimo: unknown = null;
  for (const porta of PORTAS_DO_SMTP) {
    let t: TransporteDeEnvio;
    try {
      t = criar(c, porta);
    } catch (e) {
      throw new FalhaDoSmtp(e, 'conexao');
    }
    try {
      await t.verify();
      return { t, porta };
    } catch (e) {
      t.close();
      ultimo = e;
      if (!deveTentarOutraPorta(e)) break;
    }
  }
  throw new FalhaDoSmtp(ultimo, 'conexao');
}

/** Manda o e-mail UMA vez; devolve o Message-ID que saiu. Falhou = `FalhaDoSmtp`. */
export async function enviarPorSmtp(c: Caixa, m: EmailDeSaida, criar: CriarTransporte = transporteGmail): Promise<string> {
  const { t } = await abrirNumaPorta(c, criar);
  try {
    return (await t.sendMail(opcoesDoEnvio(m))).messageId;
  } catch (e) {
    // NUNCA outra porta aqui: a mensagem pode ter saído
    throw new FalhaDoSmtp(e, 'mensagem');
  } finally {
    t.close();
  }
}

/** Conecta e autentica, SEM mandar nada (o teste da VPS, Task 6). Diz qual porta respondeu. */
export async function verificarSmtp(c: Caixa, criar: CriarTransporte = transporteGmail): Promise<{ porta: PortaDoSmtp }> {
  const { t, porta } = await abrirNumaPorta(c, criar);
  t.close();
  return { porta };
}

const CONEXAO = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'ECONNREFUSED', 'ECONNRESET'];

/** O que se sabe de uma falha do SMTP, sem a mensagem crua. */
function lerFalha(e: unknown) {
  const x = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; responseCode?: unknown; fase?: unknown };
  // código é coisa curta em maiúsculas; o resto é texto de fora e não entra
  const codigo = typeof x.code === 'string' && /^[A-Z][A-Z0-9_]{1,29}$/.test(x.code) ? x.code : '';
  const resposta = typeof x.responseCode === 'number' && Number.isInteger(x.responseCode) ? x.responseCode : null;
  const fase: FaseDoSmtp | null = x.fase === 'conexao' || x.fase === 'mensagem' ? x.fase : null;
  // o servidor RESPONDEU com 4xx/5xx: ele recusou, a mensagem não foi aceita
  const servidorRecusou = resposta !== null && resposta >= 400 && resposta < 600;
  // senha, destinatário ou mensagem recusados: o DATA não terminou aceito
  const naoSaiu = servidorRecusou || codigo === 'EAUTH' || codigo === 'EENVELOPE' || codigo === 'EMESSAGE';
  return { codigo, resposta, fase, servidorRecusou, naoSaiu };
}

/** "ETIMEDOUT", "EAUTH 535"… ('' sem código): o que pode ir para o log e para o banco. */
export function codigoDaFalha(e: unknown): string {
  const { codigo, resposta } = lerFalha(e);
  return [codigo, resposta === null ? '' : String(resposta)].filter(s => s !== '').join(' ');
}

/**
 * A falha deixa a dúvida "saiu ou não?": caiu DEPOIS do `verify` e o servidor não respondeu
 * que recusou. Falha sem fase conhecida e sem recusa também (na dúvida, pode ter saído).
 * É o caso de conferir a pasta Enviados antes de qualquer outra coisa.
 */
export function podeTerSaido(e: unknown): boolean {
  const { fase, naoSaiu } = lerFalha(e);
  return fase !== 'conexao' && !naoSaiu;
}

/**
 * A razão CURTA da falha, com o código — o que vai para o banco, para a tela e para o log.
 * A mensagem crua do servidor fica de fora: ela pode citar a caixa, o texto ou a senha.
 * Quando a falha veio de `enviarPorSmtp`, diz também se a mensagem saiu: "nada foi enviado"
 * (caiu antes, ou o servidor respondeu que recusou) ou "pode ter saído" (caiu no envio).
 */
export function falhaDoEnvio(e: unknown): string {
  const { codigo, resposta, fase, servidorRecusou, naoSaiu } = lerFalha(e);
  const razao =
    codigo === 'EAUTH' || resposta === 535 ? 'o Gmail recusou a senha de app da caixa'
    : codigo === 'EENVELOPE' || resposta === 550 || resposta === 551 || resposta === 553 ? 'o servidor recusou o destinatário'
    : codigo === 'EMESSAGE' || resposta === 552 || resposta === 554 ? 'o servidor recusou a mensagem'
    : servidorRecusou ? 'o servidor de e-mail recusou o envio'
    : CONEXAO.includes(codigo)
      ? (fase === 'mensagem' ? 'a conexão com o servidor de e-mail caiu durante o envio' : 'não consegui falar com o servidor de e-mail (porta bloqueada ou rede fora)')
    : fase === 'mensagem' ? 'falha inesperada durante o envio' : 'falha inesperada no envio';
  const cod = codigoDaFalha(e);
  const base = cod ? `${razao} (${cod})` : razao;
  if (fase === 'conexao' || (fase === 'mensagem' && naoSaiu)) return `${base}: nada foi enviado`;
  if (fase === 'mensagem') return `${base} — o e-mail pode ter saído`;
  return base;
}

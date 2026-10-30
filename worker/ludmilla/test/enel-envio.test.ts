// worker/ludmilla/test/enel-envio.test.ts
// O envio da cobrança aprovada: o que o SMTP recebe, as travas do worker, a conferência na
// pasta Enviados depois de uma queda no meio do envio, e o que vai (e o que NUNCA vai) para o
// banco e para o log. Senha, caixa e textos inventados; nada sai para a rede (dublês de SMTP e
// de IMAP, o streamTransport do nodemailer e a REDE falsa do Supabase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {
  FalhaDoSmtp, PORTAS_DO_SMTP, deveTentarOutraPorta, enviarPorSmtp, falhaDoEnvio, novoMessageId, opcoesDoEnvio,
  opcoesDoTransporte, podeTerSaido, verificarSmtp,
  type EmailDeSaida, type PortaDoSmtp, type TransporteDeEnvio,
} from '../src/email/smtp.js';
import {
  BUSCAS_NOS_ENVIADOS, ESPERA_DOS_ENVIADOS_MS, conferirNosEnviados, contaComoSaiu,
  type DepsDaConferencia, type ImapDosEnviados, type ProcuraNosEnviados,
} from '../src/email/enviados.js';
import type { PastaDaLista } from '../src/email/caixa.js';
import { DEPS_ENVIO, executarEnvioDeCobranca, type DepsEnvio } from '../src/email/enel/enviar.js';
import {
  cobrancaEnviada, cobrancaFalhou, credencialDaCaixa, iniciarEnvioDeCobranca, type CobrancaParaEnviar, type Run,
} from '../src/fila.js';

// A REDE é falsa (o cliente do Supabase é o de verdade). Tem de vir antes do 1º uso do cliente.
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-mentira';
delete process.env.LUDMILLA_MODO;

const SENHA_FALSA = 'abcd efgh ijkl mnop';
const CAIXA = { email: 'ludmilla.caixa@exemplo.test', senha: SENHA_FALSA };
const SAIDA: EmailDeSaida = {
  de: CAIXA.email, para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  texto: 'Prezados, bom dia.\n\nTexto aprovado de exemplo.\n\nAtenciosamente,\nEquipe GD Manager',
  inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'],
  messageId: '<saida-1@exemplo.test>',
};

/** Junta TUDO o que sairia no console (log, warn e error): a regra do log vale para os três. */
async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const linhas: string[] = [];
  const guardar = (...a: unknown[]) => { linhas.push(a.map(String).join(' ')); };
  console.log = guardar; console.warn = guardar; console.error = guardar;
  try { return { r: await f(), logs: linhas.join('\n') }; } finally { Object.assign(console, original); }
}
const erro = (o: Record<string, unknown>, msg = 'falhou') => Object.assign(new Error(msg), o);
/** a conexão caiu depois do verify, sem resposta de recusa: a mensagem PODE ter saído */
const queda = () => new FalhaDoSmtp(erro({ code: 'ETIMEDOUT', command: 'CONN' }, 'Timeout'), 'mensagem');
/** o servidor respondeu que recusou: nada saiu */
const recusa = () => new FalhaDoSmtp(erro({ code: 'EMESSAGE', command: 'DATA', responseCode: 554 }, `554 recusado ${SENHA_FALSA}`), 'mensagem');

// ── o que o SMTP recebe ────────────────────────────────────────────────────

test('opcoesDoEnvio: envelope SÓ com o destinatário travado, sem Cc/Bcc, só texto, sem arquivo nem URL, Message-ID nosso', () => {
  const o = opcoesDoEnvio(SAIDA);
  assert.deepEqual(o.envelope, { from: CAIXA.email, to: ['canalgd.sp@br.enel.com'] });
  assert.equal(o.to, 'canalgd.sp@br.enel.com');
  for (const k of ['cc', 'bcc', 'html', 'attachments', 'replyTo', 'headers', 'alternatives']) assert.equal(k in o, false, k);
  assert.equal(o.disableFileAccess, true);
  assert.equal(o.disableUrlAccess, true);
  assert.equal(o.inReplyTo, '<cob-nota-1@enel.test>');
  assert.deepEqual(o.references, ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>']);
  assert.equal(o.messageId, '<saida-1@exemplo.test>');
});

test('opcoesDoEnvio: sem a nota, nada de In-Reply-To nem References', () => {
  const o = opcoesDoEnvio({ ...SAIDA, inReplyTo: null, referencias: [] });
  assert.equal('inReplyTo' in o, false);
  assert.equal('references' in o, false);
});

test('a mensagem que o nodemailer monta: na conversa da nota, para o destinatário certo, com o Message-ID nosso (sem rede)', async () => {
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await t.sendMail(opcoesDoEnvio(SAIDA)) as unknown as { message: Buffer; envelope: { from: string; to: string[] }; messageId: string };
  const bruto = info.message.toString('utf8');
  assert.deepEqual(info.envelope, { from: CAIXA.email, to: ['canalgd.sp@br.enel.com'] });
  assert.equal(info.messageId, '<saida-1@exemplo.test>');
  assert.match(bruto, /^To: canalgd\.sp@br\.enel\.com$/m);
  assert.match(bruto, /^From: ludmilla\.caixa@exemplo\.test$/m);
  assert.match(bruto, /^Message-ID: <saida-1@exemplo\.test>$/m);
  assert.match(bruto, /^In-Reply-To: <cob-nota-1@enel\.test>$/m);
  assert.match(bruto, /^References: <cob-pedido@exemplo\.test> <cob-nota-1@enel\.test>$/m);
  assert.match(bruto, /^Subject: /m);
  assert.doesNotMatch(bruto, /^(Cc|Bcc|Reply-To):/im);
  assert.doesNotMatch(bruto, /text\/html/i);
  assert.match(bruto, /Equipe GD Manager/);
});

test('novoMessageId: <uuid@domínio da caixa>, um diferente a cada chamada, domínio limpo', () => {
  const a = novoMessageId('ludmilla.caixa@gmail.com');
  assert.match(a, /^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@gmail\.com>$/);
  assert.notEqual(novoMessageId('ludmilla.caixa@gmail.com'), a);
  assert.match(novoMessageId('x@Exemplo.TEST'), /@exemplo\.test>$/);
  assert.match(novoMessageId('sem-arroba'), /@localhost>$/);
  assert.match(novoMessageId('x@a b<c>.test'), /^<[0-9a-f-]+@[a-z0-9.-]+>$/);
});

test('opcoesDoTransporte: 465 com TLS, 587 com STARTTLS obrigatório, certificado conferido, senha sem espaços, sem log', () => {
  const a = opcoesDoTransporte(CAIXA, 465);
  assert.equal(a.host, 'smtp.gmail.com');
  assert.equal(a.port, 465);
  assert.equal(a.secure, true);
  assert.equal(a.requireTLS, false);
  assert.equal(a.auth.user, CAIXA.email);
  assert.equal(a.auth.pass, 'abcdefghijklmnop');
  assert.equal(a.tls.rejectUnauthorized, true);
  assert.equal(a.tls.minVersion, 'TLSv1.2');
  // sem log da biblioteca: o diálogo SMTP tem o AUTH (a senha em base64)
  assert.equal(a.logger, false);
  assert.equal(a.debug, false);
  const b = opcoesDoTransporte(CAIXA, 587);
  assert.equal(b.port, 587);
  assert.equal(b.secure, false);
  assert.equal(b.requireTLS, true);
  assert.deepEqual([...PORTAS_DO_SMTP], [465, 587]);
});

test('deveTentarOutraPorta: só falha de CONEXÃO (marcada CONN pelo nodemailer)', () => {
  assert.equal(deveTentarOutraPorta(erro({ code: 'ECONNECTION', command: 'CONN' })), true);
  assert.equal(deveTentarOutraPorta(erro({ code: 'ETIMEDOUT', command: 'CONN' })), true);
  assert.equal(deveTentarOutraPorta(erro({ code: 'EAUTH', command: 'AUTH PLAIN' })), false);
  assert.equal(deveTentarOutraPorta(erro({ code: 'ETIMEDOUT', command: 'DATA' })), false);
  assert.equal(deveTentarOutraPorta(erro({})), false);
  assert.equal(deveTentarOutraPorta(null), false);
});

/** Um passo por transporte criado: o que o verify (conectar + TLS + AUTH) e o sendMail fazem. */
type Passo = { verify?: Error; envio?: Error | string };
function transportes(roteiro: Passo[]) {
  const portas: PortaDoSmtp[] = [];
  const fechados: PortaDoSmtp[] = [];
  const chamadas: string[] = [];
  const criar = (_c: { email: string; senha: string }, porta: PortaDoSmtp): TransporteDeEnvio => {
    portas.push(porta);
    const passo = roteiro[portas.length - 1] ?? {};
    return {
      async verify() { chamadas.push(`verify ${porta}`); if (passo.verify) throw passo.verify; return true; },
      async sendMail() {
        chamadas.push(`sendMail ${porta}`);
        if (passo.envio instanceof Error) throw passo.envio;
        return { messageId: passo.envio ?? '<sem-roteiro@exemplo.test>' };
      },
      close() { fechados.push(porta); },
    };
  };
  return { criar, portas, fechados, chamadas };
}

test('enviarPorSmtp: a 465 não conecta → tenta a 587; fecha os dois transportes', async () => {
  const t = transportes([{ verify: erro({ code: 'ECONNECTION', command: 'CONN' }) }, { envio: '<enviada@exemplo.test>' }]);
  assert.equal(await enviarPorSmtp(CAIXA, SAIDA, t.criar), '<enviada@exemplo.test>');
  assert.deepEqual(t.portas, [465, 587]);
  assert.deepEqual(t.fechados, [465, 587]);
  // a mensagem só sai depois de a porta responder ao verify, e UMA vez
  assert.deepEqual(t.chamadas, ['verify 465', 'verify 587', 'sendMail 587']);
});

test('enviarPorSmtp: senha recusada NÃO tenta a outra porta', async () => {
  const t = transportes([{ verify: erro({ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 }) }]);
  await assert.rejects(enviarPorSmtp(CAIXA, SAIDA, t.criar), (e: Error & { code?: string }) => e.code === 'EAUTH');
  assert.deepEqual(t.portas, [465]);
  assert.deepEqual(t.fechados, [465]);
  assert.deepEqual(t.chamadas, ['verify 465']);
});

test('enviarPorSmtp: as duas portas sem conexão → sobe o último erro, e nada foi mandado', async () => {
  const t = transportes([{ verify: erro({ code: 'ETIMEDOUT', command: 'CONN' }) }, { verify: erro({ code: 'ECONNECTION', command: 'CONN' }) }]);
  await assert.rejects(enviarPorSmtp(CAIXA, SAIDA, t.criar), (e: Error & { code?: string }) => e.code === 'ECONNECTION');
  assert.ok(!t.chamadas.some(c => c.startsWith('sendMail')), t.chamadas.join(','));
  assert.deepEqual(t.fechados, [465, 587]);
});

test('enviarPorSmtp: a conexão caiu DURANTE o envio (o nodemailer marca CONN também aí) → NÃO tenta a 587', async () => {
  // smtp-connection: erro de socket, timeout e "Connection closed unexpectedly" levam command 'CONN'
  // em QUALQUER fase, inclusive depois do DATA. Depois que o sendMail começou, a mensagem pode
  // ter saído: outra porta = e-mail em dobro para a ENEL.
  const t = transportes([{ envio: erro({ code: 'ETIMEDOUT', command: 'CONN' }, 'Timeout') }, { envio: '<dobro@exemplo.test>' }]);
  await assert.rejects(enviarPorSmtp(CAIXA, SAIDA, t.criar), (e: Error & { code?: string }) => e.code === 'ETIMEDOUT');
  assert.deepEqual(t.portas, [465]);
  assert.deepEqual(t.chamadas, ['verify 465', 'sendMail 465']);
  assert.deepEqual(t.fechados, [465]);
});

test('enviarPorSmtp: o erro que sobe NÃO carrega a mensagem crua do servidor (pode ter caixa, texto ou senha)', async () => {
  const cru = erro({ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 }, `Invalid login: 535 ${CAIXA.email} ${SENHA_FALSA}`);
  const t = transportes([{ verify: cru }]);
  await assert.rejects(enviarPorSmtp(CAIXA, SAIDA, t.criar), (e: Error) => {
    assert.ok(!e.message.includes(SENHA_FALSA) && !e.message.includes(CAIXA.email), e.message);
    assert.ok(!String(e.stack ?? '').includes(SENHA_FALSA), 'a pilha tem a senha');
    return true;
  });
});

test('verificarSmtp: diz qual porta respondeu, sem mandar nada', async () => {
  const t = transportes([{ verify: erro({ code: 'ETIMEDOUT', command: 'CONN' }) }, {}]);
  assert.deepEqual(await verificarSmtp(CAIXA, t.criar), { porta: 587 });
  assert.ok(!t.chamadas.some(c => c.startsWith('sendMail')), t.chamadas.join(','));
  assert.deepEqual(t.fechados, [465, 587]);
});

test('falhaDoEnvio: razão curta e código; NUNCA a mensagem crua (pode ter senha, caixa ou texto)', () => {
  const comSenha = erro({ code: 'EAUTH', responseCode: 535 }, `Invalid login: 535 user ${CAIXA.email} pass ${SENHA_FALSA}`);
  const r = falhaDoEnvio(comSenha);
  assert.match(r, /senha de app/);
  assert.match(r, /EAUTH 535/);
  assert.ok(!r.includes(SENHA_FALSA) && !r.includes('abcdefghijklmnop') && !r.includes(CAIXA.email), r);
  assert.match(falhaDoEnvio(erro({ code: 'ECONNECTION' })), /não consegui falar com o servidor/);
  assert.match(falhaDoEnvio(erro({ code: 'EENVELOPE', responseCode: 550 })), /recusou o destinatário/);
  assert.match(falhaDoEnvio(erro({ responseCode: 554 })), /recusou a mensagem/);
  assert.equal(falhaDoEnvio(new Error('qualquer coisa com Prezados, bom dia')), 'falha inesperada no envio');
  assert.equal(falhaDoEnvio('texto solto'), 'falha inesperada no envio');
  // código que não tem cara de código não entra (é texto de fora)
  assert.equal(falhaDoEnvio(erro({ code: `EAUTH ${SENHA_FALSA}` })), 'falha inesperada no envio');
});

test('falhaDoEnvio e podeTerSaido: o que veio do enviarPorSmtp diz se a mensagem PODE ter saído', async () => {
  const falha = async (roteiro: Passo[]) => enviarPorSmtp(CAIXA, SAIDA, transportes(roteiro).criar).then(() => null, (e: unknown) => e);
  // caiu no verify: nada saiu
  const eAntes = await falha([{ verify: erro({ code: 'ECONNECTION', command: 'CONN' }) }, { verify: erro({ code: 'ECONNECTION', command: 'CONN' }) }]);
  assert.match(falhaDoEnvio(eAntes), /não consegui falar com o servidor.*\(ECONNECTION\): nada foi enviado$/);
  assert.equal(podeTerSaido(eAntes), false);
  // caiu durante o envio, sem resposta do servidor: pode ter saído
  const eDurante = await falha([{ envio: erro({ code: 'ETIMEDOUT', command: 'CONN' }) }]);
  assert.match(falhaDoEnvio(eDurante), /caiu durante o envio.*pode ter saído/);
  assert.doesNotMatch(falhaDoEnvio(eDurante), /nada foi enviado/);
  assert.equal(podeTerSaido(eDurante), true);
  // o servidor RESPONDEU que recusou (5xx e 4xx): não saiu
  for (const e of [
    await falha([{ envio: erro({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }) }]),
    await falha([{ envio: erro({ code: 'EMESSAGE', command: 'DATA', responseCode: 451 }) }]),
    await falha([{ envio: erro({ code: 'EAUTH', command: 'AUTH PLAIN' }) }]),
  ]) {
    assert.match(falhaDoEnvio(e), /nada foi enviado$/);
    assert.equal(podeTerSaido(e), false);
  }
  // erro sem fase conhecida e sem recusa: na dúvida, pode ter saído
  assert.equal(podeTerSaido(erro({ code: 'ETIMEDOUT' })), true);
  assert.equal(podeTerSaido(erro({ code: 'EAUTH', responseCode: 535 })), false);
});

// ── a conferência na pasta Enviados (IMAP de mentira) ───────────────────────

const PASTAS: PastaDaLista[] = [
  { path: 'INBOX' },
  // uma pasta COMUM chamada "Enviados" não é a \Sent: a escolha é pelo specialUse do servidor
  { path: 'Enviados' },
  { path: '[Gmail]/E-mails enviados', specialUse: '\\Sent' },
  { path: '[Gmail]/Todos os e-mails', specialUse: '\\All' },
];
interface Guardado { uid: number; messageId?: string; to?: { address?: string }[]; subject?: string; date?: Date | string; internalDate?: Date | string }
interface OpcoesImap {
  pastas?: PastaDaLista[];
  /** o que já está na \Sent */
  guardados?: Guardado[];
  /** conexões (1, 2, …) em que o servidor recusa a entrada */
  falhaNaConexao?: number[];
  /** a busca devolve `false` (o imapflow faz isso quando o servidor recusa) */
  buscaFalsa?: boolean;
  /** mensagens que só aparecem a partir da conexão N (o Gmail demora a mostrar o enviado) */
  aparecemNa?: Record<number, Guardado[]>;
}
function imapFalso(o: OpcoesImap = {}) {
  const r = {
    conexoes: 0, eventos: [] as string[], esperas: [] as number[], credenciais: [] as string[],
    locks: [] as { path: string; readOnly: boolean }[], guardados: [...(o.guardados ?? [])], procuras: [] as ProcuraNosEnviados[],
  };
  const abrir = (c: { email: string; senha: string }): ImapDosEnviados => {
    r.credenciais.push(`${c.email}|${c.senha}`);
    const n = ++r.conexoes;
    return {
      async connect() {
        r.eventos.push(`connect ${n}`);
        r.guardados.push(...(o.aparecemNa?.[n] ?? []));
        if (o.falhaNaConexao?.includes(n)) {
          throw Object.assign(new Error(`Command failed: NO [AUTHENTICATIONFAILED] ${CAIXA.email} ${SENHA_FALSA}`),
            { serverResponseCode: 'AUTHENTICATIONFAILED', authenticationFailed: true });
        }
      },
      async list() { return o.pastas ?? PASTAS; },
      async getMailboxLock(path, op) {
        r.eventos.push(`examine ${path}`);
        r.locks.push({ path, readOnly: op.readOnly });
        return { release() { r.eventos.push(`release ${n}`); } };
      },
      total() { return r.guardados.length; },
      async search(q) {
        r.eventos.push(`search ${n}`);
        if (o.buscaFalsa) return false;
        if (typeof q.seq === 'string') {
          const desde = Number(q.seq.split(':')[0]);
          return r.guardados.filter((_g, i) => i + 1 >= desde).map(g => g.uid);
        }
        return r.guardados.filter(g => (g.to ?? []).some(a => a.address === q.to)).map(g => g.uid);
      },
      async *fetch(uids) {
        for (const g of r.guardados) {
          if (uids.includes(g.uid)) yield { uid: g.uid, envelope: { messageId: g.messageId, to: g.to, subject: g.subject, date: g.date }, internalDate: g.internalDate };
        }
      },
      async logout() { r.eventos.push(`logout ${n}`); },
      close() { r.eventos.push(`close ${n}`); },
    };
  };
  const deps: DepsDaConferencia = { abrir, esperar: async ms => { r.eventos.push(`esperar ${ms}`); r.esperas.push(ms); } };
  return { deps, r };
}

/** 13:00 em Brasília */
const TARDE = new Date('2026-10-24T16:00:00Z');
const DIA = 86_400_000;
const PROCURA: ProcuraNosEnviados = {
  messageId: '<saida-1@exemplo.test>', para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010', inicio: TARDE,
};
const PARA = [{ address: 'canalgd.sp@br.enel.com' }];

test('contaComoSaiu: o Message-ID do envio basta', () => {
  assert.equal(contaComoSaiu({ messageId: '<saida-1@exemplo.test>', to: [], subject: 'outro', date: new Date(0) }, PROCURA), true);
});

test('contaComoSaiu: mesmo destinatário + mesmo assunto + de até 1 min antes do início para cá', () => {
  const base = { messageId: '<trocado-pelo-gmail@gmail.com>', to: PARA, subject: 'RE: TROCA DE RELÓGIO - NT 391000010' };
  assert.equal(contaComoSaiu({ ...base, date: TARDE }, PROCURA), true);
  assert.equal(contaComoSaiu({ ...base, date: new Date(TARDE.getTime() - 50_000) }, PROCURA), true);
  assert.equal(contaComoSaiu({ ...base, date: new Date(TARDE.getTime() + 90_000) }, PROCURA), true);
  // 2 min antes do início: é outro e-mail (uma cobrança anterior, um e-mail à mão)
  assert.equal(contaComoSaiu({ ...base, date: new Date(TARDE.getTime() - 120_000) }, PROCURA), false);
  // outro destinatário ou outro assunto: não é este
  assert.equal(contaComoSaiu({ ...base, to: [{ address: 'outro@enel.com' }], date: TARDE }, PROCURA), false);
  assert.equal(contaComoSaiu({ ...base, subject: 'RE: TROCA DE RELÓGIO - NT 391000020', date: TARDE }, PROCURA), false);
  // maiúscula e espaço sobrando não mudam o assunto nem o destinatário
  assert.equal(contaComoSaiu({ ...base, to: [{ address: ' CanalGD.SP@br.enel.com ' }], subject: ' re:  troca de relógio - nt 391000010 ', date: TARDE }, PROCURA), true);
});

test('contaComoSaiu: na dúvida (sem data legível, sem assunto), conta como saiu', () => {
  const base = { messageId: '<outro@gmail.com>', to: PARA, subject: 'RE: TROCA DE RELÓGIO - NT 391000010' };
  assert.equal(contaComoSaiu({ ...base, date: 'ontem' }, PROCURA), true);
  assert.equal(contaComoSaiu({ ...base, date: undefined }, PROCURA), true);
  assert.equal(contaComoSaiu({ ...base, subject: undefined, date: TARDE }, PROCURA), true);
  // a data do cabeçalho ilegível: vale a INTERNALDATE do servidor
  assert.equal(contaComoSaiu({ ...base, date: 'ontem', internalDate: new Date(TARDE.getTime() - 120_000) }, PROCURA), false);
});

test('conferência: espera 30 s ANTES da 1ª busca; achou pelo Message-ID na 1ª → para ali', async () => {
  const { deps, r } = imapFalso({ guardados: [{ uid: 7, messageId: '<saida-1@exemplo.test>', to: PARA, subject: PROCURA.assunto, date: TARDE }] });
  const c = await conferirNosEnviados(CAIXA, PROCURA, deps);
  assert.deepEqual(c, { resultado: 'achou', buscas: 1, codigo: null });
  assert.equal(r.eventos[0], `esperar ${ESPERA_DOS_ENVIADOS_MS}`);
  assert.equal(ESPERA_DOS_ENVIADOS_MS, 30_000);
  assert.deepEqual(r.esperas, [30_000]);
  assert.equal(r.conexoes, 1);
  // a mesma caixa (a mesma credencial) do envio
  assert.deepEqual(r.credenciais, [`${CAIXA.email}|${SENHA_FALSA}`]);
});

test('conferência: abre SÓ a \\Sent (pelo specialUse, nunca pelo nome) e só para leitura (EXAMINE)', async () => {
  const { deps, r } = imapFalso();
  await conferirNosEnviados(CAIXA, PROCURA, deps);
  assert.ok(r.locks.length > 0);
  for (const l of r.locks) {
    assert.equal(l.path, '[Gmail]/E-mails enviados');
    assert.equal(l.readOnly, true);
  }
  // cada busca fecha o que abriu
  assert.equal(r.eventos.filter(e => e.startsWith('release')).length, r.locks.length);
  assert.equal(r.eventos.filter(e => e.startsWith('logout')).length, r.conexoes);
});

test('conferência: achou por destinatário + assunto + hora (o Gmail trocou o Message-ID)', async () => {
  const { deps } = imapFalso({ guardados: [{ uid: 9, messageId: '<CAoutro@mail.gmail.com>', to: PARA, subject: PROCURA.assunto, date: new Date(TARDE.getTime() + 5_000) }] });
  assert.equal((await conferirNosEnviados(CAIXA, PROCURA, deps)).resultado, 'achou');
});

test('conferência: o enviado que só aparece na 3ª busca é achado (30 s antes e 30 s entre as buscas)', async () => {
  const { deps, r } = imapFalso({ aparecemNa: { 3: [{ uid: 12, messageId: '<saida-1@exemplo.test>', to: PARA, subject: PROCURA.assunto, date: TARDE }] } });
  assert.deepEqual(await conferirNosEnviados(CAIXA, PROCURA, deps), { resultado: 'achou', buscas: 3, codigo: null });
  assert.deepEqual(r.esperas, [30_000, 30_000, 30_000]);
});

test('conferência: 4 buscas limpas sem achar = nao_achou (e a de 2 min antes do início NÃO conta)', async () => {
  const { deps, r } = imapFalso({ guardados: [
    { uid: 3, messageId: '<antiga@gmail.com>', to: PARA, subject: PROCURA.assunto, date: new Date(TARDE.getTime() - 120_000) },
    { uid: 4, messageId: '<outra@gmail.com>', to: [{ address: 'outro@exemplo.test' }], subject: PROCURA.assunto, date: TARDE },
  ] });
  assert.deepEqual(await conferirNosEnviados(CAIXA, PROCURA, deps), { resultado: 'nao_achou', buscas: 4, codigo: null });
  assert.equal(BUSCAS_NOS_ENVIADOS, 4);
  assert.equal(r.conexoes, 4);
  assert.deepEqual(r.esperas, [30_000, 30_000, 30_000, 30_000]);
});

test('conferência: o enviado fora da busca por destinatário ainda é visto pelas últimas da pasta', async () => {
  // o índice de busca do Gmail atrasado: a busca por TO não traz, a cauda da pasta traz
  const { deps } = imapFalso({ guardados: [{ uid: 20, messageId: '<saida-1@exemplo.test>', to: [], subject: PROCURA.assunto, date: TARDE }] });
  assert.equal((await conferirNosEnviados(CAIXA, PROCURA, deps)).resultado, 'achou');
});

test('conferência: o IMAP falha → nao_conferiu, com o CÓDIGO e sem a mensagem crua', async () => {
  const { deps } = imapFalso({ falhaNaConexao: [1, 2, 3, 4] });
  const c = await conferirNosEnviados(CAIXA, PROCURA, deps);
  assert.equal(c.resultado, 'nao_conferiu');
  assert.equal(c.codigo, 'AUTHENTICATIONFAILED');
  assert.ok(!JSON.stringify(c).includes(SENHA_FALSA) && !JSON.stringify(c).includes(CAIXA.email));
});

test('conferência: UMA busca com erro e as outras limpas = nao_conferiu (na dúvida, não se diz que não saiu)', async () => {
  const { deps } = imapFalso({ falhaNaConexao: [2] });
  assert.equal((await conferirNosEnviados(CAIXA, PROCURA, deps)).resultado, 'nao_conferiu');
});

test('conferência: a busca devolvida como false é erro, não "não achei"', async () => {
  const { deps } = imapFalso({ buscaFalsa: true });
  assert.equal((await conferirNosEnviados(CAIXA, PROCURA, deps)).resultado, 'nao_conferiu');
});

test('conferência: conta sem a pasta \\Sent → nao_conferiu na hora (nada de abrir outra pasta)', async () => {
  const { deps, r } = imapFalso({ pastas: [{ path: 'INBOX' }, { path: 'Enviados' }] });
  assert.deepEqual(await conferirNosEnviados(CAIXA, PROCURA, deps), { resultado: 'nao_conferiu', buscas: 1, codigo: 'SEM_PASTA_SENT' });
  assert.deepEqual(r.locks, []);
});

test('conferência: nunca lança, nem se a espera quebrar', async () => {
  const { deps } = imapFalso();
  deps.esperar = async () => { throw new Error('relógio quebrado'); };
  assert.equal((await conferirNosEnviados(CAIXA, PROCURA, deps)).resultado, 'nao_conferiu');
});

// ── as RPCs de fila.ts: nomes e tipos do banco vivo (pg_proc, 26/10/2026) ───

interface Chamada { rpc: string; corpo: Record<string, unknown> }
const chamadas: Chamada[] = [];
type Resposta = { status: number; corpo: unknown };
let responder: (c: Chamada) => Resposta = () => ({ status: 200, corpo: null });

globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const rpc = new URL(url).pathname.split('/').pop() ?? '';
  const corpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  const chamada = { rpc, corpo };
  chamadas.push(chamada);
  const { status, corpo: dados } = responder(chamada);
  // função `void` = 204 do PostgREST, sem corpo
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const ERRO_COM_DADOS = {
  code: 'P0001', message: 'nenhuma cobrança em envio — TEODORICO VALADARES QUINTINO, RE: TROCA DE RELÓGIO',
  details: 'Failing row contains (TEODORICO VALADARES QUINTINO)', hint: null,
};

test('iniciarEnvioDeCobranca: chama ludmilla_cobranca_iniciar_envio só com p_run_id e lê a linha (TABLE do banco)', async () => {
  chamadas.length = 0;
  responder = () => ({ status: 200, corpo: [{
    recusa: null, cobranca_id: 'c-1', situacao_anterior: 'aguardando_envio', aprovada_por: 'pessoa-1',
    ultima_enviada_em: '2026-10-10T13:00:00.123456+00:00', para: 'canalgd.sp@br.enel.com',
    assunto: 'RE: TROCA DE RELÓGIO - NT 391000010', texto: 'Prezados, bom dia.', in_reply_to: '<cob-nota-1@enel.test>',
    referencias: '<cob-pedido@exemplo.test>  <cob-nota-1@enel.test>', nota_servico: '070712345678',
  }] });
  const c = await iniciarEnvioDeCobranca('run-envio-1');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].rpc, 'ludmilla_cobranca_iniciar_envio');
  assert.deepEqual(chamadas[0].corpo, { p_run_id: 'run-envio-1' });
  assert.deepEqual(c, {
    recusa: null, cobrancaId: 'c-1', situacaoAnterior: 'aguardando_envio', aprovadaPor: 'pessoa-1',
    ultimaEnviadaEm: '2026-10-10T13:00:00.123456+00:00', para: 'canalgd.sp@br.enel.com',
    assunto: 'RE: TROCA DE RELÓGIO - NT 391000010', texto: 'Prezados, bom dia.', inReplyTo: '<cob-nota-1@enel.test>',
    referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'], nota: '070712345678',
  });
});

test('iniciarEnvioDeCobranca: a recusa do banco vem com o resto nulo (e referencias vazia)', async () => {
  responder = () => ({ status: 200, corpo: [{
    recusa: 'a aprovação não é de uma pessoa ativa da equipe deste tenant', cobranca_id: 'c-1', situacao_anterior: 'aguardando_envio',
    aprovada_por: null, ultima_enviada_em: null, para: null, assunto: null, texto: null, in_reply_to: null, referencias: null, nota_servico: null,
  }] });
  const c = await iniciarEnvioDeCobranca('run-envio-1');
  assert.equal(c.recusa, 'a aprovação não é de uma pessoa ativa da equipe deste tenant');
  assert.equal(c.para, null);
  assert.equal(c.texto, null);
  assert.deepEqual(c.referencias, []);
});

test('iniciarEnvioDeCobranca: resposta vazia = função velha no banco → estoura (nunca "pode enviar")', async () => {
  responder = () => ({ status: 200, corpo: [] });
  await assert.rejects(iniciarEnvioDeCobranca('run-envio-1'), /não respondeu/);
});

test('iniciarEnvioDeCobranca: o erro leva só o CÓDIGO', async () => {
  responder = () => ({ status: 400, corpo: ERRO_COM_DADOS });
  await assert.rejects(iniciarEnvioDeCobranca('run-envio-1'), (e: Error) => {
    assert.match(e.message, /iniciar o envio/);
    assert.match(e.message, /P0001/);
    assert.ok(!e.message.includes('TEODORICO') && !e.message.includes('RELÓGIO'), e.message);
    return true;
  });
});

test('cobrancaEnviada: ludmilla_cobranca_enviada(p_run_id, p_message_id); o erro leva só o código', async () => {
  chamadas.length = 0;
  responder = () => ({ status: 204, corpo: null });
  await cobrancaEnviada('run-envio-1', '<saiu-1@exemplo.test>');
  assert.equal(chamadas[0].rpc, 'ludmilla_cobranca_enviada');
  assert.deepEqual(chamadas[0].corpo, { p_run_id: 'run-envio-1', p_message_id: '<saiu-1@exemplo.test>' });
  responder = () => ({ status: 400, corpo: ERRO_COM_DADOS });
  await assert.rejects(cobrancaEnviada('run-envio-1', '<saiu-1@exemplo.test>'), (e: Error) => {
    assert.match(e.message, /registrar o envio/);
    assert.match(e.message, /P0001/);
    assert.ok(!e.message.includes('TEODORICO'), e.message);
    return true;
  });
});

test('cobrancaFalhou: ludmilla_cobranca_falhou(p_run_id, p_erro) com até 500 caracteres; o erro leva só o código', async () => {
  chamadas.length = 0;
  responder = () => ({ status: 204, corpo: null });
  await cobrancaFalhou('run-envio-1', 'x'.repeat(600));
  assert.equal(chamadas[0].rpc, 'ludmilla_cobranca_falhou');
  assert.deepEqual(Object.keys(chamadas[0].corpo).sort(), ['p_erro', 'p_run_id']);
  assert.equal(chamadas[0].corpo.p_run_id, 'run-envio-1');
  assert.equal(String(chamadas[0].corpo.p_erro).length, 500);
  responder = () => ({ status: 400, corpo: ERRO_COM_DADOS });
  await assert.rejects(cobrancaFalhou('run-envio-1', 'motivo'), (e: Error) => {
    assert.match(e.message, /registrar a falha/);
    assert.ok(!e.message.includes('TEODORICO'), e.message);
    return true;
  });
});

test('as RPCs do envio: falha de rede (sem código) não sai com "código " vazio', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch failed: ECONNREFUSED 10.0.0.1'); }) as typeof fetch;
  try {
    for (const f of [() => iniciarEnvioDeCobranca('r'), () => cobrancaEnviada('r', '<m@exemplo.test>'), () => cobrancaFalhou('r', 'm')]) {
      await assert.rejects(f(), (e: Error) => { assert.match(e.message, /sem código/); assert.doesNotMatch(e.message, /código \)/); return true; });
    }
  } finally { globalThis.fetch = original; }
});

test('DEPS_ENVIO usa as RPCs de verdade (e a credencial da caixa de hoje)', () => {
  assert.equal(DEPS_ENVIO.iniciarEnvio, iniciarEnvioDeCobranca);
  assert.equal(DEPS_ENVIO.credencialDaCaixa, credencialDaCaixa);
  assert.equal(DEPS_ENVIO.enviada, cobrancaEnviada);
  assert.equal(DEPS_ENVIO.falhou, cobrancaFalhou);
});

// ── o run enviar_cobranca ──────────────────────────────────────────────────

const RUN: Run = { id: 'run-envio-1', tenant_id: 'tenant-cob', account_id: 'conta-enel', tipo: 'enviar_cobranca', situacao: 'rodando' };
const COBRANCA: CobrancaParaEnviar = {
  recusa: null, cobrancaId: 'c-1', situacaoAnterior: 'aguardando_envio', aprovadaPor: 'pessoa-1', ultimaEnviadaEm: null,
  para: 'canalgd.sp@br.enel.com', assunto: 'RE: TROCA DE RELÓGIO - NT 391000010',
  texto: 'Prezados, bom dia.\n\nReferente à nota de serviço nº 70712345678 — titular TEODORICO VALADARES QUINTINO.\n\nAtenciosamente,\nEquipe GD Manager',
  inReplyTo: '<cob-nota-1@enel.test>', referencias: ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>'], nota: '070712345678',
};

/**
 * Um passo por chamada do SMTP: `ok` saiu; `queda_chegou` caiu no meio, mas o Gmail guardou na
 * \Sent; `queda_sumiu` caiu no meio e não está em lugar nenhum; ou um erro qualquer.
 */
type PassoSmtp = 'ok' | 'queda_chegou' | 'queda_sumiu' | Error;

function envio(o: {
  cobranca?: Partial<CobrancaParaEnviar>; iniciarFalha?: boolean; credFalha?: boolean; smtp?: PassoSmtp[];
  enviadaFalhas?: number; falhouFalha?: boolean; imap?: OpcoesImap;
} = {}) {
  const im = imapFalso(o.imap);
  const d = {
    ordem: [] as string[], envios: [] as EmailDeSaida[], tentativasDoRegistro: [] as [string, string][],
    enviadas: [] as [string, string][], falhas: [] as [string, string][], pausas: [] as number[],
    procuras: [] as ProcuraNosEnviados[], imap: im.r,
  };
  let falhasDaEnviada = o.enviadaFalhas ?? 0;
  const deps: DepsEnvio = {
    async iniciarEnvio(runId) {
      d.ordem.push('iniciar');
      if (o.iniciarFalha) throw new Error('rede caiu');
      assert.equal(runId, RUN.id);
      return { ...COBRANCA, ...o.cobranca };
    },
    async credencialDaCaixa(conta) {
      d.ordem.push('credencial');
      if (o.credFalha) throw new Error(`sem agent_config ${SENHA_FALSA}`);
      assert.equal(conta, RUN.account_id);
      return CAIXA;
    },
    async enviar(c, m) {
      d.ordem.push('enviar');
      assert.equal(c.senha, SENHA_FALSA);
      const passo = (o.smtp ?? [])[d.envios.length] ?? 'ok';
      // uma CÓPIA do que saiu NESTA chamada (o objeto pode ser mexido depois)
      d.envios.push({ ...m, referencias: [...m.referencias] });
      if (passo instanceof Error) throw passo;
      if (passo === 'queda_chegou') {
        im.r.guardados.push({ uid: 100 + d.envios.length, messageId: m.messageId, to: [{ address: m.para }], subject: m.assunto, date: TARDE });
        throw queda();
      }
      if (passo === 'queda_sumiu') throw queda();
      return m.messageId;
    },
    async enviada(runId, id) {
      d.ordem.push('enviada');
      d.tentativasDoRegistro.push([runId, id]);
      if (falhasDaEnviada-- > 0) throw new Error('banco fora');
      d.enviadas.push([runId, id]);
    },
    async falhou(runId, motivo) {
      d.ordem.push('falhou');
      d.falhas.push([runId, motivo]);
      if (o.falhouFalha) throw new Error('banco fora');
    },
    async esperar(ms) { d.ordem.push('pausa'); d.pausas.push(ms); },
    async conferirEnviados(c, p) {
      d.ordem.push('conferir');
      d.procuras.push(p);
      return conferirNosEnviados(c, p, im.deps);
    },
  };
  return { deps, d };
}
const rodar = (deps: DepsEnvio, agora: Date = TARDE) => comLogs(() => executarEnvioDeCobranca(RUN, deps, () => agora));

test('aprovada e travada na ENEL: sai UMA vez, com a saudação da hora e um Message-ID nosso, e o banco registra', async () => {
  const { deps, d } = envio();
  const { r } = await rodar(deps);
  assert.equal(r, 'enviada');
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'enviada']);
  assert.equal(d.envios.length, 1);
  const m = d.envios[0];
  assert.equal(m.de, CAIXA.email);
  assert.equal(m.para, 'canalgd.sp@br.enel.com');
  assert.equal(m.assunto, 'RE: TROCA DE RELÓGIO - NT 391000010');
  assert.equal(m.texto, COBRANCA.texto!.replace('Prezados, bom dia.', 'Prezados, boa tarde.'));
  assert.equal(m.inReplyTo, '<cob-nota-1@enel.test>');
  assert.deepEqual(m.referencias, ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>']);
  assert.match(m.messageId, /^<[0-9a-f-]{36}@exemplo\.test>$/);
  assert.deepEqual(d.enviadas, [[RUN.id, m.messageId]]);
  assert.deepEqual(d.falhas, []);
  assert.equal(d.imap.conexoes, 0, 'abriu o IMAP sem queda');
});

test('o banco recusou: nada sai, a senha nem é lida, e o banco fecha com o motivo dele', async () => {
  const motivo = 'este pedido de envio não veio da aprovação da cobrança';
  const { deps, d } = envio({ cobranca: { recusa: motivo, para: null, texto: null } });
  assert.equal((await rodar(deps)).r, 'recusada');
  assert.deepEqual(d.ordem, ['iniciar', 'falhou']);
  assert.deepEqual(d.falhas, [[RUN.id, motivo]]);
});

test('a recusa nova do banco (aprovação que não é de pessoa ativa da equipe): igual às outras — nada sai, a frase vai para a equipe', async () => {
  const motivo = 'a aprovação não é de uma pessoa ativa da equipe deste tenant';
  const { deps, d } = envio({ cobranca: { recusa: motivo, aprovadaPor: null, para: null, texto: null } });
  const { r, logs } = await rodar(deps);
  assert.equal(r, 'recusada');
  assert.deepEqual(d.ordem, ['iniciar', 'falhou']);
  assert.equal(d.envios.length, 0);
  assert.deepEqual(d.falhas, [[RUN.id, motivo]]);
  assert.match(logs, /pessoa ativa da equipe/);
});

for (const [caso, cobranca, motivo] of [
  ['destinatário fora da ENEL vindo do banco', { para: 'canal@exemplo.test' }, /@enel\.com/],
  ['destinatário que só PARECE da ENEL', { para: 'canalgd.sp@br.enel.com.exemplo.test' }, /@enel\.com/],
  ['menos de 7 dias desde o último envio', { ultimaEnviadaEm: new Date(TARDE.getTime() - 2 * DIA).toISOString() }, /7 dias/],
  ['último envio há 6 dias e 23 h, no formato do banco', { ultimaEnviadaEm: '2026-10-17T17:00:00.123456+00:00' }, /7 dias/],
  ['data do último envio ilegível', { ultimaEnviadaEm: 'ontem' }, /7 dias/],
  ['sem aprovação de uma pessoa', { aprovadaPor: null }, /aprovada/],
  ['não estava esperando envio', { situacaoAnterior: 'agendada' }, /esperando envio/],
  ['sem texto', { texto: '   \n ' }, /sem texto/],
] as [string, Partial<CobrancaParaEnviar>, RegExp][]) {
  test(`trava do WORKER (o banco deixou passar): ${caso} — nada sai`, async () => {
    const { deps, d } = envio({ cobranca });
    assert.equal((await rodar(deps)).r, 'recusada');
    assert.equal(d.envios.length, 0);
    assert.ok(!d.ordem.includes('enviar'));
    assert.ok(!d.ordem.includes('credencial'), 'a senha foi lida sem precisar');
    assert.equal(d.falhas.length, 1);
    assert.match(d.falhas[0][1], motivo);
    assert.match(d.falhas[0][1], /nada foi enviado/);
  });
}

test('7 dias cravados desde o último envio: sai', async () => {
  const { deps, d } = envio({ cobranca: { ultimaEnviadaEm: new Date(TARDE.getTime() - 7 * DIA).toISOString() } });
  assert.equal((await rodar(deps)).r, 'enviada');
  assert.equal(d.envios.length, 1);
});

test('o SMTP recusou a senha: o banco recebe a razão curta, nunca a senha nem o texto; o log idem; nada de IMAP', async () => {
  const smtp = erro({ code: 'EAUTH', responseCode: 535 }, `Invalid login ${SENHA_FALSA} Referente à nota de serviço nº 70712345678 — titular TEODORICO`);
  const { deps, d } = envio({ smtp: [smtp] });
  const { r, logs } = await rodar(deps);
  assert.equal(r, 'falhou');
  assert.match(d.falhas[0][1], /senha de app.*EAUTH 535/);
  assert.ok(!d.ordem.includes('conferir'));
  for (const proibido of [SENHA_FALSA, 'abcdefghijklmnop', 'TEODORICO', 'Referente', '70712345678', CAIXA.email]) {
    assert.ok(!d.falhas[0][1].includes(proibido), `o banco recebeu "${proibido}"`);
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

test('recusa do servidor no 1º envio: falhou "nada foi enviado", UM envio, sem IMAP e sem reenvio', async () => {
  const { deps, d } = envio({ smtp: [recusa()] });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'falhou']);
  assert.equal(d.envios.length, 1);
  assert.equal(d.imap.conexoes, 0);
  assert.match(d.falhas[0][1], /recusou a mensagem \(EMESSAGE 554\): nada foi enviado/);
});

test('nem conectou (verify): falhou "nada foi enviado", sem IMAP', async () => {
  const { deps, d } = envio({ smtp: [new FalhaDoSmtp(erro({ code: 'ECONNECTION', command: 'CONN' }), 'conexao')] });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.imap.conexoes, 0);
  assert.match(d.falhas[0][1], /nada foi enviado/);
});

// ── a queda no meio do envio: confere a pasta Enviados ────────────────────

test('queda → achou na \\Sent pelo Message-ID → enviada, com UM envio só', async () => {
  const { deps, d } = envio({ smtp: ['queda_chegou'] });
  const { r } = await rodar(deps);
  assert.equal(r, 'enviada');
  assert.equal(d.envios.length, 1);
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'conferir', 'enviada']);
  // procurou o e-mail que saiu: o MESMO Message-ID, o destinatário, o assunto e a hora do início
  assert.deepEqual(d.procuras, [{ messageId: d.envios[0].messageId, para: 'canalgd.sp@br.enel.com', assunto: d.envios[0].assunto, inicio: TARDE }]);
  assert.deepEqual(d.enviadas, [[RUN.id, d.envios[0].messageId]]);
  assert.deepEqual(d.falhas, []);
  // a conferência usou a MESMA caixa: a senha não foi lida de novo
  assert.equal(d.ordem.filter(x => x === 'credencial').length, 1);
  assert.deepEqual(d.imap.credenciais, [`${CAIXA.email}|${SENHA_FALSA}`]);
});

test('queda → achou por destinatário, assunto e hora (o Gmail trocou o Message-ID) → enviada', async () => {
  const { deps, d } = envio({
    smtp: ['queda_sumiu'],
    imap: { guardados: [{ uid: 50, messageId: '<CAtrocado@mail.gmail.com>', to: [{ address: 'canalgd.sp@br.enel.com' }], subject: COBRANCA.assunto!, date: new Date(TARDE.getTime() + 2_000) }] },
  });
  assert.equal((await rodar(deps)).r, 'enviada');
  assert.equal(d.envios.length, 1);
  // o banco registra o Message-ID que o worker pôs
  assert.deepEqual(d.enviadas, [[RUN.id, d.envios[0].messageId]]);
});

test('queda → achou, mas o registro falhou UMA vez: repete com o MESMO run e Message-ID; nunca falhou', async () => {
  const { deps, d } = envio({ smtp: ['queda_chegou'], enviadaFalhas: 1 });
  assert.equal((await rodar(deps)).r, 'enviada');
  assert.deepEqual(d.tentativasDoRegistro, [[RUN.id, d.envios[0].messageId], [RUN.id, d.envios[0].messageId]]);
  assert.deepEqual(d.falhas, []);
});

test('queda → não achou → reenvia UMA vez com o MESMO Message-ID → enviada, com DOIS envios', async () => {
  const { deps, d } = envio({ smtp: ['queda_sumiu', 'ok'] });
  assert.equal((await rodar(deps)).r, 'enviada');
  assert.equal(d.envios.length, 2);
  assert.deepEqual(d.envios[1], d.envios[0], 'o reenvio é o MESMO e-mail');
  assert.equal(d.envios[1].messageId, d.envios[0].messageId);
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'conferir', 'enviar', 'enviada']);
  assert.deepEqual(d.enviadas, [[RUN.id, d.envios[0].messageId]]);
  assert.deepEqual(d.falhas, []);
});

test('queda → não achou → o reenvio cai → achou → enviada (DOIS envios)', async () => {
  const { deps, d } = envio({ smtp: ['queda_sumiu', 'queda_chegou'] });
  assert.equal((await rodar(deps)).r, 'enviada');
  assert.equal(d.envios.length, 2);
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'conferir', 'enviar', 'conferir', 'enviada']);
});

test('queda → não achou → o reenvio cai → não achou → falhou "2 tentativas", DOIS envios e NUNCA três', async () => {
  const { deps, d } = envio({ smtp: ['queda_sumiu', 'queda_sumiu', 'ok', 'ok'] });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.envios.length, 2);
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'conferir', 'enviar', 'conferir', 'falhou']);
  assert.deepEqual(d.falhas, [[RUN.id, 'não saiu: conferido na pasta Enviados, 2 tentativas']]);
  assert.deepEqual(d.enviadas, []);
});

test('queda → não achou → o reenvio é RECUSADO pelo servidor → falhou "nada foi enviado", sem 2ª conferência', async () => {
  const { deps, d } = envio({ smtp: ['queda_sumiu', recusa()] });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.envios.length, 2);
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'conferir', 'enviar', 'falhou']);
  assert.match(d.falhas[0][1], /nada foi enviado/);
  assert.match(d.falhas[0][1], /reenvio/);
});

test('queda → o IMAP falha → falhou "não deu para conferir", UM envio, sem reenvio, só o código do IMAP', async () => {
  const { deps, d } = envio({ smtp: ['queda_sumiu', 'ok'], imap: { falhaNaConexao: [1, 2, 3, 4] } });
  const { r, logs } = await rodar(deps);
  assert.equal(r, 'falhou');
  assert.equal(d.envios.length, 1);
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'conferir', 'falhou']);
  assert.match(d.falhas[0][1], /não deu para conferir se o e-mail saiu/);
  assert.match(d.falhas[0][1], /confira a pasta Enviados do Gmail antes de enviar de novo/);
  assert.match(d.falhas[0][1], /AUTHENTICATIONFAILED/);
  for (const proibido of [SENHA_FALSA, CAIXA.email, 'Command failed']) {
    assert.ok(!d.falhas[0][1].includes(proibido), `o banco recebeu "${proibido}"`);
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

test('queda no REENVIO → o IMAP falha → falhou "não deu para conferir" (nunca uma 3ª)', async () => {
  const { deps, d } = envio({ smtp: ['queda_sumiu', 'queda_sumiu', 'ok'], imap: { falhaNaConexao: [5, 6, 7, 8] } });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.envios.length, 2);
  assert.match(d.falhas[0][1], /não deu para conferir se o e-mail saiu/);
});

test('queda: o log diz o run, a fase, o código e o resultado da conferência — nada do texto, do assunto nem da senha', async () => {
  const { deps } = envio({ smtp: ['queda_sumiu', 'queda_sumiu'] });
  const { logs } = await rodar(deps);
  assert.match(logs, /"resultado":"nao_achou"/);
  assert.match(logs, /"codigo":"ETIMEDOUT"/);
  assert.match(logs, /"fase":"/);
  assert.match(logs, new RegExp(RUN.id));
  for (const proibido of ['TEODORICO', 'Referente', 'RELÓGIO', '70712345678', '070712345678', SENHA_FALSA, 'abcdefghijklmnop', CAIXA.email]) {
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

// ── o registro, a guarda e o resto ─────────────────────────────────────────

test('saiu e o registro falhou UMA vez: repete enviada com o MESMO run e Message-ID e registra; NUNCA chama falhou', async () => {
  const { deps, d } = envio({ enviadaFalhas: 1 });
  assert.equal((await rodar(deps)).r, 'enviada');
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'enviada', 'pausa', 'enviada']);
  assert.deepEqual(d.tentativasDoRegistro, [[RUN.id, d.envios[0].messageId], [RUN.id, d.envios[0].messageId]]);
  assert.deepEqual(d.enviadas, [[RUN.id, d.envios[0].messageId]]);
  assert.ok(d.pausas[0] > 0);
  assert.deepEqual(d.falhas, []);
});

test('saiu e o registro falhou DUAS vezes: enviada_sem_registro, sem falhou (devolver faria alguém reenviar)', async () => {
  const { deps, d } = envio({ enviadaFalhas: 2 });
  const { r, logs } = await rodar(deps);
  assert.equal(r, 'enviada_sem_registro');
  assert.equal(d.envios.length, 1);
  assert.deepEqual(d.ordem, ['iniciar', 'credencial', 'enviar', 'enviada', 'pausa', 'enviada']);
  assert.deepEqual(d.tentativasDoRegistro, [[RUN.id, d.envios[0].messageId], [RUN.id, d.envios[0].messageId]]);
  assert.deepEqual(d.falhas, []);
  assert.match(logs, /SAIU/);
  for (const proibido of ['TEODORICO', 'Referente', 'RELÓGIO', '70712345678', SENHA_FALSA, CAIXA.email]) {
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

test('depois que saiu, nem um erro inesperado chama falhou', async () => {
  const { deps, d } = envio({ enviadaFalhas: 2 });
  // a pausa estoura de um jeito que ninguém previu (síncrono, fora da promessa)
  deps.esperar = () => { throw new Error('pausa quebrada'); };
  assert.equal((await rodar(deps)).r, 'enviada_sem_registro');
  assert.equal(d.envios.length, 1);
  assert.deepEqual(d.falhas, []);
});

test('erro inesperado no meio da conferência (pode ter saído): falhou "não deu para conferir", nunca reenvia', async () => {
  const { deps, d } = envio({ smtp: ['queda_sumiu', 'ok'] });
  deps.conferirEnviados = () => { throw new Error('quebrou'); };
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.envios.length, 1);
  assert.match(d.falhas[0][1], /não deu para conferir se o e-mail saiu/);
});

test('erro inesperado ANTES do envio: nada sai e o banco fecha', async () => {
  const { deps, d } = envio();
  const iniciar = deps.iniciarEnvio;
  deps.iniciarEnvio = async runId => {
    const c = await iniciar(runId);
    return Object.defineProperty({ ...c }, 'referencias', { get() { throw new Error('quebrado'); } });
  };
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.envios.length, 0);
  assert.equal(d.falhas.length, 1);
  assert.match(d.falhas[0][1], /nada foi enviado/);
});

test('sem o acesso à caixa: nada sai (e o motivo não leva a mensagem crua)', async () => {
  const { deps, d } = envio({ credFalha: true });
  const { r, logs } = await rodar(deps);
  assert.equal(r, 'falhou');
  assert.equal(d.envios.length, 0);
  assert.match(d.falhas[0][1], /acesso à caixa/);
  assert.match(d.falhas[0][1], /nada foi enviado/);
  assert.ok(!d.falhas[0][1].includes(SENHA_FALSA) && !logs.includes(SENHA_FALSA));
});

test('o banco caiu no começo: nada sai', async () => {
  const { deps, d } = envio({ iniciarFalha: true });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.deepEqual(d.ordem, ['iniciar', 'falhou']);
  assert.match(d.falhas[0][1], /nada foi enviado/);
});

test('nem o falhou responde: o run não lança (o banco fecha o run preso depois)', async () => {
  const { deps, d } = envio({ smtp: [recusa()], falhouFalha: true });
  assert.equal((await rodar(deps)).r, 'falhou');
  assert.equal(d.falhas.length, 1);
});

test('os cabeçalhos do banco passam de novo pela trava do worker (cabecalhosDaResposta)', async () => {
  const { deps, d } = envio({ cobranca: {
    referencias: ['<cob-pedido@exemplo.test>', 'lixo-sem-arroba', '<com espaço@exemplo.test>', '<cob-nota-1@enel.test>'],
  } });
  await rodar(deps);
  assert.equal(d.envios[0].inReplyTo, '<cob-nota-1@enel.test>');
  assert.deepEqual(d.envios[0].referencias, ['<cob-pedido@exemplo.test>', '<cob-nota-1@enel.test>']);

  const sem = envio({ cobranca: { inReplyTo: 'imap-uid-7', referencias: ['<cob-pedido@exemplo.test>'] } });
  await rodar(sem.deps);
  assert.equal(sem.d.envios[0].inReplyTo, null);
  assert.deepEqual(sem.d.envios[0].referencias, ['<cob-pedido@exemplo.test>']);
});

test('o assunto do banco passa de novo pela limpeza: uma linha só, com "RE:" uma vez', async () => {
  const { deps, d } = envio({ cobranca: { assunto: 'RE: TROCA DE RELÓGIO\r\nBcc: alguem@exemplo.test' } });
  await rodar(deps);
  assert.doesNotMatch(d.envios[0].assunto, /[\r\n]/);
  assert.match(d.envios[0].assunto, /^RE: TROCA DE RELÓGIO/);
  const vazio = envio({ cobranca: { assunto: null } });
  await rodar(vazio.deps);
  assert.equal(vazio.d.envios[0].assunto, 'RE: TROCA DE RELÓGIO');
});

test('de manhã a saudação fica "bom dia"; primeira linha mexida pela pessoa não muda', async () => {
  const manha = new Date('2026-10-24T12:00:00Z'); // 9:00 em Brasília
  const a = envio({ cobranca: { texto: 'Prezados, boa tarde.\n\nTexto.' } });
  await rodar(a.deps, manha);
  assert.equal(a.d.envios[0].texto, 'Prezados, bom dia.\n\nTexto.');
  const b = envio({ cobranca: { texto: 'Bom dia, pessoal da ENEL.\n\nTexto.' } });
  await rodar(b.deps);
  assert.equal(b.d.envios[0].texto, 'Bom dia, pessoal da ENEL.\n\nTexto.');
});

test('o log diz o run e o endereço da ENEL, e nada do texto, do assunto, do titular, da nota ou da senha', async () => {
  const { deps } = envio();
  const { logs } = await rodar(deps);
  assert.match(logs, new RegExp(RUN.id));
  assert.match(logs, /canalgd\.sp@br\.enel\.com/);
  for (const proibido of ['TEODORICO', 'Referente', 'RELÓGIO', '70712345678', '070712345678', SENHA_FALSA, 'abcdefghijklmnop', CAIXA.email]) {
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

test('o log da trava recusada também não leva texto, assunto, titular nem nota', async () => {
  const { deps } = envio({ cobranca: { ultimaEnviadaEm: new Date(TARDE.getTime() - DIA).toISOString() } });
  const { logs } = await rodar(deps);
  assert.match(logs, /7 dias/);
  for (const proibido of ['TEODORICO', 'Referente', 'RELÓGIO', '70712345678', '070712345678', SENHA_FALSA, CAIXA.email]) {
    assert.ok(!logs.includes(proibido), `o log tem "${proibido}"`);
  }
});

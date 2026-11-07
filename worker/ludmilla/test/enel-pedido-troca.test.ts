// worker/ludmilla/test/enel-pedido-troca.test.ts
// O pedido da troca do relógio: é um e-mail NOVO (sem RE: e sem conversa), com o assunto que o banco
// montou, e passa pelas mesmas proteções da cobrança. Dublês de SMTP e de banco: nada sai para a rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPS_ENVIO, executarEnvioDeCobranca, type DepsEnvio } from '../src/email/enel/enviar.js';
import {
  DEPS_ENVIO_PEDIDO, ajustarSaudacaoDoPedido, falaDePedido, travaDoPedido,
} from '../src/email/enel/pedido-troca.js';
import { FalhaDoSmtp, type EmailDeSaida } from '../src/email/smtp.js';
import type { Conferencia } from '../src/email/enviados.js';
import type { CobrancaParaEnviar, Run } from '../src/fila.js';

const MANHA = new Date('2026-11-09T13:00:00Z');
const TARDE = new Date('2026-11-09T18:00:00Z');
const SENHA = 'abcd efgh ijkl mnop';
const CAIXA = { email: 'ludmilla.caixa@exemplo.test', senha: SENHA };
const ASSUNTO = 'TROCA DE RELÓGIO - FULANA DE TAL - NT 391000010';
const TEXTO = 'Bom dia caro analista, a NT 391000010 passou pela etapa de vistoria, por gentileza seguir para a troca de relógio.\n\nAtenciosamente,\nEquipe GD Manager';
const RUN = { id: 'run-1', tipo: 'enviar_pedido_troca', account_id: 'conta-1' } as unknown as Run;
const PEDIDO: CobrancaParaEnviar = {
  recusa: null, cobrancaId: 'pedido-1', situacaoAnterior: 'aguardando_envio', aprovadaPor: 'pessoa-1',
  ultimaEnviadaEm: null, para: 'canalgd.sp@br.enel.com', assunto: ASSUNTO, texto: TEXTO, inReplyTo: null, referencias: [], nota: null,
};

interface Registro { enviados: EmailDeSaida[]; enviada: string[]; falhou: string[]; semConfirmacao: string[]; conferidas: number }

function montar(over: Partial<DepsEnvio> & { pedido?: Partial<CobrancaParaEnviar> } = {}): { deps: DepsEnvio; reg: Registro } {
  const reg: Registro = { enviados: [], enviada: [], falhou: [], semConfirmacao: [], conferidas: 0 };
  const { pedido, ...resto } = over;
  const deps: DepsEnvio = {
    ...DEPS_ENVIO_PEDIDO,
    iniciarEnvio: async () => ({ ...PEDIDO, ...pedido }),
    credencialDaCaixa: async () => CAIXA,
    enviar: async (_c, m) => { reg.enviados.push(m); return m.messageId; },
    enviada: async (_r, id) => { reg.enviada.push(id); },
    falhou: async (_r, e) => { reg.falhou.push(falaDePedido(e)); },
    semConfirmacao: async (_r, e) => { reg.semConfirmacao.push(e); },
    esperar: async () => undefined,
    conferirEnviados: async () => { reg.conferidas++; return { resultado: 'achou', buscas: 1, codigo: null } as Conferencia; },
    ...resto,
  };
  return { deps, reg };
}

const queda = () => new FalhaDoSmtp(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'CONN' }), 'mensagem');
const recusa = () => new FalhaDoSmtp(Object.assign(new Error(`554 ${SENHA}`), { code: 'EMESSAGE', responseCode: 554 }), 'mensagem');

async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = console.log;
  const linhas: string[] = [];
  console.log = (...a: unknown[]) => { linhas.push(a.map(String).join(' ')); };
  try { return { r: await f(), logs: linhas.join('\n') }; } finally { console.log = original; }
}

test('o e-mail é novo: sem RE:, sem conversa, com o assunto do banco e o destinatário travado', async () => {
  const { deps, reg } = montar();
  const { r } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
  assert.equal(r, 'enviada');
  assert.equal(reg.enviados.length, 1);
  const m = reg.enviados[0]!;
  assert.equal(m.assunto, ASSUNTO);
  assert.equal(m.para, 'canalgd.sp@br.enel.com');
  assert.equal(m.inReplyTo, null);
  assert.deepEqual(m.referencias, []);
  assert.equal(m.texto, TEXTO);
  assert.equal(m.de, CAIXA.email);
  assert.deepEqual(reg.enviada, [m.messageId]);
  assert.deepEqual(reg.falhou, []);
});

test('a saudação segue a hora do envio, e abertura editada fica como a pessoa deixou', async () => {
  assert.match(ajustarSaudacaoDoPedido(TEXTO, TARDE), /^Boa tarde caro analista, a NT/);
  assert.match(ajustarSaudacaoDoPedido(TEXTO.replace('Bom dia', 'Boa tarde'), MANHA), /^Bom dia caro analista, a NT/);
  const editado = 'Prezada equipe, a NT 391000010 passou pela vistoria e pode seguir para a troca.';
  assert.equal(ajustarSaudacaoDoPedido(editado, TARDE), editado);

  const { deps, reg } = montar();
  await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => TARDE));
  assert.match(reg.enviados[0]!.texto, /^Boa tarde caro analista/);
});

test('travaDoPedido: só o assunto do modelo, com a NT do assunto citada no texto', () => {
  assert.equal(travaDoPedido({ assunto: ASSUNTO, texto: TEXTO }), null);
  assert.match(travaDoPedido({ assunto: 'RE: TROCA DE RELÓGIO - X - NT 391000010', texto: TEXTO }) ?? '', /assunto/);
  assert.match(travaDoPedido({ assunto: 'TROCA DE RELÓGIO - X - NT 12345', texto: TEXTO }) ?? '', /assunto/);
  assert.match(travaDoPedido({ assunto: null, texto: TEXTO }) ?? '', /assunto/);
  assert.match(travaDoPedido({ assunto: 'TROCA DE RELÓGIO - X - NT 999999999', texto: TEXTO }) ?? '', /NT/);
});

for (const [nome, pedido] of [
  ['assunto fora do modelo', { assunto: 'RE: qualquer coisa' }],
  ['texto sem a NT do assunto', { texto: 'Bom dia caro analista, a NT 111111111 passou pela etapa de vistoria.' }],
  ['destinatário fora da ENEL', { para: 'alguem@exemplo.test' }],
  ['sem aprovação de pessoa', { aprovadaPor: null }],
] as [string, Partial<CobrancaParaEnviar>][]) {
  test(`trava do robô: ${nome} não envia nada e devolve à equipe`, async () => {
    const { deps, reg } = montar({ pedido });
    const { r } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
    assert.equal(r, 'recusada');
    assert.equal(reg.enviados.length, 0);
    assert.equal(reg.falhou.length, 1);
    assert.match(reg.falhou[0]!, /nada foi enviado/);
  });
}

test('o banco recusou: nada sai, e a frase dele volta para a equipe', async () => {
  const { deps, reg } = montar({ pedido: { recusa: 'o projeto foi concluído ou arquivado', situacaoAnterior: 'aguardando_envio' } });
  const { r } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
  assert.equal(r, 'recusada');
  assert.equal(reg.enviados.length, 0);
  assert.deepEqual(reg.falhou, ['o projeto foi concluído ou arquivado']);
});

test('o servidor recusou: nada saiu, sem reenvio e sem conferir', async () => {
  const { deps, reg } = montar({ enviar: async () => { throw recusa(); } });
  const { r } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
  assert.equal(r, 'falhou');
  assert.equal(reg.conferidas, 0);
  assert.equal(reg.falhou.length, 1);
  assert.doesNotMatch(reg.falhou[0]!, /abcd/);
});

test('queda no meio e achou em Enviados: conta como enviado, sem reenviar', async () => {
  let tentativas = 0;
  const { deps, reg } = montar({ enviar: async () => { tentativas++; throw queda(); } });
  const { r } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
  assert.equal(r, 'enviada');
  assert.equal(tentativas, 1);
  assert.equal(reg.enviada.length, 1);
  assert.deepEqual(reg.falhou, []);
});

test('queda no meio e não deu para conferir: sem confirmação, nunca falhou nem reenvio', async () => {
  let tentativas = 0;
  const { deps, reg } = montar({
    enviar: async () => { tentativas++; throw queda(); },
    conferirEnviados: async () => ({ resultado: 'nao_conferiu', buscas: 4, codigo: 'PRAZO_ESGOTADO' }),
  });
  const { r } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
  assert.equal(r, 'sem_confirmacao');
  assert.equal(tentativas, 1);
  assert.equal(reg.semConfirmacao.length, 1);
  assert.deepEqual(reg.falhou, []);
});

test('queda e conferido que não saiu: UM reenvio do mesmo e-mail, com o mesmo Message-ID', async () => {
  const ids: string[] = [];
  let n = 0;
  const { deps, reg } = montar({
    enviar: async (_c, m) => { ids.push(m.messageId); if (++n === 1) throw queda(); return m.messageId; },
    conferirEnviados: async () => ({ resultado: 'nao_achou', buscas: 4, codigo: null }),
  });
  const { r } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
  assert.equal(r, 'enviada');
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(reg.enviada.length, 1);
});

test('o motivo que volta para a tela fala em pedido, não em cobrança', () => {
  assert.equal(falaDePedido('a cobrança não foi aprovada por uma pessoa da equipe: nada foi enviado'), 'o pedido não foi aprovado por uma pessoa da equipe: nada foi enviado');
  assert.equal(falaDePedido('não consegui ler a cobrança no banco: nada foi enviado'), 'não consegui ler o pedido no banco: nada foi enviado');
  assert.equal(falaDePedido('a cobrança está sem texto: nada foi enviado'), 'o pedido está sem texto: nada foi enviado');
  assert.equal(falaDePedido('o servidor recusou a mensagem'), 'o servidor recusou a mensagem');
});

test('o log não leva texto, titular, caixa nem senha', async () => {
  const { deps } = montar();
  const { logs } = await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => MANHA));
  assert.doesNotMatch(logs, /FULANA|caro analista|ludmilla\.caixa|abcd efgh|391000010/);
});

test('a cobrança não muda: sem montarSaida, o assunto ganha RE: e a saudação é a do modelo dela', async () => {
  const enviados: EmailDeSaida[] = [];
  const deps: DepsEnvio = {
    ...DEPS_ENVIO,
    iniciarEnvio: async () => ({
      ...PEDIDO, assunto: 'TROCA DE RELÓGIO - X - NT 391000010', texto: 'Prezados, bom dia.\n\nTexto.',
      inReplyTo: '<nota@enel.test>', referencias: [], nota: '070700000123',
    }),
    credencialDaCaixa: async () => CAIXA,
    enviar: async (_c, m) => { enviados.push(m); return m.messageId; },
    enviada: async () => undefined,
    falhou: async () => undefined,
    semConfirmacao: async () => undefined,
    esperar: async () => undefined,
    conferirEnviados: async () => ({ resultado: 'achou', buscas: 1, codigo: null }),
  };
  await comLogs(() => executarEnvioDeCobranca(RUN, deps, () => TARDE));
  assert.equal(enviados[0]?.assunto, 'RE: TROCA DE RELÓGIO - X - NT 391000010');
  assert.match(enviados[0]?.texto ?? '', /^Prezados, boa tarde\./);
  assert.equal(enviados[0]?.inReplyTo, '<nota@enel.test>');
});

// worker/ludmilla/test/enel-teste-smtp.test.ts
// O teste do SMTP da VPS: só dois modos, o e-mail de teste nunca sai da própria caixa, e a
// prova diz separadamente se o Message-ID foi mantido e se a busca por destinatário acha.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailDeTeste, modoDoTeste, procurasDaProva, rodarTeste, type DepsDoTeste } from '../src/email/enel/teste-smtp.js';
import { contaComoSaiu, type Conferencia, type ProcuraNosEnviados } from '../src/email/enviados.js';
import { FalhaDoSmtp, type EmailDeSaida } from '../src/email/smtp.js';

const CAIXA = { email: 'ludmilla.caixa@exemplo.test', senha: 'senha de app secreta' };
const AGORA = new Date('2026-10-24T12:00:00Z');
const achou: Conferencia = { resultado: 'achou', buscas: 1, codigo: null };
const naoAchou: Conferencia = { resultado: 'nao_achou', buscas: 4, codigo: null };
const naoConferiu: Conferencia = { resultado: 'nao_conferiu', buscas: 4, codigo: 'PRAZO_ESGOTADO' };

/** Deps de mentira: anota envios e buscas; a conferência responde pela procura recebida. */
function montar(over: Partial<DepsDoTeste> & { pelaId?: Conferencia; pelaBusca?: Conferencia } = {}) {
  const enviados: EmailDeSaida[] = [];
  const procuras: ProcuraNosEnviados[] = [];
  const saidas: Record<string, unknown>[] = [];
  const deps: DepsDoTeste = {
    lerCaixa: async () => CAIXA,
    verificar: async () => ({ porta: 465 }),
    enviar: async (_c, m) => { enviados.push(m); return m.messageId; },
    conferir: async (_c, p) => {
      procuras.push(p);
      return p.para === CAIXA.email ? (over.pelaBusca ?? achou) : (over.pelaId ?? achou);
    },
    agora: () => AGORA,
    escrever: o => { saidas.push(o); },
    ...over,
  };
  return { deps, enviados, procuras, saidas };
}

test('modoDoTeste: só os dois modos, sozinhos', () => {
  assert.equal(modoDoTeste(['--verificar']), 'verificar');
  assert.equal(modoDoTeste(['--enviar-para-a-propria-caixa']), 'enviar');
  assert.equal(modoDoTeste([]), null);
  assert.equal(modoDoTeste(['--verificar', '--enviar-para-a-propria-caixa']), null);
  assert.equal(modoDoTeste(['--enviar-para-a-propria-caixa', 'alguem@exemplo.test']), null, 'não aceita destinatário');
  assert.equal(modoDoTeste(['--para', 'alguem@exemplo.test']), null);
});

test('emailDeTeste: de = para = a caixa, sem conversa, com Message-ID nosso', () => {
  const m = emailDeTeste(CAIXA.email, AGORA);
  assert.equal(m.de, CAIXA.email);
  assert.equal(m.para, CAIXA.email);
  assert.equal(m.inReplyTo, null);
  assert.deepEqual(m.referencias, []);
  assert.match(m.assunto, /Teste de envio da Ludmilla/);
  assert.match(m.texto, /Nenhuma concessionária recebeu/);
  assert.match(m.messageId, /^<[^@>]+@exemplo\.test>$/);
});

test('procurasDaProva: cada procura só casa pelo seu caminho', () => {
  const m = emailDeTeste(CAIXA.email, AGORA);
  const { porMessageId, porEnvelope } = procurasDaProva(m, AGORA);
  const comIdMantido = { messageId: m.messageId, to: [{ address: m.para }], subject: m.assunto, date: AGORA };
  const comIdTrocado = { ...comIdMantido, messageId: '<trocado-pelo-gmail@mail.gmail.com>' };

  assert.equal(contaComoSaiu(comIdMantido, porMessageId), true, 'Message-ID mantido é achado');
  assert.equal(contaComoSaiu(comIdTrocado, porMessageId), false, 'sem o Message-ID, esta procura não pode casar');
  assert.equal(contaComoSaiu(comIdTrocado, porEnvelope), true, 'destinatário, assunto e hora bastam');

  const outroAssunto = { ...comIdTrocado, subject: 'Outro e-mail qualquer' };
  assert.equal(contaComoSaiu(outroAssunto, porEnvelope), false, 'esta procura não casa com outro e-mail');
});

test('verificar: autentica, não envia e não confere nada', async () => {
  const { deps, enviados, procuras, saidas } = montar();
  assert.equal(await rodarTeste('verificar', deps), 0);
  assert.equal(enviados.length, 0);
  assert.equal(procuras.length, 0);
  assert.equal(saidas[0]?.porta, 465);
  assert.match(String(saidas[0]?.msg), /nada foi enviado/);
});

test('enviar: UM e-mail só para a própria caixa, e as duas provas', async () => {
  const { deps, enviados, procuras, saidas } = montar();
  assert.equal(await rodarTeste('enviar', deps), 0);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0]?.para, CAIXA.email);
  assert.equal(procuras.length, 2);
  assert.equal(saidas[0]?.pelo_message_id, 'achou');
  assert.equal(saidas[0]?.pelo_destinatario, 'achou');
});

test('Gmail trocou o Message-ID: passa, e diz que só a busca por destinatário vale', async () => {
  const { deps, saidas } = montar({ pelaId: naoAchou });
  assert.equal(await rodarTeste('enviar', deps), 0);
  assert.equal(saidas[0]?.pelo_message_id, 'nao_achou');
  assert.equal(saidas[0]?.pelo_destinatario, 'achou');
});

test('nenhuma das duas buscas achou: reprova, porque a conferência não protegeria', async () => {
  const { deps, enviados, saidas } = montar({ pelaId: naoAchou, pelaBusca: naoAchou });
  assert.equal(await rodarTeste('enviar', deps), 1);
  assert.equal(enviados.length, 1, 'não tenta enviar de novo');
  assert.equal(saidas[0]?.pelo_destinatario, 'nao_achou');
});

test('não deu para conferir: reprova e leva só o código do erro', async () => {
  const { deps, saidas } = montar({ pelaId: naoConferiu, pelaBusca: naoConferiu });
  assert.equal(await rodarTeste('enviar', deps), 1);
  assert.equal(saidas[0]?.codigo, 'PRAZO_ESGOTADO');
});

test('senha recusada: reprova sem conferir nada e sem citar senha nem endereço', async () => {
  const falha = new FalhaDoSmtp(Object.assign(new Error(`535 ${CAIXA.email} ${CAIXA.senha}`), { code: 'EAUTH', responseCode: 535 }), 'conexao');
  const { deps, procuras, saidas } = montar({ enviar: async () => { throw falha; } });
  assert.equal(await rodarTeste('enviar', deps), 1);
  assert.equal(procuras.length, 0);
  assert.match(String(saidas[0]?.razao), /senha de app/);
  assert.doesNotMatch(JSON.stringify(saidas), /ludmilla\.caixa|secreta/);
});

test('sem acesso à caixa: reprova com a razão fixa, sem repetir o erro de fora', async () => {
  const { deps, enviados, saidas } = montar({ lerCaixa: async () => { throw new Error(`falha lendo ${CAIXA.email}`); } });
  assert.equal(await rodarTeste('enviar', deps), 1);
  assert.equal(enviados.length, 0);
  assert.doesNotMatch(JSON.stringify(saidas), /ludmilla\.caixa/);
});

test('a saída nunca leva o endereço nem a senha da caixa', async () => {
  for (const modo of ['verificar', 'enviar'] as const) {
    const { deps, saidas } = montar();
    await rodarTeste(modo, deps);
    assert.doesNotMatch(JSON.stringify(saidas), /ludmilla\.caixa|secreta/);
  }
});

// worker/ludmilla/test/email-caixa.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { extrairMensagem, uidsDaBusca } from '../src/email/caixa.js';

const EML = [
  'From: "Relacionamento EDP" <relacionamento.edp@edp.com.br>',
  'To: projetos@exemplo.com.br',
  'Subject: ENVIO DE PARECER - NOTA 45006443920',
  'Date: Wed, 10 Sep 2026 09:12:00 -0300',
  'Message-ID: <abc-123@edp.com.br>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="X"',
  '',
  '--X',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Segue o parecer de acesso do titular WERLHE DE ARAUJO LIMA.',
  '',
  '--X',
  'Content-Type: application/pdf; name="parecer.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="parecer.pdf"',
  '',
  'JVBERi0xLjQK',
  '',
  '--X--',
  '',
].join('\r\n');

test('extrairMensagem lê assunto, remetente, texto e anexos', async () => {
  const m = extrairMensagem(await simpleParser(EML), 7);
  assert.equal(m.messageId, '<abc-123@edp.com.br>');
  assert.equal(m.assunto, 'ENVIO DE PARECER - NOTA 45006443920');
  assert.ok(m.remetente.includes('relacionamento.edp@edp.com.br'));
  assert.ok(m.texto.includes('WERLHE DE ARAUJO LIMA'));
  assert.equal(m.anexos.length, 1);
  assert.equal(m.anexos[0].nome, 'parecer.pdf');
  assert.equal(m.anexos[0].mime, 'application/pdf');
  // Decodificou o base64 de verdade: 'JVBERi0xLjQK' é "%PDF-1.4\n".
  assert.ok(m.anexos[0].bytes.toString('latin1').startsWith('%PDF'));
  assert.equal(m.anexos[0].bytes.toString('latin1'), '%PDF-1.4\n');
  // Date: 09:12 em -0300 = 12:12 em UTC.
  assert.equal(m.recebidoEm?.toISOString(), '2026-09-10T12:12:00.000Z');
});

test('mensagem sem Message-ID cai para o uid, para não repetir', async () => {
  const semId = EML.replace('Message-ID: <abc-123@edp.com.br>\r\n', '');
  const m = extrairMensagem(await simpleParser(semId), 42);
  assert.equal(m.messageId, 'imap-uid-42');
});

test('anexo de conteúdo vazio (PDF de 0 byte) NÃO entra em anexos', async () => {
  const comVazio = EML.replace('--X--', [
    '--X',
    'Content-Type: application/pdf; name="vazio.pdf"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="vazio.pdf"',
    '',
    '',
    '--X--',
  ].join('\r\n'));
  const m = extrairMensagem(await simpleParser(comVazio), 7);
  assert.deepEqual(m.anexos.map(a => a.nome), ['parecer.pdf']);
});

test('uidsDaBusca devolve a lista (vazia inclusive) e lança quando a busca falhou', () => {
  assert.deepEqual(uidsDaBusca([3, 9], '45006443920'), [3, 9]);
  assert.deepEqual(uidsDaBusca([], '45006443920'), []);
  // O servidor respondeu NO/BAD: a biblioteca devolve false, sem lançar.
  assert.throws(() => uidsDaBusca(false, '45006443920'), /45006443920/);
  assert.throws(() => uidsDaBusca(undefined, '45006443920'), /45006443920/);
});

// worker/ludmilla/test/email-caixa.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { extrairMensagem } from '../src/email/caixa.js';

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
  assert.ok(m.anexos[0].bytes.length > 0);
});

test('mensagem sem Message-ID cai para o uid, para não repetir', async () => {
  const semId = EML.replace('Message-ID: <abc-123@edp.com.br>\r\n', '');
  const m = extrairMensagem(await simpleParser(semId), 42);
  assert.equal(m.messageId, 'imap-uid-42');
});

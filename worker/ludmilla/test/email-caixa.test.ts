// worker/ludmilla/test/email-caixa.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { simpleParser } from 'mailparser';
import { extrairEnvelope, extrairMensagem, idDaMensagem, mensagemDoFonte, uidsDaBusca } from '../src/email/caixa.js';

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

// ── A triagem pelo ENVELOPE (pular sem baixar, spec §5.4) ───────────────────

test('extrairEnvelope lê assunto, id e data sem precisar do corpo', () => {
  const e = extrairEnvelope(7, {
    messageId: '<abc-123@edp.com.br>',
    subject: 'ENVIO DE PARECER - NOTA 45006443920',
    date: new Date('2026-09-10T12:12:00Z'),
  });
  assert.equal(e.uid, 7);
  assert.equal(e.messageId, '<abc-123@edp.com.br>');
  assert.equal(e.assunto, 'ENVIO DE PARECER - NOTA 45006443920');
  assert.equal(e.recebidoEm?.toISOString(), '2026-09-10T12:12:00.000Z');
});

test('extrairEnvelope aceita a data como string (uns servidores mandam assim)', () => {
  const e = extrairEnvelope(7, { messageId: '<x@y>', subject: 'a', date: 'Wed, 10 Sep 2026 09:12:00 -0300' });
  assert.equal(e.recebidoEm?.toISOString(), '2026-09-10T12:12:00.000Z');
});

test('extrairEnvelope nunca devolve Invalid Date, e aguenta envelope vazio', () => {
  assert.equal(extrairEnvelope(9, { date: 'nada a ver' }).recebidoEm, null);
  const vazio = extrairEnvelope(9, undefined);
  assert.equal(vazio.messageId, 'imap-uid-9');
  assert.equal(vazio.assunto, '');
  assert.equal(vazio.recebidoEm, null);
});

test('o id do envelope e o do corpo são o MESMO: é a chave de "já tratei"', async () => {
  // Calcular o id de dois jeitos faria a mensagem ser tratada duas vezes (ou
  // nunca): a pendência é consultada com o do envelope e registrada no corpo.
  const doEnvelope = extrairEnvelope(7, { messageId: '<abc-123@edp.com.br>', subject: 'x' });
  const doCorpo = extrairMensagem(await simpleParser(EML), 7, '<abc-123@edp.com.br>');
  assert.equal(doCorpo.messageId, doEnvelope.messageId);
  assert.equal(doCorpo.uid, 7);

  // sem Message-ID nos dois lados, os dois caem no mesmo uid
  const semId = EML.replace('Message-ID: <abc-123@edp.com.br>\r\n', '');
  assert.equal(extrairEnvelope(42, {}).messageId, extrairMensagem(await simpleParser(semId), 42).messageId);
});

test('idDaMensagem usa o cabeçalho e só cai no uid quando não há', () => {
  assert.equal(idDaMensagem('  <abc@edp.com.br> ', 7), '<abc@edp.com.br>');
  assert.equal(idDaMensagem('', 7), 'imap-uid-7');
  assert.equal(idDaMensagem(null, 7), 'imap-uid-7');
  assert.equal(idDaMensagem(undefined, 7), 'imap-uid-7');
});

test('uidsDaBusca devolve a lista (vazia inclusive) e lança quando a busca falhou', () => {
  assert.deepEqual(uidsDaBusca([3, 9], '45006443920'), [3, 9]);
  assert.deepEqual(uidsDaBusca([], '45006443920'), []);
  // O servidor respondeu NO/BAD: a biblioteca devolve false, sem lançar.
  assert.throws(() => uidsDaBusca(false, '45006443920'), /45006443920/);
  assert.throws(() => uidsDaBusca(undefined, '45006443920'), /45006443920/);
});

// ── Corpo que o parser não interpreta: visível, nunca silencioso (D3) ───────

/** Roda com o console capturado, para PROVAR o que vai (e o que não vai) no log. */
async function comLogs<T>(f: () => Promise<T>): Promise<{ r: T; logs: string }> {
  const original = console.log;
  const linhas: string[] = [];
  console.log = (linha?: unknown) => { linhas.push(String(linha)); };
  try {
    const r = await f();
    return { r, logs: linhas.join('\n') };
  } finally {
    console.log = original;
  }
}

test('mensagemDoFonte devolve a mensagem quando o corpo dá para interpretar', async () => {
  const { r, logs } = await comLogs(() => mensagemDoFonte(Buffer.from(EML, 'utf8'), 7, '<abc-123@edp.com.br>'));
  assert.equal(r?.messageId, '<abc-123@edp.com.br>');
  assert.equal(r?.anexos.length, 1);
  assert.equal(logs, '', 'o caminho normal não loga nada');
});

test('corpo que o parser recusa devolve null, LOGA e não leva dado de cliente', async () => {
  // Era `catch { continue; }`: a mensagem sumia sem linha no banco, sem log e
  // sem contador — e o corpo de 1–2 MB descia de novo duas vezes por dia.
  //
  // E7: a versão anterior alimentava isto com `undefined` — uma entrada que NÃO
  // carrega nome de pessoa nem de arquivo, então "o log não leva dado de cliente"
  // passava por construção, sem provar nada. Aqui a entrada é um e-mail de
  // verdade (com o titular e o arquivo), e o parser falha DEPOIS de ler esse
  // conteúdo, com uma mensagem que o cita — que é como o mailparser falha ("erro
  // perto de <trecho>"). Se o código passar a logar `e.message`, este teste cai.
  const titular = 'WERLHE DE ARAUJO LIMA';
  const arquivo = 'PARECER_WERLHE_DE_ARAUJO_LIMA.pdf';
  const quebrado = (): Buffer => new Readable({
    read() {
      this.push(Buffer.from(EML.replace('parecer.pdf', arquivo), 'utf8'));
      this.destroy(new Error(`cabeçalho inválido perto de "To: ${titular}" (filename="${arquivo}")`));
    },
  }) as unknown as Buffer;

  // Controle: o erro do parser, de fato, carrega o nome e o arquivo. Sem isto a
  // asserção sobre o log poderia estar passando por construção outra vez.
  await assert.rejects(() => simpleParser(quebrado()), (e: Error) => /WERLHE/.test(e.message) && /\.pdf/.test(e.message));

  const { r, logs } = await comLogs(() => mensagemDoFonte(quebrado(), 42));
  assert.equal(r, null);
  assert.match(logs, /não consegui interpretar o corpo/);
  assert.match(logs, /"uid":42/, 'o uid fica: é o que permite achar a mensagem na caixa');
  assert.match(logs, /"nivel":"falha"/);
  assert.doesNotMatch(logs, /WERLHE|ARAUJO|LIMA/i, 'nome do titular não vai para o journald');
  assert.doesNotMatch(logs, /\.pdf|PARECER_/i, 'nome de arquivo também não');
  assert.doesNotMatch(logs, /cabeçalho inválido/, 'nem a mensagem crua do parser');
});

// ── E6: anexo SEM nome de arquivo também deixa rastro ───────────────────────

/** Acrescenta ao EML partes extras (cada uma já com seu `--X`). */
const comPartes = (...partes: string[][]): string =>
  EML.replace('--X--', [...partes.flatMap(p => ['--X', ...p, '']), '--X--'].join('\r\n'));

const SEM_NOME = ['Content-Type: application/octet-stream', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment', '', 'JVBERi0xLjQK'];
const IMAGEM_SEM_NOME = ['Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Disposition: inline', 'Content-ID: <logo@x>', '', 'iVBORw0KGgo='];

test('anexo sem nome de arquivo não entra em anexos, mas É CONTADO', async () => {
  // O filtro de `filename` vazio descartava sem log e sem contador: numa regra
  // sem leitura de PDF nem a ressalva "não trouxe PDF" aparecia, e o documento
  // simplesmente não existia para ninguém.
  const m = extrairMensagem(await simpleParser(comPartes(SEM_NOME, SEM_NOME)), 7);
  assert.deepEqual(m.anexos.map(a => a.nome), ['parecer.pdf']);
  assert.equal(m.anexosSemNome, 2);
});

test('imagem sem nome (logo inline da assinatura) não conta como documento perdido', async () => {
  // Imagem não é documento de qualquer jeito; contar o logo de assinatura
  // encheria o motivo de alarme falso em todo e-mail com assinatura HTML.
  const m = extrairMensagem(await simpleParser(comPartes(IMAGEM_SEM_NOME)), 7);
  assert.equal(m.anexosSemNome, 0);
});

test('mensagem sem anexo sem nome tem contador zero', async () => {
  assert.equal(extrairMensagem(await simpleParser(EML), 7).anexosSemNome, 0);
});

test('mensagemDoFonte LOGA o anexo sem nome, com o uid e sem dado de cliente', async () => {
  const { r, logs } = await comLogs(() => mensagemDoFonte(Buffer.from(comPartes(SEM_NOME), 'utf8'), 7));
  assert.equal(r?.anexosSemNome, 1);
  assert.match(logs, /sem nome de arquivo/);
  assert.match(logs, /"uid":7/);
  assert.match(logs, /"quantidade":1/);
  assert.doesNotMatch(logs, /WERLHE/i, 'o corpo do e-mail cita o titular; o log não');
  assert.doesNotMatch(logs, /parecer\.pdf/i, 'nem o nome do outro anexo');
});

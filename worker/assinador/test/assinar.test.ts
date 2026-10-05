import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { cpfMascarado, lerCertificado } from '../src/certificado.js';
import { assinar, conferirAssinado, estampar } from '../src/assinar.js';

interface OpcoesPfx {
  /** coloca uma AC autoassinada ANTES do titular na lista de certificados (cadeia real) */
  acAntes?: boolean;
  /** grava sem senha: a chave vai num keyBag não cifrado */
  semSenha?: boolean;
  /** grava só o(s) certificado(s), sem chave privada */
  semChave?: boolean;
}

function certificado(
  cn: string, chavePublica: forge.pki.rsa.PublicKey, chaveDeAssinar: forge.pki.rsa.PrivateKey,
  emissorCn?: string, serial = '0A1B2C',
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = chavePublica;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const comum = [{ name: 'countryName', value: 'BR' }, { name: 'organizationName', value: 'ICP-Brasil' }];
  cert.setSubject([{ name: 'commonName', value: cn }, ...comum]);
  cert.setIssuer([{ name: 'commonName', value: emissorCn ?? cn }, ...comum]);
  cert.sign(chaveDeAssinar, forge.md.sha256.create());
  return cert;
}

/** Um .pfx de teste, criado aqui: nenhum certificado real entra no repositório. */
function pfxDeTeste(cn = 'JOAO DA SILVA:12345678901', senha = 'senha-de-teste', op: OpcoesPfx = {}): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  let cadeia: forge.pki.Certificate[];
  if (op.acAntes) {
    const chavesAc = forge.pki.rsa.generateKeyPair(1024);
    const ac = certificado('AC TESTE RAIZ', chavesAc.publicKey, chavesAc.privateKey, undefined, '99');
    const titular = certificado(cn, chaves.publicKey, chavesAc.privateKey, 'AC TESTE RAIZ');
    cadeia = [ac, titular]; // a AC vem PRIMEIRO: sem ordem garantida num .pfx real
  } else {
    cadeia = [certificado(cn, chaves.publicKey, chaves.privateKey)];
  }
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    op.semChave ? (null as unknown as forge.pki.rsa.PrivateKey) : chaves.privateKey,
    cadeia,
    op.semSenha ? (null as unknown as string) : senha,
    { algorithm: '3des', useMac: !op.semSenha },
  );
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

async function pdfDeTeste(paginas = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i++) {
    doc.addPage([595, 842]).drawText(`Pagina ${i} - memorial descritivo`, { x: 50, y: 780, size: 13, font: fonte });
  }
  return Buffer.from(await doc.save()); // xref STREAM — o caso que quebra o placeholder
}

const ESTAMPA = {
  titularNome: 'JOAO DA SILVA', cpf: '12345678901', codigo: 'AX7F2', cidade: 'UBERABA-MG',
  quando: new Date('2026-10-03T14:32:00-03:00'),
};

// ---------------------------------------------------------------- certificado

test('lerCertificado tira titular, CPF, serial e validade do .pfx', () => {
  const c = lerCertificado(pfxDeTeste(), 'senha-de-teste');
  assert.equal(c.titularNome, 'JOAO DA SILVA');
  assert.equal(c.cpf, '12345678901');
  assert.equal(c.serial.toLowerCase(), '0a1b2c');
  assert.equal(c.fim.toISOString().slice(0, 10), '2027-01-01');
});

test('lerCertificado recusa senha errada', () => {
  assert.throws(() => lerCertificado(pfxDeTeste(), 'errada'), /senha/i);
});

test('lerCertificado devolve o TITULAR (o da chave privada), não a AC que vem antes na cadeia', () => {
  const c = lerCertificado(pfxDeTeste('MARIA SOUZA:98765432100', 'senha-de-teste', { acAntes: true }), 'senha-de-teste');
  assert.equal(c.titularNome, 'MARIA SOUZA');
  assert.equal(c.cpf, '98765432100');
  assert.equal(c.serial.toLowerCase(), '0a1b2c');
  assert.match(c.emissor, /AC TESTE RAIZ/);
});

test('lerCertificado aceita .pfx com a chave num keyBag não cifrado', () => {
  const c = lerCertificado(pfxDeTeste('JOAO DA SILVA:12345678901', '', { semSenha: true }), '');
  assert.equal(c.titularNome, 'JOAO DA SILVA');
});

test('lerCertificado recusa .pfx sem chave privada, com mensagem clara', () => {
  assert.throws(
    () => lerCertificado(pfxDeTeste('JOAO DA SILVA:12345678901', '', { semSenha: true, semChave: true }), ''),
    /chave privada/i,
  );
});

test('lerCertificado recusa CN sem CPF (sem ":") em vez de inventar um', () => {
  assert.throws(() => lerCertificado(pfxDeTeste('JOAO DA SILVA'), 'senha-de-teste'), /CPF/);
});

test('lerCertificado recusa documento que não tem 11 dígitos (e-CNPJ)', () => {
  assert.throws(() => lerCertificado(pfxDeTeste('EMPRESA LTDA:12345678000199'), 'senha-de-teste'), /CPF/);
});

test('lerCertificado limpa a máscara do CPF no CN', () => {
  const c = lerCertificado(pfxDeTeste('JOAO DA SILVA:123.456.789-01'), 'senha-de-teste');
  assert.equal(c.cpf, '12345678901');
});

test('cpfMascarado mostra só os 5 últimos dígitos, no formato exato', () => {
  assert.equal(cpfMascarado('12345678901'), '***.***.789-01');
  assert.equal(cpfMascarado('123.456.789-01'), '***.***.789-01');
});

test('cpfMascarado lança erro, e não inventa número, se não houver 11 dígitos', () => {
  assert.throws(() => cpfMascarado(''), /CPF/);
  assert.throws(() => cpfMascarado('1234567890'), /CPF/);
  assert.throws(() => cpfMascarado('12345678000199'), /CPF/);
});

// --------------------------------------------------------------------- estampa

test('estampar mantém as páginas e grava com xref clássica', async () => {
  const original = await pdfDeTeste(3);
  const preparado = await estampar(original, ESTAMPA);
  assert.equal((await PDFDocument.load(preparado)).getPageCount(), 3);
  assert.ok(preparado.length > original.length, 'a estampa deveria acrescentar bytes');

  // xref CLÁSSICA, e não stream. Atenção: procurar a string "xref" NÃO prova
  // nada — todo PDF tem "startxref" no fim. O que discrimina é a palavra
  // "xref" sozinha numa linha (a tabela) e a ausência de /Type /XRef.
  assert.ok(/\r?\nxref\r?\n/.test(preparado.toString('latin1')), 'esperava a tabela xref em linha própria');
  assert.ok(!preparado.includes(Buffer.from('/Type /XRef')), 'não deveria ter xref stream');
  // o original (xref stream) é o contraste que torna o teste honesto
  assert.ok(!/\r?\nxref\r?\n/.test(original.toString('latin1')), 'o original deveria ser xref stream');
});

test('estampar não quebra com nome muito longo nem com caractere fora do WinAnsi', async () => {
  const original = await pdfDeTeste(1);
  const preparado = await estampar(original, {
    ...ESTAMPA,
    titularNome: 'MARIA APARECIDA DOS SANTOS DE OLIVEIRA E SOUZA PEREIRA ŁUKASZ ČERNÝ 田中',
    cidade: 'SÃO JOSÉ DOS CAMPOS-SP',
  });
  assert.equal((await PDFDocument.load(preparado)).getPageCount(), 1);
  assert.ok(/\r?\nxref\r?\n/.test(preparado.toString('latin1')));
});

// ------------------------------------------------------------------- assinatura

test('assinar ANEXA: os bytes aprovados são prefixo exato do assinado', async () => {
  const pfx = pfxDeTeste();
  const aprovado = await estampar(await pdfDeTeste(2), { ...ESTAMPA, codigo: 'BB123' });
  const assinado = await assinar(aprovado, pfx, 'senha-de-teste', { nome: 'JOAO DA SILVA', cidade: 'UBERABA-MG' });

  const v = conferirAssinado(aprovado, assinado);
  assert.equal(v.prefixoOk, true, 'o PDF aprovado deve ser prefixo do assinado');
  assert.equal(v.temByteRange, true, 'o assinado deve ter /ByteRange preenchido');
  assert.equal(v.contentsPreenchido, true, 'o /Contents deve trazer a assinatura, não só zeros');
  assert.equal((await PDFDocument.load(assinado)).getPageCount(), 2);
});

test('assinar recusa senha errada do certificado', async () => {
  const aprovado = await estampar(await pdfDeTeste(1), { ...ESTAMPA, titularNome: 'X', cidade: 'SP' });
  await assert.rejects(() => assinar(aprovado, pfxDeTeste(), 'errada', { nome: 'X', cidade: 'SP' }));
});

// --------------------------------------------------- conferirAssinado (negativos)

test('conferirAssinado: um byte alterado no aprovado derruba prefixoOk', async () => {
  const aprovado = await estampar(await pdfDeTeste(1), ESTAMPA);
  const assinado = await assinar(aprovado, pfxDeTeste(), 'senha-de-teste', { nome: 'JOAO', cidade: 'SP' });
  const adulterado = Buffer.from(assinado);
  adulterado[20] ^= 0xff; // dentro dos bytes que a pessoa aprovou
  assert.equal(conferirAssinado(aprovado, adulterado).prefixoOk, false);
});

test('conferirAssinado: assinado do mesmo tamanho ou menor que o aprovado não é prefixoOk', async () => {
  const aprovado = await estampar(await pdfDeTeste(1), ESTAMPA);
  assert.equal(conferirAssinado(aprovado, Buffer.from(aprovado)).prefixoOk, false, 'igual');
  assert.equal(conferirAssinado(aprovado, aprovado.subarray(0, aprovado.length - 5)).prefixoOk, false, 'menor');
});

test('conferirAssinado: sem /ByteRange não há assinatura', async () => {
  const aprovado = await estampar(await pdfDeTeste(1), ESTAMPA);
  const v = conferirAssinado(aprovado, Buffer.concat([aprovado, Buffer.from('\n%%lixo qualquer\n')]));
  assert.equal(v.prefixoOk, true);
  assert.equal(v.temByteRange, false);
  assert.equal(v.contentsPreenchido, false);
});

test('conferirAssinado: PDF só com o PLACEHOLDER (nunca assinado) não conta como assinado', async () => {
  const aprovado = await estampar(await pdfDeTeste(1), ESTAMPA);
  const soPlaceholder = plainAddPlaceholder({
    pdfBuffer: aprovado, reason: 'x', contactInfo: 'x', name: 'x', location: 'x',
  });
  const v = conferirAssinado(aprovado, soPlaceholder);
  assert.ok(soPlaceholder.includes(Buffer.from('ByteRange')), 'premissa: o placeholder já traz /ByteRange');
  assert.equal(v.temByteRange, false, '/ByteRange ainda com asteriscos');
  assert.equal(v.contentsPreenchido, false, '/Contents ainda só zeros');
});

test('assinar LANÇA se o prefixo aprovado não sobreviver (aprovado terminando em CRLF)', async () => {
  // o placeholder corta \n/\r finais e re-adiciona só \n: o prefixo quebraria em silêncio
  const base = await estampar(await pdfDeTeste(1), ESTAMPA);
  const aprovado = Buffer.concat([base, Buffer.from('\r\n')]);
  await assert.rejects(
    () => assinar(aprovado, pfxDeTeste(), 'senha-de-teste', { nome: 'JOAO', cidade: 'SP' }),
    /aprovad/i,
  );
});

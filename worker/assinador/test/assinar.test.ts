import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { lerCertificado } from '../src/certificado.js';
import { assinar, conferirAssinado, estampar } from '../src/assinar.js';

/** Um .pfx de teste, criado aqui: nenhum certificado real entra no repositório. */
function pfxDeTeste(cn = 'JOAO DA SILVA:12345678901', senha = 'senha-de-teste'): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '0A1B2C';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'countryName', value: 'BR' },
    { name: 'organizationName', value: 'ICP-Brasil' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: '3des' });
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

test('estampar mantém as páginas e grava com xref clássica', async () => {
  const original = await pdfDeTeste(3);
  const preparado = await estampar(original, {
    titularNome: 'JOAO DA SILVA', cpf: '12345678901',
    codigo: 'AX7F2', cidade: 'UBERABA-MG', quando: new Date('2026-10-03T14:32:00-03:00'),
  });
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

test('assinar ANEXA: os bytes aprovados são prefixo exato do assinado', async () => {
  const pfx = pfxDeTeste();
  const aprovado = await estampar(await pdfDeTeste(2), {
    titularNome: 'JOAO DA SILVA', cpf: '12345678901',
    codigo: 'BB123', cidade: 'UBERABA-MG', quando: new Date(),
  });
  const assinado = await assinar(aprovado, pfx, 'senha-de-teste', { nome: 'JOAO DA SILVA', cidade: 'UBERABA-MG' });

  const v = conferirAssinado(aprovado, assinado);
  assert.equal(v.prefixoOk, true, 'o PDF aprovado deve ser prefixo do assinado');
  assert.equal(v.temByteRange, true, 'o assinado deve ter /ByteRange');
  assert.equal((await PDFDocument.load(assinado)).getPageCount(), 2);
});

test('assinar recusa senha errada do certificado', async () => {
  const aprovado = await estampar(await pdfDeTeste(1), {
    titularNome: 'X', cpf: '12345678901', codigo: 'CC123', cidade: 'SP', quando: new Date(),
  });
  await assert.rejects(() => assinar(aprovado, pfxDeTeste(), 'errada', { nome: 'X', cidade: 'SP' }));
});

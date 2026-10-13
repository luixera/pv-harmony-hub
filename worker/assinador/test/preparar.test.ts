import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { caminhoDoSoffice, converterParaPdf, precisaConverter, temSoffice } from '../src/preparar.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// A conversão real precisa do LibreOffice. Fora do CI, sem soffice, o teste é
// pulado com aviso. No CI (variável CI definida) a ausência do soffice FALHA o
// teste: pipeline verde sem nunca ter exercitado a conversão seria enganoso.
const pularSemSoffice = !temSoffice() && !process.env.CI ? 'soffice ausente nesta máquina' : false;

function exigirSofficeNoCi(): void {
  if (process.env.CI && caminhoDoSoffice() === null) {
    assert.fail('CI sem LibreOffice: instale libreoffice-calc e libreoffice-writer no pipeline, senão a conversão nunca é testada.');
  }
}

// Arquivos de verdade, já versionados no repositório. De dist-test/test/ são
// quatro níveis acima até a raiz.
function lerDocx(): Buffer {
  return readFileSync(new URL('../../../../docs/modelos-memoriais/MEMORIAL_DESCRITIVO_ENEL.docx', import.meta.url));
}
function lerXlsx(): Buffer {
  return readFileSync(new URL('../../../../docs/modelos-cemig/FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx', import.meta.url));
}

test('precisaConverter reconhece o que não é PDF', () => {
  assert.equal(precisaConverter('memorial.pdf', 'application/pdf'), false);
  assert.equal(precisaConverter('MEMORIAL.PDF', null), false);
  assert.equal(precisaConverter('formulario-cemig.xlsx', XLSX_MIME), true);
  assert.equal(precisaConverter('memorial.docx', null), true);
});

test('precisaConverter: a extensão manda sobre o MIME, o MIME só desempata sem extensão', () => {
  // MIME mentindo: .xlsx declarado como PDF tem que ser convertido.
  assert.equal(precisaConverter('formulario.xlsx', 'application/pdf'), true);
  // Sem extensão, o MIME decide.
  assert.equal(precisaConverter('documento', 'application/pdf'), false);
  assert.equal(precisaConverter('documento', null), true);
  // Extensão dupla: vale a última.
  assert.equal(precisaConverter('memorial.pdf.xlsx', null), true);
  assert.equal(precisaConverter('memorial.xlsx.pdf', null), false);
});

test('converterParaPdf recusa extensão que não sabe converter', async () => {
  await assert.rejects(
    () => converterParaPdf(Buffer.from('x'), 'foto.png'),
    (err: Error) => /não sei converter/i.test(err.message) && /Suba o documento já em PDF/.test(err.message),
  );
});

test('converterParaPdf não aceita .csv (separador e charset errados gerariam lixo)', async () => {
  await assert.rejects(() => converterParaPdf(Buffer.from('a;b'), 'dados.csv'), /não sei converter/i);
});

test('converterParaPdf entrega um PDF legível a partir de .docx', { skip: pularSemSoffice }, async () => {
  exigirSofficeNoCi();
  const pdf = await converterParaPdf(lerDocx(), 'MEMORIAL_DESCRITIVO_ENEL.docx');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
});

test('converterParaPdf dá conta de planilha (o caminho da CEMIG)', { skip: pularSemSoffice }, async () => {
  exigirSofficeNoCi();
  const pdf = await converterParaPdf(lerXlsx(), 'FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
});

// É o que justifica o -env:UserInstallation: sem perfil isolado, uma das duas
// conversões simultâneas sairia vazia.
test('converterParaPdf: duas conversões simultâneas devolvem PDF válido', { skip: pularSemSoffice }, async () => {
  exigirSofficeNoCi();
  const docx = lerDocx();
  const [a, b] = await Promise.all([
    converterParaPdf(docx, 'MEMORIAL_A.docx'),
    converterParaPdf(docx, 'MEMORIAL_B.docx'),
  ]);
  for (const pdf of [a, b]) {
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
  }
});

// NÃO existe teste de ".docx corrompido é recusado" — de propósito. O CI provou
// (13/10/2026, 3 tentativas: texto puro, docx truncado, 'PK' + 512 bytes de lixo)
// que o LibreOffice converte até lixo, sai com código 0 e produz um PDF plausível
// que passa no validarPdf. A rede contra isso não é a detecção: é a conferência
// humana do passo "Confira antes de assinar". Fixar esse comportamento num teste
// seria travar algo do LibreOffice que não controlamos.

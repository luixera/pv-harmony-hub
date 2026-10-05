import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { converterParaPdf, precisaConverter, temSoffice } from '../src/preparar.js';

test('precisaConverter reconhece o que não é PDF', () => {
  assert.equal(precisaConverter('memorial.pdf', 'application/pdf'), false);
  assert.equal(precisaConverter('MEMORIAL.PDF', null), false);
  assert.equal(precisaConverter('formulario-cemig.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true);
  assert.equal(precisaConverter('memorial.docx', null), true);
});

test('converterParaPdf recusa extensão que não sabe converter', async () => {
  await assert.rejects(() => converterParaPdf(Buffer.from('x'), 'foto.png'), /não sei converter/i);
});

// A conversão real precisa do LibreOffice. Na máquina sem soffice o teste
// avisa e passa — o CI instala libreoffice e cobre o caminho de verdade.
test('converterParaPdf entrega um PDF legível a partir de .docx', { skip: !temSoffice() && 'soffice ausente nesta máquina' }, async () => {
  // Memorial de verdade, já versionado no repositório (confirmado 03/10/2026
  // com `git ls-files '*.docx'`). De dist-test/test/ são quatro níveis acima até a raiz.
  const { readFileSync } = await import('node:fs');
  const docx = readFileSync(new URL('../../../../docs/modelos-memoriais/MEMORIAL_DESCRITIVO_ENEL.docx', import.meta.url));
  const pdf = await converterParaPdf(docx, 'MEMORIAL_DESCRITIVO_ENEL.docx');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
});

test('converterParaPdf dá conta de planilha (o caminho da CEMIG)', { skip: !temSoffice() && 'soffice ausente nesta máquina' }, async () => {
  const { readFileSync } = await import('node:fs');
  const xlsx = readFileSync(new URL('../../../../docs/modelos-cemig/FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx', import.meta.url));
  const pdf = await converterParaPdf(xlsx, 'FORMULARIO_MICROGD_CEMIG_Rev_N4.xlsx');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

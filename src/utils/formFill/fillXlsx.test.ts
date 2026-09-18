import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { preencherXlsx, type MapaPlanilha } from './fillXlsx';

/**
 * Preenchedor de .xlsx por célula. O caso que motivou estes testes (CEMIG,
 * 17/09/2026): as caixas de seleção 8.5.1/8.5.3 do formulário são FÓRMULAS
 * (`=SE(AL12="Sim";"X";"")`). Trocar a célula por texto mataria a fórmula da
 * CEMIG; deixar só a fórmula mostrava a caixa vazia, porque o Excel abre com
 * o valor em cache. A resposta: manter a fórmula, gravar o valor em cache e
 * pedir recálculo completo ao abrir.
 */

const WORKBOOK = '<?xml version="1.0"?><workbook><sheets><sheet name="F" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>';
const SHEET = '<?xml version="1.0"?><worksheet><sheetData>'
  + '<row r="12"><c r="AL12" s="3"/><c r="AN12" s="4" t="str"><f>IF(AL12="Sim","Ver 8.5.3","")</f><v></v></c></row>'
  + '<row r="95"><c r="AT95" s="7"><f>MIN(L116,AI116)</f><v>0</v></c></row>'
  + '<row r="211"><c r="B211" s="10"/><c r="C211" s="85" t="str"><f>IF(AL12=Dados!V5,"X","")</f><v/></c><c r="E211" t="s"><v>391</v></c></row>'
  + '</sheetData></worksheet>';

function modelo(): Uint8Array {
  const zip = new PizZip();
  zip.file('xl/workbook.xml', WORKBOOK);
  zip.file('xl/worksheets/sheet1.xml', SHEET);
  return zip.generate({ type: 'uint8array' });
}

function abrir(bytes: Uint8Array) {
  const zip = new PizZip(bytes);
  return { sheet: zip.file('xl/worksheets/sheet1.xml')!.asText(), workbook: zip.file('xl/workbook.xml')!.asText() };
}

const mapa: MapaPlanilha = {
  nome: 'teste',
  celulas: [
    { celula: 'AL12', chave: 'fast_track' },
    { celula: 'C211', chave: 'x_fast_track' },
    { celula: 'AT95', chave: 'potencia' },
    { celula: 'D211', chave: 'nova' },
  ],
};

describe('preencherXlsx', () => {
  it('célula comum vira texto inline, preservando o estilo', () => {
    const { sheet } = abrir(preencherXlsx(modelo(), mapa, { fast_track: 'Sim' }));
    expect(sheet).toContain('<c r="AL12" s="3" t="inlineStr"><is><t xml:space="preserve">Sim</t></is></c>');
  });

  it('célula com FÓRMULA mantém a fórmula e recebe o valor em cache (texto → t="str")', () => {
    const { sheet } = abrir(preencherXlsx(modelo(), mapa, { x_fast_track: 'X' }));
    expect(sheet).toContain('<c r="C211" s="85" t="str"><f>IF(AL12=Dados!V5,"X","")</f><v>X</v></c>');
  });

  it('célula com fórmula numérica recebe número em cache, sem t=', () => {
    const { sheet } = abrir(preencherXlsx(modelo(), mapa, { potencia: '5.2' }));
    expect(sheet).toContain('<c r="AT95" s="7"><f>MIN(L116,AI116)</f><v>5.2</v></c>');
  });

  it('valor vazio não toca a célula (a fórmula fica como no modelo)', () => {
    const { sheet } = abrir(preencherXlsx(modelo(), mapa, { x_fast_track: '' }));
    expect(sheet).toContain('<c r="C211" s="85" t="str"><f>IF(AL12=Dados!V5,"X","")</f><v/></c>');
  });

  it('célula que não existe é inserida na linha, em ordem de coluna', () => {
    const { sheet } = abrir(preencherXlsx(modelo(), mapa, { nova: 'oi' }));
    const iC = sheet.indexOf('<c r="C211"'); const iD = sheet.indexOf('<c r="D211"'); const iE = sheet.indexOf('<c r="E211"');
    expect(iC).toBeGreaterThan(-1); expect(iD).toBeGreaterThan(iC); expect(iE).toBeGreaterThan(iD);
  });

  it('pede recálculo completo ao abrir (fullCalcOnLoad) — as fórmulas da CEMIG dependem do que escrevemos', () => {
    const { workbook } = abrir(preencherXlsx(modelo(), mapa, { fast_track: 'Sim' }));
    expect(workbook).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
    expect(workbook).toContain('calcId="191029"');
  });

  it('workbook sem calcPr ganha um', () => {
    const zip = new PizZip();
    zip.file('xl/workbook.xml', '<workbook><sheets/></workbook>');
    zip.file('xl/worksheets/sheet1.xml', SHEET);
    const { workbook } = abrir(preencherXlsx(zip.generate({ type: 'uint8array' }), mapa, { fast_track: 'Sim' }));
    expect(workbook).toContain('<calcPr fullCalcOnLoad="1"/></workbook>');
  });
});

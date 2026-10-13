import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlCargaPorTrafo, sqlGdPorTrafo, sqlTrafos } from '../src/bdgd/extrair.js';

test('a carga agrupa por trafo e usa o CASE, sem JOIN', () => {
  const sql = sqlCargaPorTrafo("CASE u.TIP_CC WHEN 'X' THEN 0.5 ELSE NULL END", 'UCBT_tab');
  assert.ok(sql.includes('GROUP BY u.UNI_TR_MT'));
  assert.ok(sql.includes('FROM UCBT_tab u'));
  assert.ok(sql.includes("CASE u.TIP_CC WHEN 'X' THEN 0.5"));
  // O JOIN entre camadas levou 11 min sem saida; nao pode voltar.
  assert.ok(!/\bJOIN\b/i.test(sql), 'o SQL da carga nao pode ter JOIN');
});

test('a carga descarta UC sem trafo', () => {
  const sql = sqlCargaPorTrafo('CASE u.TIP_CC ELSE NULL END', 'UCBT_tab');
  assert.ok(sql.includes("u.UNI_TR_MT <> ''"));
});

test('a GD soma a potencia instalada por trafo', () => {
  const sql = sqlGdPorTrafo('UGBT_tab');
  assert.ok(sql.includes('sum(POT_INST)'));
  assert.ok(sql.includes('GROUP BY UNI_TR_MT'));
  assert.ok(sql.includes('FROM UGBT_tab'));
});

test('o SQL dos trafos traz a geometria no SELECT, nao por -lco', () => {
  // Com -dialect SQLITE o SELECT nao carrega a geometria implicita, entao
  // `-lco GEOMETRY=AS_WKT` nao emite coluna nenhuma e o CSV sai sem ponto —
  // com a contagem de linhas certa, o que esconde o defeito.
  const sql = sqlTrafos();
  assert.ok(/ST_AsText\s*\(\s*SHAPE\s*\)\s+AS\s+Shape/i.test(sql),
    `o SELECT dos trafos precisa de ST_AsText(SHAPE) AS Shape: ${sql}`);
  assert.ok(sql.includes('FROM UNTRMT'));
});

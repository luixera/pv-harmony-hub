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
  assert.ok(/sum\(/.test(sql) && sql.includes('POT_INST'));
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

import { POT_INST_KW, sqlGdPorAlimentador } from '../src/bdgd/extrair.js';

// 13/10/2026: na CPFL Paulista, 815 de 288.154 unidades de GD de baixa tensao
// vinham com POT_INST em WATTS (5000, 10000, 13202...). Somadas como kW,
// davam 12.779 MW fantasmas — 13,7 GW de "microgeracao", uma Itaipu. Na
// Piratininga eram 25 unidades e 88,6 MW (um terco do total).

test('POT_INST acima de 1000 e lido como watt', () => {
  // BT nao passa de 75 kW: acima de 1000 nao pode ser kW
  assert.ok(/POT_INST\s*>\s*1000/.test(POT_INST_KW), POT_INST_KW);
  assert.ok(/POT_INST\s*\/\s*1000/.test(POT_INST_KW), POT_INST_KW);
});

test('a GD por trafo e por alimentador usam a mesma correcao', () => {
  assert.ok(sqlGdPorTrafo('UGBT_tab').includes(POT_INST_KW));
  assert.ok(sqlGdPorAlimentador('UGBT_tab').includes(POT_INST_KW));
});

test('a soma crua de POT_INST nao pode voltar', () => {
  assert.ok(!/sum\(\s*POT_INST\s*\)/i.test(sqlGdPorTrafo('UGBT_tab')));
  assert.ok(!/sum\(\s*POT_INST\s*\)/i.test(sqlGdPorAlimentador('UGBT_tab')));
});

import { sqlTracadoAlimentadores, TOLERANCIA_TRACADO } from '../src/bdgd/extrair.js';

// 13/10/2026, Piratininga: 396.983 trechos da SSDMT -> 550 linhas, 3,3 s, 5,4 MB.
// ST_LineMerge ANTES do simplify e obrigatorio: cada trecho tem 2 pontos, e
// sem o merge o simplify nao tira nada (8.582 -> 8.582; com merge, -> 2.210).
test('o tracado agrega a SSDMT por alimentador com LineMerge antes do Simplify', () => {
  const sql = sqlTracadoAlimentadores();
  assert.ok(/ST_SimplifyPreserveTopology\(\s*ST_LineMerge\(\s*ST_Collect\(\s*SHAPE\s*\)\s*\)/i.test(sql), sql);
  assert.ok(sql.includes('FROM SSDMT'));
  assert.ok(sql.includes('GROUP BY CTMT'));
  assert.ok(/ST_AsText\(/.test(sql), 'a geometria vem no SELECT, como nos trafos');
  assert.ok(!/\bJOIN\b/i.test(sql));
  assert.equal(TOLERANCIA_TRACADO, 0.00005);
});

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
  assert.ok(/sum\(/.test(sql) && sql.includes('DEM_CONT'));
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

import { GD_KW, POT_INST_KW, sqlGdPorAlimentador } from '../src/bdgd/extrair.js';

// 13/10/2026: na CPFL Paulista, 815 de 288.154 unidades de GD de baixa tensao
// vinham com POT_INST em WATTS (5000, 10000, 13202...). Somadas como kW,
// davam 12.779 MW fantasmas — 13,7 GW de "microgeracao", uma Itaipu. Na
// Piratininga eram 25 unidades e 88,6 MW (um terco do total).

test('a potencia da GD vem de DEM_CONT, que e o que a ANEEL registra como instalada', () => {
  // Conferido em 15/10/2026 com o cadastro aberto da ANEEL (empreendimento-
  // geracao-distribuida.parquet): para 8 unidades da Piratininga, a potencia
  // instalada da ANEEL (5,0 · 6,0 · 4,5 · 5,0 · 3,0 · 3,0 · 4,4 · 4,0 kW) e
  // IGUAL ao DEM_CONT da BDGD e nao tem relacao com POT_INST (0,62 · 1,68 ·
  // 0,93 · 2,18 · 0,95 · 1,18 · 1,17 · 5,0). POT_INST e a potencia MEDIA gerada
  // (energia do mes / horas de sol), ~2,5x menor. Piratininga: DEM_CONT soma
  // 369,6 MW, POT_INST 164,4 MW, ANEEL 523 MW (base de out/2026, com MT).
  assert.ok(/DEM_CONT\s*>\s*0\s*THEN\s*DEM_CONT/.test(GD_KW), GD_KW);
  assert.ok(sqlGdPorTrafo('UGBT_tab').includes(GD_KW));
  assert.ok(sqlGdPorAlimentador('UGBT_tab').includes(GD_KW));
});

test('sem DEM_CONT, cai no POT_INST corrigido para kW (watts acima de 1000)', () => {
  assert.ok(GD_KW.includes(POT_INST_KW));
  assert.ok(/POT_INST\s*>\s*1000/.test(POT_INST_KW), POT_INST_KW);
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

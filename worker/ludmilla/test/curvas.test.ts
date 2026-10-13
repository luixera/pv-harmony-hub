import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fatorDeForma, gerarCaseSql } from '../src/bdgd/curvas.js';

/** 96 quartos de hora, todos iguais: mínimo diurno = média, fator 1. */
const PLANA = Array.from({ length: 96 }, () => 4);

test('curva plana tem fator 1', () => {
  assert.equal(fatorDeForma(PLANA, 9, 15), 1);
});

test('a janela e [inicio, fim) em quartos de hora', () => {
  // POT_01 = 00:00-00:15, logo a hora h comeca no indice h*4. Afirmamos a
  // FRONTEIRA, nao um numero: baixar um quarto de hora tambem baixa a media,
  // entao a constante exata nao e o que este teste quer provar.
  const dentro = [...PLANA];
  dentro[36] = 1;         // 09:00 — o primeiro quarto DA janela
  const f = fatorDeForma(dentro, 9, 15);
  assert.ok(f !== null && f < 0.3, `09:00 tem de contar; veio ${f}`);

  const fora = [...PLANA];
  fora[60] = 1;           // 15:00 — o primeiro quarto FORA da janela
  // Nao puxa o fator para baixo. (Fica um fio ACIMA de 1, porque o vale das
  // 15:00 baixa a media sem baixar o minimo da janela — e exatamente o que
  // "fora da janela" significa.)
  assert.ok((fatorDeForma(fora, 9, 15) ?? 0) >= 1, '15:00 nao pode contar');

  const ultimo = [...PLANA];
  ultimo[59] = 1;         // 14:45 — ainda dentro
  assert.ok((fatorDeForma(ultimo, 9, 15) ?? 1) < 0.3, '14:45 tem de contar');
});

test('minimo diurno zero devolve zero, nao nulo', () => {
  // Iluminacao publica: zero ao meio-dia e dado correto, nao defeito.
  const v = [...PLANA];
  v[40] = 0;
  assert.equal(fatorDeForma(v, 9, 15), 0);
});

test('curva sem energia nenhuma devolve null', () => {
  assert.equal(fatorDeForma(Array.from({ length: 96 }, () => 0), 9, 15), null);
});

test('curva com tamanho errado devolve null', () => {
  assert.equal(fatorDeForma([1, 2, 3], 9, 15), null);
});

test('fator pode passar de 1 em carga comercial', () => {
  // Noite muito baixa puxa a media para baixo: o minimo diurno a supera.
  const v = Array.from({ length: 96 }, (_, i) => (i >= 36 && i < 60 ? 10 : 1));
  const f = fatorDeForma(v, 9, 15);
  assert.ok(f !== null && f > 1, `esperava > 1, veio ${f}`);
});

test('o CASE sai com um ramo por tipologia e so do dia util', () => {
  const sql = gerarCaseSql([
    { codId: 'RES-Tipo2', tipDia: 'DU', pot: PLANA },
    { codId: 'RES-Tipo2', tipDia: 'SA', pot: PLANA },
    { codId: 'IP-Tipo1',  tipDia: 'DU', pot: PLANA },
  ], 9, 15);
  assert.equal((sql.match(/WHEN/g) ?? []).length, 2);
  assert.ok(sql.includes("WHEN 'RES-Tipo2' THEN"));
  assert.ok(sql.startsWith('CASE u.TIP_CC '));
  assert.ok(sql.endsWith(' ELSE NULL END'));
});

test('o CASE escapa apostrofo no codigo da tipologia', () => {
  const sql = gerarCaseSql([{ codId: "O'REILLY", tipDia: 'DU', pot: PLANA }], 9, 15);
  assert.ok(sql.includes("WHEN 'O''REILLY' THEN"), sql);
});

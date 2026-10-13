import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerCsv, fasesDe, pontoDeWkt, montarTrafos } from '../src/bdgd/carregar.js';

test('o CSV do ogr2ogr vem com campo entre aspas e virgula dentro', () => {
  const r = lerCsv('a,b\n"POINT (-47.6 -23.5)","SOROCABA 3, SIMUS"\n');
  assert.deepEqual(r, [{ a: 'POINT (-47.6 -23.5)', b: 'SOROCABA 3, SIMUS' }]);
});

test('o CSV respeita aspas dupla escapada', () => {
  assert.deepEqual(lerCsv('a\n"diz ""oi"""\n'), [{ a: 'diz "oi"' }]);
});

test('as fases saem do numero de condutores de fase, sem o neutro', () => {
  assert.equal(fasesDe('ABC'), 3);
  assert.equal(fasesDe('ABCN'), 3);
  assert.equal(fasesDe('AB'), 2);
  assert.equal(fasesDe('AN'), 1);
  assert.equal(fasesDe('A'), 1);
  assert.equal(fasesDe('0'), null);
  assert.equal(fasesDe(''), null);
});

test('o WKT de ponto virа lng/lat', () => {
  assert.deepEqual(pontoDeWkt('POINT (-47.60626405784 -23.5769915617112)'),
    { lng: -47.60626405784, lat: -23.5769915617112 });
  assert.deepEqual(pontoDeWkt('POINT(-47.4 -23.5)'), { lng: -47.4, lat: -23.5 });
  assert.equal(pontoDeWkt(''), null);
  assert.equal(pontoDeWkt('MULTIPOLYGON (((0 0, 1 1, 1 0, 0 0)))'), null);
});

test('monta o trafo juntando carga e GD pelo codigo', () => {
  const r = montarTrafos(
    [{ Shape: 'POINT (-47.6 -23.5)', COD_ID: '1159063', POT_NOM: '75', CTMT: 'SPI14',
       SUB: 'SPI', FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN', TEN_LIN_SE: '0.22', SIT_ATIV: 'AT' }],
    [{ trafo: '1159063', ucs: '42', carga_min_diurna_kw: '11.7072635132107' }],
    [{ trafo: '1159063', unidades: '2', gd_kw: '8.4' }],
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].codigo, '1159063');
  assert.equal(r[0].alimentador_codigo, 'SPI14');
  assert.equal(r[0].potencia_nominal_kva, 75);
  assert.equal(r[0].fases, 3);
  assert.equal(r[0].tensao_secundaria_v, 220);          // 0,22 kV -> 220 V
  assert.equal(r[0].carga_min_diurna_kw, 11.71);        // 2 casas
  assert.equal(r[0].gd_conectada_kw, 8.4);
  assert.deepEqual({ lng: r[0].lng, lat: r[0].lat }, { lng: -47.6, lat: -23.5 });
});

test('trafo sem carga fica NULO, nunca zero', () => {
  // Zero diria "tem carga, e e nenhuma"; nulo diz "nao sei". A regra do
  // semaforo manda os dois para sem_dado, mas o insumo tem de ser honesto.
  const r = montarTrafos(
    [{ Shape: 'POINT (-47.6 -23.5)', COD_ID: 'X', POT_NOM: '75', CTMT: 'A', SUB: 'S',
       FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN', TEN_LIN_SE: '0.22', SIT_ATIV: 'AT' }],
    [], []);
  assert.equal(r[0].carga_min_diurna_kw, null);
  assert.equal(r[0].gd_conectada_kw, 0);   // sem GD e zero de verdade: ninguem conectou
});

const bom = (cod: string) => ({ Shape: 'POINT (-47.6 -23.5)', COD_ID: cod,
  POT_NOM: '75', CTMT: 'A', SUB: 'S', FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN',
  TEN_LIN_SE: '0.22', SIT_ATIV: 'AT' });

test('um trafo sem geometria e descartado, nao aborta a ingestao', () => {
  // Abortar 6,5 GB por uma linha torta e pior que seguir sem ela.
  const entrada = [...Array.from({ length: 200 }, (_, i) => bom(`T${i}`)),
                   { ...bom('SEM_GEOM'), Shape: '' }];
  const r = montarTrafos(entrada, [], []);
  assert.equal(r.length, 200);
  assert.ok(!r.some(x => x.codigo === 'SEM_GEOM'));
});

test('descarte em massa aborta, porque e defeito de dado', () => {
  const entrada = [bom('T1'), { ...bom('A'), Shape: '' }, { ...bom('B'), Shape: '' }];
  assert.throws(() => montarTrafos(entrada, [], []), /sem geometria utilizavel/);
});

test('trafo desativado na BDGD nao entra', () => {
  const r = montarTrafos(
    [{ Shape: 'POINT (-47.6 -23.5)', COD_ID: 'DESL', POT_NOM: '75', CTMT: 'A', SUB: 'S',
       FAS_CON_P: 'ABC', FAS_CON_S: 'ABCN', TEN_LIN_SE: '0.22', SIT_ATIV: 'DS' }],
    [], []);
  assert.equal(r.length, 0);
});

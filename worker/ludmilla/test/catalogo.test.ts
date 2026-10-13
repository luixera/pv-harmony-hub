import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarTitulo, cabeNoDisco } from '../src/bdgd/catalogo.js';

const GB = 1024 ** 3;

test('o titulo do item da ANEEL carrega sigla, codigo e data-base', () => {
  const r = interpretarTitulo('CPFL_Piratininga_2937_2025-12-31_V11_20260823-1826');
  assert.deepEqual(r, {
    titulo: 'CPFL_Piratininga_2937_2025-12-31_V11_20260823-1826',
    sigla: 'CPFL_Piratininga',
    codigoAneel: '2937',
    dataBase: '2025-12-31',
  });
});

test('nome com mais partes ainda e lido', () => {
  const r = interpretarTitulo('Energisa_Minas_Rio_6585_2025-12-31_V11_20260824-0939');
  assert.equal(r?.sigla, 'Energisa_Minas_Rio');
  assert.equal(r?.codigoAneel, '6585');
  assert.equal(r?.dataBase, '2025-12-31');
});

test('titulo que nao e BDGD devolve null', () => {
  assert.equal(interpretarTitulo('Manual de Instruções da BDGD Rev5'), null);
});

test('o guard-rail pede 5,3x o zip mais 30% de folga', () => {
  // Medido em 13/10/2026: 0,41 GB de zip viraram 2,2 GB extraidos.
  const r = cabeNoDisco(20 * GB, 1 * GB);
  assert.equal(r.cabe, true);
  // 1 GB zip + 5,3 GB extraido = 6,3 GB, x1,3 = 8,19 GB
  assert.ok(r.precisaBytes > 8 * GB && r.precisaBytes < 8.3 * GB,
    `precisaBytes = ${r.precisaBytes / GB} GB`);
});

test('disco apertado reprova antes de baixar', () => {
  const r = cabeNoDisco(4 * GB, 1 * GB);
  assert.equal(r.cabe, false);
});

test('a Paulista nao cabe em 8 GB livres', () => {
  // 1,22 GB de zip -> ~6,5 GB extraido -> precisa ~10 GB
  assert.equal(cabeNoDisco(8 * GB, 1.22 * GB).cabe, false);
  assert.equal(cabeNoDisco(12 * GB, 1.22 * GB).cabe, true);
});

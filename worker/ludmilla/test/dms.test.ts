import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalParaDms, parsearCoordenadas } from '../src/dms.js';

test('converte latitude sul negativa', () => {
  assert.equal(decimalParaDms(-23.207407, 'lat'), "23°12'26.7\"S");
});

test('converte longitude oeste negativa', () => {
  assert.equal(decimalParaDms(-46.891502, 'lng'), "46°53'29.4\"W");
});

test('converte latitude norte positiva', () => {
  assert.equal(decimalParaDms(22.906847, 'lat'), "22°54'24.6\"N");
});

test('converte longitude leste positiva', () => {
  assert.equal(decimalParaDms(43.172897, 'lng'), "43°10'22.4\"E");
});

test('zero graus', () => {
  assert.equal(decimalParaDms(0, 'lat'), "0°0'0.0\"N");
});

test('parsearCoordenadas extrai lat/lng do formato do banco', () => {
  const r = parsearCoordenadas('-23.207407, -46.891502');
  assert.ok(r);
  assert.equal(r!.lat.toFixed(6), '-23.207407');
  assert.equal(r!.lng.toFixed(6), '-46.891502');
});

test('parsearCoordenadas retorna null para string inválida', () => {
  assert.equal(parsearCoordenadas('sem coordenadas'), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalParaDms, parsearCoordenadas } from '../src/dms.js';

// Formato do portal CPFL (gravação de 16/09/2026): 20° 52' 45.7" — sem letra
// de hemisfério; a área da CPFL é toda Sul/Oeste, o sinal não é digitado.

test('converte latitude sul negativa no formato do portal', () => {
  assert.equal(decimalParaDms(-20.879367, 'lat'), "20° 52' 45.7\"");
});

test('converte longitude oeste negativa no formato do portal', () => {
  assert.equal(decimalParaDms(-49.574528, 'lng'), "49° 34' 28.3\"");
});

test('valor positivo sai igual (só o módulo)', () => {
  assert.equal(decimalParaDms(22.906847, 'lat'), "22° 54' 24.6\"");
});

test('zero graus', () => {
  assert.equal(decimalParaDms(0, 'lat'), "0° 0' 0.0\"");
});

test('segundos que arredondam para 60 sobem o minuto', () => {
  // 10°29'59.97" → arredonda para 10°30'0.0"
  assert.equal(decimalParaDms(-10.499992, 'lat'), "10° 30' 0.0\"");
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

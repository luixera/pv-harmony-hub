import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalParaDms, parsearCoordenadas } from '../src/dms.js';

// Formato do portal CPFL (gravação de 16/09/2026): 20° 52' 45.7" — sem letra
// de hemisfério; a área da CPFL é toda Sul/Oeste, o sinal não é digitado.
// Graus, minutos e segundos sempre com 2 dígitos: a máscara do campo só olha os
// dígitos e os encaixa em GG° MM' SS.SS".

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
  assert.equal(decimalParaDms(0, 'lat'), "00° 00' 00.0\"");
});

test('segundos que arredondam para 60 sobem o minuto', () => {
  // 10°29'59.97" → arredonda para 10°30'00.0"
  assert.equal(decimalParaDms(-10.499992, 'lat'), "10° 30' 00.0\"");
});

// PRJ-15238, simulação de 05/11/2026: "23° 6' 59.0\"" virou 23° 65' 90.00" S na tela e na Revisão.
test('minuto de um dígito leva o zero à esquerda', () => {
  assert.equal(decimalParaDms(-23.116379, 'lat'), "23° 06' 59.0\"");
});

test('segundo de um dígito leva o zero à esquerda', () => {
  assert.equal(decimalParaDms(-46.95087067435883, 'lng'), "46° 57' 03.1\"");
});

test('a máscara do portal lê o mesmo valor em qualquer coordenada', () => {
  const mascara = (texto: string) => {
    const d = texto.replace(/\D/g, '').padEnd(8, '0');
    return { graus: Number(d.slice(0, 2)), minutos: Number(d.slice(2, 4)), segundos: Number(`${d.slice(4, 6)}.${d.slice(6, 8)}`) };
  };
  for (let decimal = -33.75; decimal < -19; decimal += 0.00137) {
    const { graus, minutos, segundos } = mascara(decimalParaDms(decimal, 'lat'));
    assert.ok(minutos < 60 && segundos < 60, `${decimal} virou ${graus}° ${minutos}' ${segundos}"`);
    const volta = graus + minutos / 60 + segundos / 3600;
    assert.ok(Math.abs(volta - Math.abs(decimal)) < 0.0001, `${decimal} voltou como ${volta}`);
  }
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medidaDe } from '../src/disco.js';

/**
 * `statfs` devolve blocos, não bytes: total = bsize × blocks, livre =
 * bsize × bavail (bavail, não bfree — bfree inclui o que só o root usa).
 * A conta é pequena e é exatamente onde um erro passa despercebido, então
 * ela vive separada da leitura do sistema de arquivos, para ser testável
 * sem depender do disco de quem roda o teste.
 */

test('converte blocos em bytes e calcula a ocupação', () => {
  // 4 KiB por bloco, 30M blocos ≈ 123 GB; 9,6M disponíveis ≈ 39 GB
  const m = medidaDe({ bsize: 4096, blocks: 30_000_000, bavail: 9_600_000 });
  assert.equal(m.totalBytes, 122_880_000_000);
  assert.equal(m.livreBytes, 39_321_600_000);
  assert.equal(m.usadoBytes, 83_558_400_000);
  assert.equal(m.ocupacaoPct, 68);
});

test('arredonda a ocupação em uma casa decimal', () => {
  // usado 2000 de 3000 = 66,666…%
  const m = medidaDe({ bsize: 1000, blocks: 3, bavail: 1 });
  assert.equal(m.ocupacaoPct, 66.7);
});

test('disco cheio dá 100% e livre zero', () => {
  const m = medidaDe({ bsize: 4096, blocks: 1000, bavail: 0 });
  assert.equal(m.livreBytes, 0);
  assert.equal(m.usadoBytes, 4_096_000);
  assert.equal(m.ocupacaoPct, 100);
});

test('total zero não divide por zero', () => {
  const m = medidaDe({ bsize: 4096, blocks: 0, bavail: 0 });
  assert.equal(m.totalBytes, 0);
  assert.equal(m.usadoBytes, 0);
  assert.equal(m.ocupacaoPct, 0);
});

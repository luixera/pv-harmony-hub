import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeAssinado, sha256 } from '../src/fila.js';

test('sha256 é estável e tem 64 hex', () => {
  const h = sha256(Buffer.from('memorial'));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha256(Buffer.from('memorial')));
  assert.notEqual(h, sha256(Buffer.from('memorial ')));
});

test('nomeAssinado troca a extensão e marca o arquivo', () => {
  assert.equal(nomeAssinado('memorial.pdf'), 'memorial_assinado.pdf');
  assert.equal(nomeAssinado('FORMULARIO_CEMIG.xlsx'), 'FORMULARIO_CEMIG_assinado.pdf');
  assert.equal(nomeAssinado('sem-extensao'), 'sem-extensao_assinado.pdf');
  // não duplica o sufixo se já vier assinado
  assert.equal(nomeAssinado('memorial_assinado.pdf'), 'memorial_assinado.pdf');
});

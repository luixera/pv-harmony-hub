import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassoRecusado, nomeAssinado, nomeSeguroParaStorage, sha256 } from '../src/fila.js';

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

test('sha256 bate com o vetor conhecido de "abc"', () => {
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('nomeSeguroParaStorage tira acento e troca o que o Storage não aceita', () => {
  assert.equal(nomeSeguroParaStorage('Memorial Técnico - Instalação_assinado.pdf'), 'Memorial_Tecnico_-_Instalacao_assinado.pdf');
  assert.equal(nomeSeguroParaStorage('Unifilar (rev #2)_assinado.pdf'), 'Unifilar__rev__2__assinado.pdf');
  assert.equal(nomeSeguroParaStorage('já-ok_1.2.pdf'), 'ja-ok_1.2.pdf');
  assert.match(nomeSeguroParaStorage('日本語.pdf'), /^[A-Za-z0-9._-]+$/);
  assert.equal(nomeSeguroParaStorage(''), 'documento');
});

test('PassoRecusado é um Error distinguível (só ele autoriza apagar o assinado)', () => {
  const e = new PassoRecusado('recusado');
  assert.ok(e instanceof Error);
  assert.ok(e instanceof PassoRecusado);
  assert.equal(e.name, 'PassoRecusado');
  assert.ok(!(new Error('rede') instanceof PassoRecusado));
});

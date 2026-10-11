import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PassoRecusado, entregarRecados, nomeAssinado, nomeSeguroParaStorage, recadoFoiEntregue, sha256,
} from '../src/fila.js';

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

// ── Recados do Zé ───────────────────────────────────────────────────────────
test('recadoFoiEntregue: só { ok, recado } conta; "pulou" e erro HTTP não', () => {
  assert.equal(recadoFoiEntregue({ data: { ok: true, recado: true }, error: null }), true);
  // Zé desligado/desconectado: 200 com pulou — nada foi enviado
  assert.equal(recadoFoiEntregue({ data: { ok: true, pulou: 'Zé desligado ou desconectado' }, error: null }), false);
  // erro HTTP (403 do portador, 502 do envio): o invoke devolve `error`, não lança
  assert.equal(recadoFoiEntregue({ data: null, error: new Error('403') }), false);
  assert.equal(recadoFoiEntregue({ data: { ok: false, error: 'falhou' }, error: null }), false);
  assert.equal(recadoFoiEntregue({ data: null, error: null }), false);
  assert.equal(recadoFoiEntregue({ data: 'texto', error: null }), false);
  assert.equal(recadoFoiEntregue({ data: { ok: true, recado: true, pulou: 'x' }, error: null }), false);
});

test('entregarRecados: envia e DEPOIS marca, cada um com o seu resultado', async () => {
  const ordem: string[] = [];
  const r = await entregarRecados(
    async (tenant, texto) => { ordem.push(`envia ${tenant} ${texto}`); return texto !== 'falha'; },
    async () => [
      { id: 'r1', tenant_id: 't1', texto: 'Libero?' },
      { id: 'r2', tenant_id: 't1', texto: 'falha' },
    ],
    async (id, ok) => { ordem.push(`marca ${id} ${ok}`); },
  );
  assert.deepEqual(ordem, ['envia t1 Libero?', 'marca r1 true', 'envia t1 falha', 'marca r2 false']);
  assert.deepEqual(r, { enviados: 1, falhas: 1 });
});

test('entregarRecados: falha ao marcar um recado não impede os seguintes', async () => {
  const marcados: string[] = [];
  const r = await entregarRecados(
    async () => true,
    async () => [
      { id: 'r1', tenant_id: 't', texto: 'a' },
      { id: 'r2', tenant_id: 't', texto: 'b' },
    ],
    async (id) => { marcados.push(id); if (id === 'r1') throw new Error('rede'); },
  );
  assert.deepEqual(marcados, ['r1', 'r2']);
  assert.deepEqual(r, { enviados: 2, falhas: 0 });
});

test('entregarRecados: fila vazia não envia nem marca nada', async () => {
  let chamadas = 0;
  const r = await entregarRecados(
    async () => { chamadas++; return true; },
    async () => [],
    async () => { chamadas++; },
  );
  assert.equal(chamadas, 0);
  assert.deepEqual(r, { enviados: 0, falhas: 0 });
});

test('entregarRecados: erro ao consultar a fila sobe (quem chama só loga)', async () => {
  await assert.rejects(
    entregarRecados(async () => true, async () => { throw new Error('sem fila'); }, async () => undefined),
    /sem fila/,
  );
});

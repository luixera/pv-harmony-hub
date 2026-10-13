import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jaCarregada } from '../src/bdgd/guarda.js';

// O caso que motivou este teste (13/10/2026): a 1a ingestao na VPS falhou no
// unzip, mas a distribuidora ja tinha ficado com data_base = 2025-12-31. Uma
// guarda que olhasse a distribuidora pularia a carga para sempre.

test('importacao que falhou nao conta como carregada', () => {
  assert.equal(jaCarregada([{ data_base: '2025-12-31', situacao: 'falhou' }], '2025-12-31'), false);
});

test('importacao rodando (ou que morreu no meio) nao conta', () => {
  assert.equal(jaCarregada([{ data_base: '2025-12-31', situacao: 'rodando' }], '2025-12-31'), false);
});

test('importacao concluida da mesma data-base conta', () => {
  assert.equal(jaCarregada([
    { data_base: '2025-12-31', situacao: 'falhou' },
    { data_base: '2025-12-31', situacao: 'concluida' },
  ], '2025-12-31'), true);
});

test('concluida de data-base ANTERIOR nao impede a nova', () => {
  // a ANEEL publica a base nova no meio do ano: e o caso normal do cron
  assert.equal(jaCarregada([{ data_base: '2024-12-31', situacao: 'concluida' }], '2025-12-31'), false);
});

test('sem importacao nenhuma, nao esta carregada', () => {
  assert.equal(jaCarregada([], '2025-12-31'), false);
});

import { desfechoDa } from '../src/bdgd/guarda.js';

// A promocao passou para um job de pg_cron (13/10/2026: a API tem 8 s e a
// promocao da Piratininga levava 11). O worker so pergunta o desfecho.

test('rodando e esperar', () => {
  assert.equal(desfechoDa('rodando'), 'esperar');
});

test('concluida e falhou encerram a espera', () => {
  assert.equal(desfechoDa('concluida'), 'concluida');
  assert.equal(desfechoDa('falhou'), 'falhou');
});

test('importacao que sumiu nao pode virar espera eterna', () => {
  assert.equal(desfechoDa(null), 'falhou');
  assert.equal(desfechoDa(undefined), 'falhou');
  assert.equal(desfechoDa('estado-inventado'), 'falhou');
});

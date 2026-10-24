import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerPercentualPortal, normalizarUc, percentualPortal, percentuaisBatem, restoGeradora,
} from '../src/criacao/util.js';
import { ROTULO_COMPENSACAO } from '../src/criacao/tipos.js';

// As contas do bloco de beneficiárias (autoconsumo remoto, telas de 21/10/2026).
// A prova de que o portal aceitou o rateio é o "Percentual da sua
// microgeradora" bater com o resto — então ler e comparar têm de ser exatos.

test('normalizarUc: só dígitos, como o portal mostra na linha', () => {
  assert.equal(normalizarUc('1.260.283.036-50'), '126028303650');
  assert.equal(normalizarUc(' 755 045 036 12 '), '75504503612');
  assert.equal(normalizarUc(undefined), '');
});

test('restoGeradora: 100 − soma, 4 casas, nunca negativo', () => {
  assert.equal(restoGeradora([30, 50]), 20);
  assert.equal(restoGeradora([70, 30]), 0);
  assert.equal(restoGeradora([33.3333, 33.3333]), 33.3334);
  // soma > 100 é barrada antes (banco e front); aqui só não pode virar negativo
  assert.equal(restoGeradora([70, 40]), 0);
  // 0,1 + 0,2 em ponto flutuante
  assert.equal(restoGeradora([0.1, 0.2]), 99.7);
});

test('percentualPortal: vírgula e 4 casas, como o campo do portal ("70,0000%")', () => {
  assert.equal(percentualPortal(30), '30,0000');
  assert.equal(percentualPortal(12.34567), '12,3457');
  assert.equal(percentualPortal(100), '100,0000');
});

test('lerPercentualPortal: o que o portal escreve na microgeradora', () => {
  assert.equal(lerPercentualPortal('0,0000%'), 0);
  assert.equal(lerPercentualPortal('100,00%'), 100);
  assert.equal(lerPercentualPortal(' 20,0000 % '), 20);
  assert.equal(lerPercentualPortal('33.3334%'), 33.3334);
  assert.equal(lerPercentualPortal('sem número'), null);
  assert.equal(lerPercentualPortal(null), null);
});

test('percentuaisBatem: iguais dentro das 4 casas', () => {
  assert.equal(percentuaisBatem(20, 20.00004), true);
  assert.equal(percentuaisBatem(20, 20.0001), false);
  assert.equal(percentuaisBatem(33.3334, restoGeradora([33.3333, 33.3333])), true);
});

test('rótulos do select de compensação são os da tela de 21/10/2026', () => {
  assert.equal(ROTULO_COMPENSACAO.autoconsumo_remoto, 'Microgeração Distribuída Caracterizada Como Autoconsumo Remoto');
  assert.equal(ROTULO_COMPENSACAO.geracao_local, 'Microgeração Distribuída Com Geração Local');
});

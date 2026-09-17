import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areaArranjos, camposFaltando, dataMais, errosDoHtml, extrairNodeId, numero, pessoaFisica, simNao, valorFases,
} from '../src/criacao/util.js';

test('numero: ponto decimal, sem zeros à direita', () => {
  assert.equal(numero(620 / 1000), '0.62');
  assert.equal(numero(2.25), '2.25');
  assert.equal(numero(8), '8');
  assert.equal(numero(4.9600001), '4.96');
});

test('dataMais: hoje + N dias em ISO (o input type=date só aceita AAAA-MM-DD)', () => {
  assert.equal(dataMais(30, new Date(2026, 8, 17)), '2026-10-17');
  assert.equal(dataMais(0, new Date(2026, 11, 31)), '2026-12-31');
});

test('valorFases: value do select do portal + texto do inversor', () => {
  assert.deepEqual(valorFases(2, null), { select: '2751', texto: 'Bifásico' });
  assert.deepEqual(valorFases(null, 'trifasico'), { select: '2756', texto: 'Trifásico' });
  assert.deepEqual(valorFases(null, 'monofasico'), { select: '2746', texto: 'Monofásico' });
  // sem informação: bifásico é o caso comum de GD residencial
  assert.deepEqual(valorFases(null, null), { select: '2751', texto: 'Bifásico' });
});

test('simNao: regex do rótulo, começando com a palavra', () => {
  assert.ok(simNao('sim').test('Sim'));
  assert.ok(!simNao('sim').test('Não'));
  assert.ok(simNao('nao').test('Não'));
  assert.ok(simNao(undefined).test('Não'), 'padrão é Não');
  assert.ok(!simNao('nao').test('Não sei'), 'exige a palavra inteira');
});

test('camposFaltando: vazio, nulo ou 0 conta como faltando', () => {
  const fd = { a: '8', b: '', c: null, d: '0', e: '4.96' };
  assert.deepEqual(camposFaltando(fd, ['a', 'b', 'c', 'd', 'e']), ['b', 'c', 'd']);
});

test('extrairNodeId: URL depois do Salvar', () => {
  assert.equal(extrairNodeId('https://www.cpfl.com.br/gestao-projetos/node/546581/edit?new=true&step=6'), '546581');
  assert.equal(extrairNodeId('https://www.cpfl.com.br/gestao-projetos/node/add/project_60'), null);
});

test('errosDoHtml: campo com aria-invalid e mensagem "Campo obrigatório!" do Drupal', () => {
  const html = `
    <div class="js-form-item form-type-number"><label for="edit-x">Quant. X Potência de pico</label>
    <input id="edit-field-modules-0-modules-total-row" name="f[modules_total_row]" aria-invalid="true" class="form-number error is-invalid">
    <div class="invalid-feedback">Campo obrigatório!</div></div>
    <div class="messages messages--error">O campo Potência Instalada do Gerador é obrigatório.</div>`;
  const e = errosDoHtml(html);
  assert.deepEqual(e.campos, ['f[modules_total_row]']);
  assert.ok(e.mensagens.includes('Campo obrigatório!'));
  assert.ok(e.mensagens.some(m => m.includes('Potência Instalada')));
});

test('errosDoHtml: sem erro', () => {
  assert.deepEqual(errosDoHtml('<form><input name="a"></form>'), { campos: [], mensagens: [] });
});

test('pessoaFisica: CPF tem 11 dígitos, CNPJ 14', () => {
  assert.equal(pessoaFisica('133.514.268-10'), true);
  assert.equal(pessoaFisica('12.345.678/0001-90'), false);
});

test('areaArranjos: módulos × m² por módulo, inteiro', () => {
  assert.equal(areaArranjos(8, 3), '24');
  assert.equal(areaArranjos(7, 2.6), '18');
});

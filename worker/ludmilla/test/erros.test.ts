import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarErro, ErroLudmilla } from '../src/erros.js';

test('CAPTCHA exigido derruba a conta para erro e explica a contingência', () => {
  const r = classificarErro(new ErroLudmilla('captcha_exigido', 'O portal pediu CAPTCHA no login.'));
  assert.equal(r.classe, 'captcha_exigido');
  assert.equal(r.situacaoConta, 'erro');
  assert.match(r.mensagem, /CAPTCHA/);
  assert.match(r.mensagem, /sessão/i); // aponta a saída: importar a sessão
});

test('sessão expirada pede reconexão, não marca a conta como erro', () => {
  const r = classificarErro(new ErroLudmilla('sessao_expirada', 'Caiu na tela de login de novo.'));
  assert.equal(r.situacaoConta, 'sessao_expirada');
  assert.match(r.mensagem, /reconect/i);
});

test('página que mudou não derruba a conta — o problema é do roteiro', () => {
  const r = classificarErro(new ErroLudmilla('pagina_mudou', 'Não achei a tabela de projetos.'));
  assert.equal(r.situacaoConta, 'ok');
  assert.match(r.mensagem, /Não achei a tabela/);
});

test('erro desconhecido vira "falhou", em português, sem stack trace', () => {
  const r = classificarErro(new TypeError("Cannot read properties of undefined (reading 'x')"));
  assert.equal(r.classe, 'falhou');
  assert.equal(r.situacaoConta, 'ok');
  assert.doesNotMatch(r.mensagem, /at .*\.js:\d+/);
  assert.match(r.mensagem, /Cannot read properties/); // o detalhe técnico fica, curto
});

test('timeout do Playwright é lido como página que mudou (ou lenta), não como conta quebrada', () => {
  const e = new Error('page.waitForSelector: Timeout 30000ms exceeded.');
  e.name = 'TimeoutError';
  const r = classificarErro(e);
  assert.equal(r.classe, 'pagina_mudou');
  assert.equal(r.situacaoConta, 'ok');
});

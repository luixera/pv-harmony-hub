import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarErro, classificarErroEmail, ErroLudmilla } from '../src/erros.js';

test('CAPTCHA exigido derruba a conta para erro e explica a contingência', () => {
  const r = classificarErro(new ErroLudmilla('captcha_exigido', 'O portal pediu CAPTCHA no login.'));
  assert.equal(r.classe, 'captcha_exigido');
  assert.equal(r.situacaoConta, 'erro');
  assert.match(r.mensagem, /CAPTCHA/);
  assert.match(r.mensagem, /estação local/i); // aponta a saída: a conta no modo estação, com uma pessoa digitando o código
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

// ── O run de e-mail tem vocabulário próprio ─────────────────────────────────
// A conta da EDP não tem portal nem print: dizer "Veja o print" ou "A visita
// falhou" é texto errado na tela de quem paga pelo sistema.

test('falta de regra de e-mail diz o que fazer, e não "a visita falhou"', () => {
  const r = classificarErroEmail(new Error('Esta concessionária não tem regras de e-mail cadastradas na tela da Ludmilla.'));
  assert.equal(r.classe, 'sem_regras');
  assert.equal(r.situacaoConta, 'ok', 'é configuração nossa, a conta não está quebrada');
  assert.match(r.mensagem, /regra de leitura de e-mail/i);
  assert.match(r.mensagem, /Concessionárias/);
  assert.doesNotMatch(r.mensagem, /visita|portal|print|página/i);
});

test('caixa sem configuração aponta o agente de e-mail, e derruba a conta', () => {
  const r = classificarErroEmail(new Error('O acesso à caixa de e-mail não está configurado para este tenant (agent_config → email_agent).'));
  assert.equal(r.classe, 'caixa_sem_configuracao');
  assert.equal(r.situacaoConta, 'erro');
  assert.match(r.mensagem, /senha de aplicativo/i);
  assert.doesNotMatch(r.mensagem, /portal|print/i);
});

test('senha de aplicativo recusada é erro de conta, com a causa provável', () => {
  const r = classificarErroEmail(new Error('Invalid credentials (Failure)'));
  assert.equal(r.classe, 'caixa_recusou_acesso');
  assert.equal(r.situacaoConta, 'erro');
  assert.match(r.mensagem, /recusou o acesso/i);
  assert.match(r.mensagem, /revogada/i);
});

test('conexão com a caixa caindo NÃO derruba a conta e diz que nada foi perdido', () => {
  const r = classificarErroEmail(new Error('A conexão com a caixa de e-mail caiu: read ECONNRESET'));
  assert.equal(r.classe, 'caixa_indisponivel');
  assert.equal(r.situacaoConta, 'ok');
  assert.match(r.mensagem, /próxima leitura/i);
  assert.doesNotMatch(r.mensagem, /print|roteiro/i);
});

test('tempo esgotado no e-mail NÃO sai como "a página do portal não está como o roteiro espera"', () => {
  const e = new Error('Command failed: timeout');
  e.name = 'TimeoutError';
  const r = classificarErroEmail(e);
  assert.equal(r.classe, 'caixa_indisponivel');
  assert.doesNotMatch(r.mensagem, /página do portal|print/i);
});

test('erro desconhecido do e-mail fala de leitura de e-mail, sem stack trace', () => {
  const r = classificarErroEmail(new TypeError("Cannot read properties of undefined (reading 'x')"));
  assert.equal(r.classe, 'falhou_email');
  assert.equal(r.situacaoConta, 'ok');
  assert.match(r.mensagem, /leitura dos e-mails/i);
  assert.match(r.mensagem, /Cannot read properties/);
  assert.doesNotMatch(r.mensagem, /at .*\.js:\d+/);
});

test('o caminho do portal continua intacto: as mesmas frases de antes', () => {
  // `classificarErroEmail` é ACRÉSCIMO; a função do portal não foi alterada
  assert.match(classificarErro(new Error('x')).mensagem, /A visita falhou por um motivo inesperado/);
  assert.match(classificarErro(new ErroLudmilla('pagina_mudou', 'y')).mensagem, /Veja o print/);
});

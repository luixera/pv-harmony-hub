import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { chromium, Browser } from 'playwright';
import { vereditoDepoisDaSenha } from '../src/veredito.js';

/**
 * Depois de enviar a senha, o portal mostra UMA de quatro telas. O veredito
 * é o que a tela de "Acesso ao portal" exibe para o usuário — e o que decide
 * o desenho do roteiro de leitura (precisa de segundo fator ou não).
 */

const PAGINAS: Record<string, string> = {
  '/entrou': `<html><head><title>Meus Projetos - CPFL</title></head><body>
    <h1>Meus Projetos</h1><table><tr><td>2086446404</td></tr></table></body></html>`,
  '/mfa-email': `<html><head><title>Verificação</title></head><body>
    <p>Enviamos um código de verificação para o seu e-mail. Digite o código abaixo.</p>
    <input id="emailVerificationCode" type="text"><button id="emailVerificationControl_but_verify_code">Verificar</button></body></html>`,
  '/mfa-sms': `<html><head><title>Verificação</title></head><body>
    <p>Enviamos um código por SMS para o celular terminado em 1234.</p>
    <input id="verificationCode" type="text"></body></html>`,
  '/senha-errada': `<html><head><title>Entre ou Cadastre-se</title></head><body>
    <div class="error pageLevel" role="alert" style="display:block">Seu e-mail ou senha está incorreto. Tente novamente.</div>
    <input id="signInName" type="text"><input id="password" type="password"></body></html>`,
  '/senha-errada-escondido': `<html><head><title>Entre ou Cadastre-se</title></head><body>
    <div class="error pageLevel" role="alert" style="display:none">Seu e-mail ou senha está incorreto.</div>
    <input id="signInName" type="text"><input id="password" type="password"></body></html>`,
};

let servidor: Server; let base: string; let navegador: Browser;
before(async () => {
  servidor = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINAS[req.url ?? ''] ?? '<html></html>');
  });
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', r));
  const a = servidor.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  navegador = await chromium.launch();
});
after(async () => { await navegador?.close(); servidor?.close(); });

async function veredito(caminho: string) {
  const page = await navegador.newPage();
  await page.goto(base + caminho);
  const v = await vereditoDepoisDaSenha(page, /Meus Projetos/i);
  await page.close();
  return v;
}

test('chegou na lista de projetos = entrou', async () => {
  const v = await veredito('/entrou');
  assert.equal(v.veredito, 'entrou');
});

test('tela pedindo código por e-mail', async () => {
  const v = await veredito('/mfa-email');
  assert.equal(v.veredito, 'pediu_codigo_email');
  assert.match(v.explicacao, /e-mail/i);
});

test('tela pedindo código por SMS', async () => {
  const v = await veredito('/mfa-sms');
  assert.equal(v.veredito, 'pediu_codigo_sms');
});

test('erro de senha visível = senha recusada, com o texto do portal', async () => {
  const v = await veredito('/senha-errada');
  assert.equal(v.veredito, 'senha_recusada');
  assert.match(v.explicacao, /incorreto/);
});

test('erro de senha ESCONDIDO (o B2C deixa a div no HTML) não conta como recusa', async () => {
  const v = await veredito('/senha-errada-escondido');
  assert.notEqual(v.veredito, 'senha_recusada');
  assert.equal(v.veredito, 'desconhecido');
});

test('código de autorização do B2C NUNCA fica no resultado (URL e título limpos)', async () => {
  const page = await navegador.newPage();
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.setContent('<html><head><title>Loading https://www.cpfl.com.br/b2c-auth/receive-token?code=eyJabc.def&state=x</title></head><body>Loading</body></html>');
  const v = await vereditoDepoisDaSenha(page, /Meus Projetos/i);
  await page.close();
  assert.doesNotMatch(v.titulo, /eyJabc/);
  assert.match(v.titulo, /code=\[removido\]/);
});

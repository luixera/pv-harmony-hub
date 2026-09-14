import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { chromium, Browser } from 'playwright';
import { reconhecerPagina } from '../src/reconhecer.js';

/**
 * O reconhecimento descreve a tela de login SEM credencial: que CAPTCHA há,
 * quais campos, se o portal bloqueou antes de mostrar a tela. Testado sobre
 * páginas servidas em localhost — nunca contra o portal de verdade.
 */

const PAGINAS: Record<string, { status: number; html: string }> = {
  '/recaptcha': {
    status: 200,
    html: `<html><head><title>Portal de Projetos — Entrar</title></head><body>
      <form>
        <input name="usuario" placeholder="CPF ou e-mail">
        <input type="password" name="senha" id="campoSenha">
        <input type="hidden" name="token" value="x">
        <iframe src="https://www.google.com/recaptcha/api2/anchor?k=abc"></iframe>
        <button type="submit">Entrar</button>
      </form></body></html>`,
  },
  '/turnstile': {
    status: 200,
    html: `<html><head><title>Login</title>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head>
      <body><input type="email" name="email"><input type="password" name="password"></body></html>`,
  },
  '/limpo': {
    status: 200,
    html: `<html><head><title>Acesso</title></head><body>
      <input type="text" id="login"><input type="password" id="pwd"></body></html>`,
  },
  '/waf': {
    status: 403,
    html: `<html><head><title>Access Denied</title></head><body>
      <h1>Access Denied</h1><p>You don't have permission to access this page. Reference #18.abc</p></body></html>`,
  },
};

let servidor: Server;
let base: string;
let navegador: Browser;

before(async () => {
  servidor = createServer((req, res) => {
    const p = PAGINAS[req.url ?? ''] ?? { status: 404, html: '<html><title>404</title></html>' };
    res.writeHead(p.status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(p.html);
  });
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', r));
  const addr = servidor.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  navegador = await chromium.launch();
});

after(async () => {
  await navegador?.close();
  servidor?.close();
});

async function reconhecer(caminho: string) {
  const page = await navegador.newPage();
  // Teste hermético: as URLs do Google/Cloudflare nas páginas são só
  // assinaturas a reconhecer — nada sai para a rede.
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  const resposta = await page.goto(base + caminho);
  const r = await reconhecerPagina(page, resposta?.status() ?? 0);
  await page.close();
  return r;
}

test('reconhece reCAPTCHA e lista só os campos visíveis (o hidden fica de fora)', async () => {
  const r = await reconhecer('/recaptcha');
  assert.equal(r.captcha, 'recaptcha');
  assert.equal(r.bloqueado_por_waf, false);
  assert.equal(r.titulo, 'Portal de Projetos — Entrar');
  assert.deepEqual(r.campos.map(c => c.name), ['usuario', 'senha']);
  assert.equal(r.campos[1].tipo, 'password');
  assert.equal(r.campos[0].placeholder, 'CPF ou e-mail');
});

test('reconhece Turnstile pelo script', async () => {
  const r = await reconhecer('/turnstile');
  assert.equal(r.captcha, 'turnstile');
  assert.equal(r.campos.length, 2);
});

test('tela sem CAPTCHA diz "nenhum" — a boa notícia também é informação', async () => {
  const r = await reconhecer('/limpo');
  assert.equal(r.captcha, 'nenhum');
  assert.equal(r.campos.map(c => c.id).join(','), 'login,pwd');
});

test('403 com "Access Denied" é bloqueio de WAF, não tela de login', async () => {
  const r = await reconhecer('/waf');
  assert.equal(r.bloqueado_por_waf, true);
  assert.equal(r.captcha, 'desconhecido');
  assert.equal(r.campos.length, 0);
});

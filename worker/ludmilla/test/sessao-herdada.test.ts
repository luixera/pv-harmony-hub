import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookiesDoPortal, cookiesParaArquivo } from '../src/criacao/sessao-herdada.js';

/**
 * A criação deixou de ter login próprio: quem entra na CPFL é o MESMO código da
 * varredura (Playwright, `logarNaCpfl`), e a sessão viaja para a CLI
 * agent-browser em forma de cookies. Estas funções são a ponte — e a ponte é
 * pura, então é aqui que ela se prova.
 *
 * Contexto: o login próprio da criação falhou 4× entre 18/09 e 12/10/2026,
 * sempre no passo 0, com "Você não tem acesso a essa página" e "Olá Usuário"
 * (sessão sem perfil de projetista — o cartão "Serviços para projetistas"
 * nunca foi acionado).
 */

const COOKIE = (extra: Record<string, unknown> = {}) => ({
  name: 'SSESS123', value: 'abc', domain: '.cpfl.com.br', path: '/',
  expires: 1829000000, httpOnly: true, secure: true, sameSite: 'Lax' as const, ...extra,
});

test('cookiesDoPortal: fica só com o que é da CPFL', () => {
  const todos = [
    COOKIE(),
    COOKIE({ name: 'b2c', domain: 'cpflb2cprd.b2clogin.com' }),
    COOKIE({ name: 'alheio', domain: '.google.com' }),
  ];
  const nomes = cookiesDoPortal(todos).map(c => c.name);
  assert.deepEqual(nomes, ['SSESS123', 'b2c']);
});

test('cookiesDoPortal: não leva cookie sem nome ou sem valor', () => {
  const todos = [COOKIE(), COOKIE({ name: '', value: 'x' }), COOKIE({ name: 'y', value: '' })];
  assert.deepEqual(cookiesDoPortal(todos).map(c => c.name), ['SSESS123']);
});

test('cookiesParaArquivo: JSON que a CLI entende, sem expires de sessão', () => {
  const json = JSON.parse(cookiesParaArquivo([
    COOKIE(),
    COOKIE({ name: 'desessao', expires: -1 }),
  ]));
  assert.equal(json.length, 2);
  assert.equal(json[0].name, 'SSESS123');
  assert.equal(json[0].expires, 1829000000);
  assert.equal(json[0].httpOnly, true);
  assert.equal(json[0].sameSite, 'Lax');
  // cookie de sessão não leva expires: -1 vira "sem validade declarada"
  assert.ok(!('expires' in json[1]), 'cookie de sessão não deve levar expires');
});

test('cookiesParaArquivo: o arquivo não é um despejo do objeto do Playwright', () => {
  const json = JSON.parse(cookiesParaArquivo([COOKIE({ sameParty: true, sourceScheme: 'Secure' } as never)]));
  assert.deepEqual(Object.keys(json[0]).sort(),
    ['domain', 'expires', 'httpOnly', 'name', 'path', 'sameSite', 'secure', 'value']);
});

test('cookiesParaArquivo: lista vazia vira [] (e não "undefined")', () => {
  assert.equal(cookiesParaArquivo([]), '[]');
});

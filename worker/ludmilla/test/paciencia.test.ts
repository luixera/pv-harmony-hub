import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comPaciencia } from '../src/paciencia.js';
import { ErroLudmilla } from '../src/erros.js';

/**
 * Portal lento não é portal quebrado. Uma chamada à API que estoura o prazo
 * (aconteceu na CPFL em 15/09/2026, 15:50: "Timeout 30000ms exceeded") é
 * tentada de novo antes de o run falhar — e, se falhar mesmo, a mensagem
 * diz o que estava sendo lido, não o nome do método do Playwright.
 */

test('devolve na primeira quando dá certo', async () => {
  let chamadas = 0;
  const r = await comPaciencia('lista', async () => { chamadas++; return 42; }, { tentativas: 3, pausaMs: 0 });
  assert.equal(r, 42);
  assert.equal(chamadas, 1);
});

test('tenta de novo depois de um estouro de prazo e devolve o que veio', async () => {
  let chamadas = 0;
  const r = await comPaciencia('lista de orçamentos (página 2)', async () => {
    chamadas++;
    if (chamadas < 3) throw new Error('apiRequestContext.get: Timeout 30000ms exceeded');
    return 'ok';
  }, { tentativas: 3, pausaMs: 0 });
  assert.equal(r, 'ok');
  assert.equal(chamadas, 3);
});

test('desiste depois das tentativas com uma frase que diz o que estava lendo', async () => {
  let chamadas = 0;
  await assert.rejects(
    comPaciencia('lista de orçamentos de conexão (página 1)', async () => { chamadas++; throw new Error('apiRequestContext.get: Timeout 90000ms exceeded'); }, { tentativas: 3, pausaMs: 0 }),
    (e: unknown) => {
      assert.ok(e instanceof ErroLudmilla);
      assert.equal(e.classe, 'falhou');
      assert.match(e.message, /lista de orçamentos de conexão \(página 1\)/);
      assert.match(e.message, /3 tentativas/);
      assert.match(e.message, /demorou/i);
      return true;
    },
  );
  assert.equal(chamadas, 3);
});

test('erro da Ludmilla (sessão expirada, senha) passa direto, sem repetir', async () => {
  let chamadas = 0;
  await assert.rejects(
    comPaciencia('lista', async () => { chamadas++; throw new ErroLudmilla('sessao_expirada', 'A API recusou a sessão.'); }, { tentativas: 3, pausaMs: 0 }),
    (e: unknown) => e instanceof ErroLudmilla && e.classe === 'sessao_expirada',
  );
  assert.equal(chamadas, 1);
});

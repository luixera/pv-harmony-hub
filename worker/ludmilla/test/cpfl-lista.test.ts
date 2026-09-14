import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { chromium, Browser } from 'playwright';
import { lerCartoesCpfl, lerPaginacaoCpfl } from '../src/conectores/cpfl-lista.js';

/**
 * Leitura da lista "Meus projetos" da CPFL sobre o HTML REAL capturado pela
 * descoberta de 14/09/2026 (3 cartões + a barra de paginação). Se a CPFL
 * mudar a tela, é este teste que precisa mudar junto com o fixture.
 */

// o tsc não copia o fixture para dist-test: lê da pasta de origem
const HTML = readFileSync(new URL('../../test/fixtures/cpfl-lista.html', import.meta.url), 'utf8');

let servidor: Server; let base: string; let navegador: Browser;
before(async () => {
  servidor = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); });
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', r));
  const a = servidor.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  navegador = await chromium.launch();
});
after(async () => { await navegador?.close(); servidor?.close(); });

test('lê nome, nota/atividade, serviço, status e as datas do painel fechado', async () => {
  const page = await navegador.newPage();
  await page.goto(base + '/');
  const cartoes = await lerCartoesCpfl(page);
  await page.close();

  assert.equal(cartoes.length, 3);
  const [c] = cartoes;
  assert.equal(c.protocolo, '2219727202');            // a ATIVIDADE — é o id do projeto no portal
  assert.equal(c.notaServico, '880947585');
  assert.equal(c.titular, 'UFV JOSÉ - TROCA DE EQUIPAM');
  assert.equal(c.status, 'Pendente');
  assert.match(c.raw['Serviço'], /MICROGERAÇÃO DISTRIBUÍDA/);
  assert.equal(c.raw['Última atualização'], '14/09/2026'); // está no painel, que fica hidden
  assert.equal(c.raw['Cidade'], 'SAO JOSE DO RIO PRETO');
  assert.equal(c.raw['link'], '/gestao-projetos/meus-projetos/2219727202');
  assert.equal(cartoes[1].status, 'Em Andamento');
  assert.equal(cartoes[1].protocolo, '2218355041');
});

test('lê a paginação: "1 - 10 de 203" e se há próxima página', async () => {
  const page = await navegador.newPage();
  await page.goto(base + '/');
  const p = await lerPaginacaoCpfl(page);
  await page.close();
  assert.deepEqual(p, { de: 1, ate: 10, total: 203, temProxima: true });
});

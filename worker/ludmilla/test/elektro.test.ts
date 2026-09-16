import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server, IncomingMessage } from 'node:http';
import { chromium, Browser, Page } from 'playwright';
import { descobrirElektro, entrarElektro, manterVivaElektro } from '../src/conectores/elektro.js';
import { ErroLudmilla } from '../src/erros.js';
import type { CanalCaptcha, TelaDescoberta } from '../src/conectores/index.js';

/**
 * Portal GD da Elektro, de mentira: um formulário JSF com e-mail, senha e
 * CAPTCHA de imagem. O robô preenche e-mail e senha e ESPERA; quem digita o
 * código é a pessoa (aqui, o próprio teste, no mesmo navegador). O servidor
 * confere o que foi enviado — o robô nunca tenta o CAPTCHA.
 */

const CREDS = { login: 'projetos@gdmanager.com.br', senha: 'segredo-do-cofre', connector: 'elektro' };
const CAPTCHA_CERTO = 'abcd';

type Modo = 'ok' | 'senha_errada' | 'waf';
let modo: Modo = 'ok';
let ultimoPost: Record<string, string> | null = null;
let posts = 0;
/** o servidor "derrubou" as sessões: mesmo com cookie, volta o formulário */
let sessoesDerrubadas = false;

const formulario = (erro = '') => `<html><head><title>Portal GD Acessante</title></head><body>
  <h2>Portal GD Acessante</h2>
  ${erro ? `<div class="ui-messages-error"><span class="ui-messages-error-summary">${erro}</span></div>` : ''}
  <form id="j_idt14" method="post" action="/login">
    <label>E-mail</label><input type="text" id="j_idt14:j_idt16" name="j_idt14:j_idt16" value="">
    <label>Senha</label><input type="password" id="j_idt14:j_idt18" name="j_idt14:j_idt18" value="">
    <img src="/captcha.jpg" alt="" width="120" height="40"><input type="text" id="j_idt14:captchaCode" name="j_idt14:captchaCode" value="">
    <input type="hidden" name="javax.faces.ViewState" value="-123:456">
    <button type="submit" id="entrar">Entrar</button>
  </form></body></html>`;

/**
 * Canal remoto de mentira: a "pessoa de longe" responde cada pedido com o
 * próximo item de `respostas`, `demoraMs` depois de o pedido abrir. Guarda o
 * que o robô pediu e como fechou — é o que os testes conferem.
 */
function canalDeMentira(respostas: (string | null)[], demoraMs = 300) {
  const pedidos: { id: string; png: Buffer; tentativa: number; mensagem?: string; abertoEm: number }[] = [];
  const fechados: { id: string; situacao: string; mensagem?: string }[] = [];
  const canal: CanalCaptcha = {
    async pedir(png, tentativa, mensagem) {
      const id = `pedido-${pedidos.length + 1}`;
      pedidos.push({ id, png, tentativa, mensagem, abertoEm: Date.now() });
      return id;
    },
    async ler(id) {
      const p = pedidos.find(x => x.id === id);
      if (!p) return { situacao: 'cancelado' };
      if (fechados.some(f => f.id === id)) return { situacao: fechados.find(f => f.id === id)!.situacao };
      const resposta = respostas[pedidos.indexOf(p)] ?? null;
      if (resposta && Date.now() - p.abertoEm >= demoraMs) return { situacao: 'respondido', resposta };
      return { situacao: 'aguardando' };
    },
    async fechar(id, situacao, mensagem) { fechados.push({ id, situacao, mensagem }); },
  };
  return { canal, pedidos, fechados };
}

const PAGINAS: Record<string, string> = {
  '/inicio': `<html><head><title>Portal GD Acessante</title></head><body>
    <div id="topo">Bem-vindo, Projetos GD Manager <a href="/sair">Sair</a></div>
    <ul id="menu"><li><a href="/nova">Nova solicitação</a></li><li><a href="/solicitacoes">Minhas solicitações</a></li></ul></body></html>`,
  '/solicitacoes': `<html><head><title>Minhas solicitações</title></head><body>
    <div class="ui-datatable"><table><thead><tr><th>Protocolo</th><th>Titular</th><th>Situação</th><th></th></tr></thead>
    <tbody><tr><td>2024001</td><td>JOÃO DA SILVA</td><td>APROVADO</td><td><a href="/solicitacao/2024001">Detalhar</a></td></tr>
    <tr><td>2024002</td><td>MARIA</td><td>EM ANÁLISE</td><td><a href="/solicitacao/2024002">Detalhar</a></td></tr></tbody></table></div>
    <div class="ui-paginator">1 2 3</div></body></html>`,
  '/solicitacao/2024001': `<html><head><title>Solicitação 2024001</title></head><body><h1>Solicitação 2024001</h1>
    <dl><dt>Titular</dt><dd>JOÃO DA SILVA</dd><dt>UC</dt><dd>123456</dd><dt>Situação</dt><dd>APROVADO</dd></dl></body></html>`,
  '/nova': `<html><head><title>Nova</title></head><body><h1>NUNCA DEVERIA ABRIR</h1></body></html>`,
};

const lerCorpo = (req: IncomingMessage) => new Promise<string>(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });

let servidor: Server; let base: string; let navegador: Browser;
before(async () => {
  servidor = createServer(async (req, res) => {
    const url = req.url ?? '';
    const logado = /sessao=1/.test(req.headers.cookie ?? '');
    const html = (status: number, corpo: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(corpo);
    };
    if (modo === 'waf') return html(403, '<html><head><title>Access Denied</title></head><body>Access Denied. Reference #18.abc</body></html>');
    if (url === '/captcha.jpg') { res.writeHead(200, { 'Content-Type': 'image/gif' }); return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); }
    if (req.method === 'POST' && url === '/login') {
      posts++;
      ultimoPost = Object.fromEntries(new URLSearchParams(await lerCorpo(req)));
      if (modo === 'senha_errada') return html(200, formulario('Usuário ou senha inválidos.'));
      if (ultimoPost['j_idt14:captchaCode'] !== CAPTCHA_CERTO) return html(200, formulario('Código da imagem inválido.'));
      res.writeHead(302, { Location: '/inicio', 'Set-Cookie': 'sessao=1; Path=/' }); return res.end();
    }
    if (url === '/' || url === '') return html(200, logado && !sessoesDerrubadas ? PAGINAS['/inicio'] : formulario());
    if (PAGINAS[url]) return html(200, PAGINAS[url]);
    html(404, '<html><title>404</title></html>');
  });
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', r));
  const a = servidor.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  navegador = await chromium.launch();
});
after(async () => { await navegador?.close(); servidor?.close(); });
beforeEach(() => { modo = 'ok'; ultimoPost = null; posts = 0; sessoesDerrubadas = false; });

/**
 * A pessoa: espera o robô preencher a senha (e, na segunda tentativa, o aviso
 * de erro do portal), digita o CAPTCHA e clica em Entrar. Se a página estiver
 * navegando na hora, tenta de novo — gente também tenta de novo.
 */
async function pessoaDigita(page: Page, codigo: string, depoisDeErro = false) {
  const prazo = Date.now() + 30_000;
  while (Date.now() < prazo) {
    try {
      const senha = await page.locator('[id$=":j_idt18"]').inputValue({ timeout: 1_000 });
      const erroVisivel = await page.locator('.ui-messages-error').count() > 0;
      if (senha === CREDS.senha && (!depoisDeErro || erroVisivel)) {
        await page.locator('[id$=":captchaCode"]').fill(codigo, { timeout: 2_000 });
        await page.locator('#entrar').click({ timeout: 2_000 });
        return;
      }
    } catch { /* navegando — olha de novo */ }
    await page.waitForTimeout(100);
  }
  throw new Error(`A pessoa esperou 30 s e o robô não deixou o formulário pronto (código "${codigo}").`);
}

const opcoes = (avisos: string[], extra: Record<string, unknown> = {}) => ({
  loginUrl: base + '/', avisar: (t: string, x: string) => { avisos.push(`${t}: ${x}`); }, intervaloMs: 150, timeoutMs: 30_000, ...extra,
});

test('login assistido: o robô preenche e-mail e senha, avisa, e a pessoa digita o CAPTCHA', async () => {
  const page = await navegador.newPage();
  const avisos: string[] = [];
  const [resultado] = await Promise.all([entrarElektro(page, CREDS, opcoes(avisos)), pessoaDigita(page, CAPTCHA_CERTO)]);
  assert.equal(resultado, 'entrou');
  assert.ok(page.url().endsWith('/inicio'));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /c[oó]digo da imagem/i);
  // o servidor recebeu e-mail e senha do cofre e o código que a PESSOA digitou
  assert.equal(ultimoPost?.['j_idt14:j_idt16'], CREDS.login);
  assert.equal(ultimoPost?.['j_idt14:j_idt18'], CREDS.senha);
  assert.equal(ultimoPost?.['j_idt14:captchaCode'], CAPTCHA_CERTO);
  await page.close();
});

test('CAPTCHA errado: o portal limpa o formulário; o robô preenche de novo e avisa de novo', async () => {
  const page = await navegador.newPage();
  const avisos: string[] = [];
  const pessoa = (async () => { await pessoaDigita(page, 'zzzz'); await pessoaDigita(page, CAPTCHA_CERTO, true); })();
  const [resultado] = await Promise.all([entrarElektro(page, CREDS, opcoes(avisos)), pessoa]);
  assert.equal(resultado, 'entrou');
  assert.equal(posts, 2);
  assert.equal(avisos.length, 2);
  assert.match(avisos[1], /Código da imagem inválido/);
  await page.close();
});

test('senha recusada pelo portal = login_recusado (não fica esperando a pessoa)', async () => {
  modo = 'senha_errada';
  const page = await navegador.newPage();
  const avisos: string[] = [];
  const pessoa = pessoaDigita(page, CAPTCHA_CERTO);
  await assert.rejects(entrarElektro(page, CREDS, opcoes(avisos)), (e: unknown) => {
    assert.ok(e instanceof ErroLudmilla); assert.equal(e.classe, 'login_recusado'); assert.match(e.message, /Usuário ou senha inválidos/);
    return true;
  });
  await pessoa;
  await page.close();
});

test('ninguém digita: sessao_expirada depois do prazo, sem tocar no CAPTCHA', async () => {
  const page = await navegador.newPage();
  const avisos: string[] = [];
  await assert.rejects(entrarElektro(page, CREDS, opcoes(avisos, { timeoutMs: 1_000 })), (e: unknown) => {
    assert.ok(e instanceof ErroLudmilla); assert.equal(e.classe, 'sessao_expirada'); return true;
  });
  assert.equal(posts, 0);
  assert.equal(await page.locator('[id$=":captchaCode"]').inputValue(), '');
  await page.close();
});

test('sessão mantida no perfil do Chrome: entra sem formulário e sem avisar', async () => {
  const contexto = await navegador.newContext();
  await contexto.addCookies([{ name: 'sessao', value: '1', url: base + '/' }]);
  const page = await contexto.newPage();
  const avisos: string[] = [];
  assert.equal(await entrarElektro(page, CREDS, opcoes(avisos)), 'sessao_mantida');
  assert.equal(avisos.length, 0);
  assert.equal(posts, 0);
  await contexto.close();
});

test('bloqueio antes da tela de login = bloqueado_por_waf', async () => {
  modo = 'waf';
  const page = await navegador.newPage();
  await assert.rejects(entrarElektro(page, CREDS, opcoes([])), (e: unknown) => {
    assert.ok(e instanceof ErroLudmilla); assert.equal(e.classe, 'bloqueado_por_waf'); return true;
  });
  await page.close();
});

test('descoberta: guarda início, menu, lista e primeiro detalhe — sem abrir "Nova solicitação"', async () => {
  const page = await navegador.newPage();
  const telas: TelaDescoberta[] = [];
  const pessoa = pessoaDigita(page, CAPTCHA_CERTO);
  const [d] = await Promise.all([
    descobrirElektro(page, CREDS, async t => { telas.push(t); }, opcoes([])),
    pessoa,
  ]);
  const nomes = d.telas.map(t => t.nome);
  assert.deepEqual(nomes, ['01-inicio', '00-menu', '02-lista', '03-detalhe']);
  assert.equal(telas.length, 4);
  const menu = JSON.parse(d.telas[1].html) as { texto: string; href: string }[];
  assert.ok(menu.some(m => m.texto === 'Minhas solicitações' && m.href.endsWith('/solicitacoes')));
  assert.ok(d.telas[2].url.endsWith('/solicitacoes'));
  assert.match(d.telas[2].html, /ui-datatable/);
  assert.ok(d.telas[3].url.endsWith('/solicitacao/2024001'));
  assert.ok(d.telas.every(t => !/NUNCA DEVERIA ABRIR/.test(t.html)));
  await page.close();
});

// ── Código respondido de longe (pela /ludmilla) ──────────────────────────────

test('remoto: o robô fotografa o código, a pessoa de longe responde, o robô envia e fecha como usado', async () => {
  const page = await navegador.newPage();
  const { canal, pedidos, fechados } = canalDeMentira([CAPTCHA_CERTO]);
  const avisos: string[] = [];
  const r = await entrarElektro(page, CREDS, opcoes(avisos, { captcha: canal }));
  assert.equal(r, 'entrou');
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].tentativa, 1);
  // a foto é um PNG de verdade (o <img> do código), não a página inteira
  assert.equal(pedidos[0].png.subarray(1, 4).toString(), 'PNG');
  assert.ok(pedidos[0].png.length > 100 && pedidos[0].png.length < 20_000);
  assert.deepEqual(fechados.map(f => f.situacao), ['usado']);
  // o servidor recebeu e-mail/senha do cofre e o código que a PESSOA DE LONGE digitou
  assert.equal(ultimoPost?.['j_idt14:j_idt16'], CREDS.login);
  assert.equal(ultimoPost?.['j_idt14:captchaCode'], CAPTCHA_CERTO);
  assert.equal(posts, 1);
  await page.close();
});

test('remoto: código errado → pedido fechado como recusado com a mensagem do portal, nova foto (tentativa 2), certo → entrou', async () => {
  const page = await navegador.newPage();
  const { canal, pedidos, fechados } = canalDeMentira(['zzzz', CAPTCHA_CERTO]);
  const r = await entrarElektro(page, CREDS, opcoes([], { captcha: canal }));
  assert.equal(r, 'entrou');
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].tentativa, 2);
  assert.match(pedidos[1].mensagem ?? '', /Código da imagem inválido/);
  assert.deepEqual(fechados.map(f => f.situacao), ['recusado', 'usado']);
  assert.match(fechados[0].mensagem ?? '', /Código da imagem inválido/);
  assert.equal(posts, 2);
  await page.close();
});

test('remoto: a pessoa no PC digita antes da resposta de longe → entrou, pedido fechado como usado', async () => {
  const page = await navegador.newPage();
  const { canal, pedidos, fechados } = canalDeMentira([null]);   // ninguém responde de longe
  const [r] = await Promise.all([entrarElektro(page, CREDS, opcoes([], { captcha: canal })), pessoaDigita(page, CAPTCHA_CERTO)]);
  assert.equal(r, 'entrou');
  assert.equal(pedidos.length, 1);
  assert.deepEqual(fechados.map(f => f.situacao), ['usado']);
  await page.close();
});

test('remoto: ninguém responde → sessao_expirada e pedido fechado como expirado', async () => {
  const page = await navegador.newPage();
  const { canal, pedidos, fechados } = canalDeMentira([null]);
  await assert.rejects(entrarElektro(page, CREDS, opcoes([], { captcha: canal, timeoutMs: 1_500 })), (e: unknown) => {
    assert.ok(e instanceof ErroLudmilla); assert.equal(e.classe, 'sessao_expirada'); return true;
  });
  assert.equal(pedidos.length, 1);
  assert.deepEqual(fechados.map(f => f.situacao), ['expirado']);
  assert.equal(posts, 0);
  await page.close();
});

test('remoto: o canal falhar não impede a pessoa no PC (o balão continua)', async () => {
  const page = await navegador.newPage();
  const canal: CanalCaptcha = {
    async pedir() { throw new Error('GD Manager fora do ar'); },
    async ler() { return { situacao: 'cancelado' }; },
    async fechar() { /* nada */ },
  };
  const avisos: string[] = [];
  const [r] = await Promise.all([entrarElektro(page, CREDS, opcoes(avisos, { captcha: canal })), pessoaDigita(page, CAPTCHA_CERTO)]);
  assert.equal(r, 'entrou');
  assert.equal(avisos.length, 1);
  await page.close();
});

// ── Sessão viva ──────────────────────────────────────────────────────────────

test('sessão viva: logado → true; servidor derrubou as sessões → false (só GET, nunca reenvia formulário)', async () => {
  const contexto = await navegador.newContext();
  await contexto.addCookies([{ name: 'sessao', value: '1', url: base + '/' }]);
  const page = await contexto.newPage();
  const postsAntes = posts;
  assert.equal(await manterVivaElektro(page, { loginUrl: base + '/' }), true);
  sessoesDerrubadas = true;
  assert.equal(await manterVivaElektro(page, { loginUrl: base + '/' }), false);
  assert.equal(posts, postsAntes);
  await contexto.close();
});

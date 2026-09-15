import type { Page } from 'playwright';
import type { Conector, Descoberta, TelaDescoberta } from './index.js';
import type { Credenciais } from '../fila.js';
import { ErroLudmilla } from '../erros.js';
import { reconhecerPagina } from '../reconhecer.js';
import { semSegredos } from '../veredito.js';
import { avisar as avisarNaEstacao, modoAtual } from '../local.js';

/**
 * Elektro — "Portal GD Acessante" da Neoenergia (gdneoenergiaelektro.neoenergia.com).
 *
 * O que já se sabe (set/2026):
 * - a Akamai devolve 403 a qualquer cliente que não seja um Chrome de verdade
 *   em IP de pessoa — por isso a Elektro só roda pela ESTAÇÃO LOCAL;
 * - login JSF/PrimeFaces com e-mail, senha e CAPTCHA de imagem (campos
 *   `j_idt14:j_idt16`, `j_idt14:j_idt18`, `j_idt14:captchaCode`; o prefixo é
 *   gerado pelo JSF e pode mudar — os seletores vão pelo sufixo).
 *
 * LOGIN ASSISTIDO: a Ludmilla preenche e-mail e senha (do cofre), deixa o
 * cursor no campo do código e chama a pessoa. Ela NUNCA lê nem tenta o
 * CAPTCHA — só espera o formulário sumir. O perfil persistente do Chrome
 * guarda a sessão: nas visitas seguintes, muitas vezes nem pede login.
 *
 * `varrer` vem depois da descoberta, escrito sobre as telas reais.
 */

const LOGIN_URL = 'https://gdneoenergiaelektro.neoenergia.com/';

export const SELETOR_ELEKTRO = {
  captcha: 'input[id$=":captchaCode"], input[id*="captcha" i]',
  senha: 'form input[type="password"]',
  /** primeiro campo de texto do formulário que tem senha — e que não é o CAPTCHA */
  email: 'form:has(input[type="password"]) input[type="text"]:not([id*="captcha" i]):not([name*="captcha" i]), form:has(input[type="password"]) input[type="email"]',
  erro: '.ui-messages-error, .ui-message-error, [id$=":messages"] li, .alert-danger, [role="alert"]',
};

export interface OpcoesElektro {
  loginUrl?: string;
  /** como chamar a pessoa (na estação: balão do Windows) */
  avisar?: (titulo: string, texto: string) => void;
  /** quanto tempo esperar a pessoa digitar o código (padrão 5 min) */
  timeoutMs?: number;
  /** de quanto em quanto tempo olhar a tela (padrão 2 s) */
  intervaloMs?: number;
}

export type EntradaElektro = 'entrou' | 'sessao_mantida';

const respirar = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

async function preencher(page: Page, creds: Credenciais) {
  const email = page.locator(SELETOR_ELEKTRO.email).first();
  const senha = page.locator(SELETOR_ELEKTRO.senha).first();
  if (await email.count() === 0 || await senha.count() === 0) {
    throw new ErroLudmilla('pagina_mudou', 'A tela de login da Elektro não tem mais os campos de e-mail e senha que o roteiro conhece.');
  }
  await email.fill(creds.login);
  await senha.fill(creds.senha);
  // o cursor fica no código: a pessoa só precisa olhar a imagem e digitar
  await page.locator(SELETOR_ELEKTRO.captcha).first().focus().catch(() => undefined);
}

/** Primeira mensagem de erro VISÍVEL do PrimeFaces, ou ''. */
async function erroVisivel(page: Page): Promise<string> {
  const lista = page.locator(SELETOR_ELEKTRO.erro);
  const n = await lista.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = lista.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const texto = (await el.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (texto) return texto;
  }
  return '';
}

/**
 * Entra no Portal GD com a pessoa: devolve `entrou` quando o formulário sumiu
 * depois do código digitado, `sessao_mantida` quando o Chrome ainda estava
 * logado. Lança `login_recusado` (senha), `sessao_expirada` (ninguém digitou
 * no prazo), `bloqueado_por_waf` (403 antes da tela).
 */
export async function entrarElektro(page: Page, creds: Credenciais, o: OpcoesElektro = {}): Promise<EntradaElektro> {
  const loginUrl = o.loginUrl ?? LOGIN_URL;
  const avisar = o.avisar ?? avisarNaEstacao;
  const timeoutMs = o.timeoutMs ?? 5 * 60_000;
  const intervaloMs = o.intervaloMs ?? 2_000;

  const resposta = await page.goto(loginUrl, { waitUntil: 'load', timeout: 60_000 });
  const status = resposta?.status() ?? 0;
  if (status === 403 || status === 429) {
    throw new ErroLudmilla('bloqueado_por_waf', `O Portal GD respondeu ${status} antes da tela de login.`);
  }
  await respirar(page, 800);

  if (await page.locator(SELETOR_ELEKTRO.captcha).count() === 0) {
    // sem CAPTCHA na tela: ou o perfil do Chrome ainda tem a sessão, ou a tela mudou
    if (await page.locator(SELETOR_ELEKTRO.senha).count() === 0) return 'sessao_mantida';
    throw new ErroLudmilla('pagina_mudou', 'A tela de login da Elektro não tem mais o campo do CAPTCHA que o roteiro conhece.');
  }

  await preencher(page, creds);
  avisar('Ludmilla precisa de você', 'Digite o código da imagem no Chrome da Elektro e clique em Entrar. E-mail e senha já estão preenchidos.');

  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    await page.waitForTimeout(intervaloMs);
    let temCaptcha: boolean;
    try {
      temCaptcha = await page.locator(SELETOR_ELEKTRO.captcha).count() > 0;
    } catch {
      continue; // a página está navegando — olha de novo daqui a pouco
    }
    if (!temCaptcha) {
      await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => undefined);
      await respirar(page);
      return 'entrou';
    }
    // o formulário continua: o portal reclamou de alguma coisa?
    const erro = await erroVisivel(page);
    if (erro && /senha|usu[aá]rio|credencia|login inv/i.test(erro) && !/imagem|captcha|c[oó]digo/i.test(erro)) {
      throw new ErroLudmilla('login_recusado', `O Portal GD disse: "${erro}"`);
    }
    // CAPTCHA errado: o JSF redesenha o formulário vazio — preenche de novo e chama de novo
    const senhaAtual = await page.locator(SELETOR_ELEKTRO.senha).first().inputValue().catch(() => creds.senha);
    if (senhaAtual === '') {
      await preencher(page, creds);
      avisar('Ludmilla precisa de você', `${erro ? `O portal disse "${erro}". ` : ''}Digite o código da imagem de novo e clique em Entrar. E-mail e senha já estão preenchidos.`);
    }
  }
  throw new ErroLudmilla('sessao_expirada',
    `Ninguém digitou o código da imagem da Elektro em ${Math.round(timeoutMs / 60_000)} minutos. Na próxima visita a estação chama de novo.`);
}

/** HTML da página sem scripts nem estilos — o que interessa é a estrutura. */
async function htmlLimpo(page: Page): Promise<string> {
  const html = await page.content();
  return semSegredos(html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*>/gi, ''));
}

/** Itens de menu que levam a LISTAS (o que a Ludmilla lê) — nunca a formulários de pedido. */
const MENU_LISTA = /minhas solicita|solicita[çc][õo]es|meus projetos|projetos|consult|acompanh|lista|parecer/i;
const MENU_NUNCA = /\bnov[ao]\b|cadastr|criar|incluir|solicitar|enviar|excluir|cancelar|sair|logout/i;

/**
 * Descoberta logada: início, mapa do menu, a lista de solicitações e o
 * primeiro detalhe — HTML, print e o que a tela pediu ao servidor. É sobre
 * isto que o roteiro `varrer` da Elektro será escrito.
 */
export async function descobrirElektro(
  page: Page, creds: Credenciais, guardarTela: (t: TelaDescoberta) => Promise<void>, o: OpcoesElektro = {},
): Promise<Descoberta> {
  await entrarElektro(page, creds, o);
  const telas: Descoberta['telas'] = [];
  let rede: NonNullable<TelaDescoberta['rede']> = [];
  let api: { url: string; status: number; body: string }[] = [];
  page.on('response', async r => {
    const tipo = r.request().resourceType();
    if (tipo === 'xhr' || tipo === 'fetch' || tipo === 'document') rede.push({ url: semSegredos(r.url()), status: r.status(), tipo });
    // respostas parciais do PrimeFaces (XML) e JSON: é o que a tela consome
    const ct = r.headers()['content-type'] ?? '';
    if ((tipo === 'xhr' || tipo === 'fetch') && /xml|json/i.test(ct) && !r.url().includes('javax.faces.resource')) {
      const body = await r.text().catch(() => '');
      api.push({ url: semSegredos(r.url()), status: r.status(), body: body.slice(0, 400_000) });
    }
  });
  const guardar = async (nome: string) => {
    const tela: TelaDescoberta = {
      nome, url: semSegredos(page.url()), html: await htmlLimpo(page),
      png: await page.screenshot({ fullPage: true }).catch(() => undefined), rede,
      api: api.length > 0 ? api : undefined,
    };
    rede = []; api = [];
    telas.push(tela);
    await guardarTela(tela);
  };

  await guardar('01-inicio');

  // mapa do menu: todo link e botão de comando, com texto e destino
  const menu = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a, button, [role="menuitem"], .ui-menuitem-link, .ui-commandlink'))
      .map(el => ({
        texto: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: (el as HTMLAnchorElement).href ?? '',
        id: el.id ?? '',
        onclick: (el.getAttribute('onclick') ?? '').slice(0, 200),
      }))
      .filter(x => x.texto || x.href));
  const telaMenu: TelaDescoberta = { nome: '00-menu', url: 'menu', html: JSON.stringify(menu, null, 1) };
  telas.push(telaMenu);
  await guardarTela(telaMenu);

  // a lista: primeiro item do menu que fala de solicitações/projetos e não é ação
  const itens = page.locator('a, button, [role="menuitem"], .ui-menuitem-link, .ui-commandlink');
  const n = await itens.count();
  for (let i = 0; i < n; i++) {
    const item = itens.nth(i);
    const texto = (await item.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!MENU_LISTA.test(texto) || MENU_NUNCA.test(texto)) continue;
    await item.click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => undefined);
    await respirar(page);
    await guardar('02-lista');
    // tabela PrimeFaces: o primeiro link de uma linha leva ao detalhe
    const linha = page.locator('.ui-datatable tbody tr, table tbody tr').first();
    const link = linha.locator('a, button, .ui-commandlink').first();
    if (await link.count() > 0) {
      await link.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => undefined);
      await respirar(page);
      await guardar('03-detalhe');
    }
    break;
  }
  return { telas };
}

export const elektro: Conector = {
  chave: 'elektro',
  loginUrl: LOGIN_URL,

  async reconhecer(page: Page) {
    const resposta = await page.goto(this.loginUrl, { waitUntil: 'load', timeout: 60_000 });
    await respirar(page, 800);
    return reconhecerPagina(page, resposta?.status() ?? 0);
  },

  async testarLogin(page: Page, creds: Credenciais) {
    soNaEstacao();
    try {
      const r = await entrarElektro(page, creds);
      return {
        veredito: 'entrou',
        explicacao: r === 'sessao_mantida'
          ? 'O Chrome da estação ainda tinha a sessão: entrou sem pedir login.'
          : 'A pessoa digitou o código da imagem e o Portal GD abriu a área logada.',
        url_final: semSegredos(page.url()), titulo: (await page.title()).trim(),
      };
    } catch (e) {
      if (e instanceof ErroLudmilla && e.classe === 'login_recusado') {
        return { veredito: 'senha_recusada', explicacao: e.message, url_final: semSegredos(page.url()), titulo: (await page.title()).trim() };
      }
      throw e;
    }
  },

  async descobrir(page: Page, creds: Credenciais, guardarTela) {
    soNaEstacao();
    return descobrirElektro(page, creds, guardarTela);
  },

  async varrer() {
    throw new ErroLudmilla('pagina_mudou',
      'O roteiro de leitura da Elektro é escrito depois da descoberta logada do Portal GD (telas no bucket).');
  },
};

/** Na VPS não há ninguém para digitar o código: a Elektro é da estação local. */
function soNaEstacao() {
  if (modoAtual() !== 'local') {
    throw new ErroLudmilla('captcha_exigido',
      'O Portal GD da Elektro pede um código de imagem no login. Essa conta precisa estar no modo "estação local", onde uma pessoa digita o código.');
  }
}

import { ErroLudmilla } from '../erros.js';
import type { Credenciais } from '../fila.js';
import type { Agente } from './agente.js';
import { jsClicarTexto } from './js.js';
import { USER_AGENT_LUDMILLA } from './tipos.js';

/**
 * Entra na CPFL (Azure AD B2C) pelo cofre da CLI: a senha vai por stdin para
 * o `auth save`, o `auth login` preenche e envia, e a entrada do cofre é
 * apagada em seguida — a senha nunca aparece em argumento, log ou chat.
 *
 * Lições de 17/09/2026: a tela do B2C tem um `div.overlay` de carregamento
 * que cobre o botão por alguns segundos (o `auth login` clicava cedo demais e
 * falhava com "covered by <div.overlay>"), e o login vive em OUTRA origem
 * (cpflb2cprd.b2clogin.com) — por isso navegamos nós, esperamos o botão ficar
 * livre e chamamos `auth login --no-navigate --url <origem do B2C>`.
 *
 * Depois do login: "Selecionar perfil" → "Serviços para projetistas" →
 * gestao-projetos (mesmo caminho da varredura, que não muda).
 */

const LOGIN_URL = 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto';
/** O mesmo User-Agent do contexto Playwright da varredura (index.ts → novoContexto). */
const USER_AGENT = USER_AGENT_LUDMILLA;
const URL_MEUS_PROJETOS = 'https://www.cpfl.com.br/gestao-projetos/meus-projetos';
/**
 * Telas onde o cartão "Projetos Particulares / Serviços para projetistas"
 * pode estar, na ordem de tentativa:
 *  1. /Internet/Projeto — destino do redirect_uri do login; é onde a varredura
 *     (Playwright, funciona todo dia) encontra o cartão logo após entrar;
 *  2. Todos os serviços do integrador — link que a própria Agência oferece;
 *  3. Selecionar perfil — a tela do roteiro PDF (passo 2).
 */
const TELAS_DO_CARTAO = [
  'https://www.cpfl.com.br/Internet/Projeto',
  'https://www.cpfl.com.br/integrador/servicos/home',
  'https://www.cpfl.com.br/agencia/area-cliente/selecionar-perfil-instalacao',
];

/** O botão Entrar está na tela e nada o cobre? */
const JS_BOTAO_LIVRE = `(() => {
  const b = document.querySelector('#next'); if (!b) return 'sem-botao';
  const u = document.querySelector('#signInName'); if (!u) return 'sem-usuario';
  const r = b.getBoundingClientRect(); if (!r.width) return 'invisivel';
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return top && (top === b || b.contains(top)) ? 'livre' : 'coberto:' + (top ? (top.className || top.tagName) : '?');
})()`;

/** Mensagem de erro que o B2C mostra (senha errada, usuário não encontrado). */
const JS_ERRO_B2C = `(() => {
  const vis = e => e.getClientRects().length > 0;
  return Array.from(document.querySelectorAll('.error, [role="alert"], .alert, #errorMsg, .errorText'))
    .filter(vis).map(e => (e.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 200);
})()`;

export async function entrarNaCpfl(
  ag: Agente, creds: Credenciais, nomeCofre: string,
  log: (m: string, x?: Record<string, unknown>) => void,
  print: (nome: string) => Promise<void> = async () => undefined,
): Promise<void> {
  // A mesma cara do contexto da varredura (que entra todo dia): navegador
  // comum em português, 1366×768. Na VPS a CLI se apresentaria como Linux
  // headless — e a Agência não mostrava os cartões de perfil (18/09).
  await ag.abrir('about:blank');
  await ag.definirCabecalhos({ 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5' });
  await ag.definirViewport(1366, 768);
  await ag.abrir(LOGIN_URL);
  await ag.esperarCarga('load');

  // espera a tela de login de verdade, com o botão livre da overlay
  let estado = '';
  for (let i = 0; i < 20; i++) {
    estado = await ag.js<string>(JS_BOTAO_LIVRE).catch(() => 'erro');
    if (estado === 'livre') break;
    await ag.esperar(1_000);
  }
  if (estado !== 'livre') {
    throw new ErroLudmilla('pagina_mudou', `A tela de login da CPFL não ficou pronta (${estado}) — campos #signInName/#password/#next.`);
  }
  const origem = new URL(await ag.url()).origin + '/';

  await ag.authSalvar(nomeCofre, {
    url: LOGIN_URL, usuario: creds.login, senha: creds.senha,
    selUsuario: '#signInName', selSenha: '#password', selEnviar: '#next',
  });
  try {
    await ag.authEntrar(nomeCofre, { semNavegar: true, origem });
  } catch (e) {
    throw new ErroLudmilla('pagina_mudou', `A tela de login da CPFL não respondeu como o roteiro espera: ${(e as Error).message.slice(0, 200)}`);
  } finally {
    await ag.authApagar(nomeCofre);
  }

  // O B2C redireciona em cadeia (b2clogin → receive-token → site): o sinal é a URL sair do b2clogin.
  const ate = Date.now() + 60_000;
  let url = '';
  while (Date.now() < ate) {
    url = await ag.url();
    if (!/b2clogin\.com/i.test(url)) break;
    const erroB2c = await ag.js<string>(JS_ERRO_B2C).catch(() => '');
    if (erroB2c) throw new ErroLudmilla('login_recusado', `O portal da CPFL recusou o login: "${erroB2c}".`);
    await ag.esperar(1_500);
  }
  if (/b2clogin\.com/i.test(url)) {
    throw new ErroLudmilla('login_recusado', 'O portal da CPFL não saiu da tela de login — usuário ou senha recusados.');
  }
  // A cadeia continua no site (receive-token → /Internet/Projeto): espera
  // sair do receive-token e a página assentar antes de procurar o cartão.
  await esperarUrl(ag, /cpfl\.com\.br\/(?!b2c-auth)/i, 30);
  await ag.esperarCarga('networkidle');
  await ag.esperar(1_500);
  await fecharCookies(ag);
  log('depois do B2C', await ondeEstou(ag));
  await print('login-1-chegada');

  // O cartão Projetos Particulares (subtítulo "Serviços para projetistas") é o
  // que CRIA a sessão do app gestao-projetos; abrir meus-projetos direto dá
  // "Access denied" do Drupal (simulações de 18–20/09). A chegada do B2C nem
  // sempre é a tela do cartão — na VPS caiu em area-cliente/cadastro. Então
  // procuramos o cartão na página de chegada e, se não estiver, nas telas
  // conhecidas em ordem: /Internet/Projeto (destino do redirect_uri, onde a
  // varredura o encontra), Todos os serviços do integrador e Selecionar perfil.
  let clicou = await procurarCartao(ag, 6);
  if (!clicou) {
    for (const url of TELAS_DO_CARTAO) {
      log('procurando o cartão de perfil', { abrindo: url });
      await ag.abrir(url);
      await ag.esperarCarga('networkidle');
      await fecharCookies(ag);
      if (/gestao-projetos/.test(await ag.url())) { clicou = true; break; }
      clicou = await procurarCartao(ag, 8);
      if (clicou) break;
      log('sem o cartão nesta tela', { links: await ag.js(JS_LINKS_DO_MIOLO).catch(() => null), ...(await ondeEstou(ag)) });
      await print('login-2-perfil');
    }
  }
  if (clicou) {
    log('cartão de perfil acionado', await ondeEstou(ag));
    await esperarUrl(ag, /gestao-projetos/, 40);
  }
  if (!/gestao-projetos/.test(await ag.url())) {
    log('sem tela de perfil — abrindo meus-projetos', await ondeEstou(ag));
    await ag.abrir(URL_MEUS_PROJETOS);
    await ag.esperarCarga('networkidle');
    await ag.esperar(1_000);
    log('meus-projetos aberto', await ondeEstou(ag));
  }
  if (!/gestao-projetos/.test(await ag.url())) {
    throw new ErroLudmilla('pagina_mudou', 'Entrei na CPFL mas não cheguei ao portal de projetos (gestao-projetos).');
  }
  // prova de sessão no app de projetos: o menu "GERENCIE SEUS PROJETOS" (ou o link Sair) está na tela
  const autenticado = await ag.js<boolean>(JS_AUTENTICADO).catch(() => false);
  if (!autenticado) {
    throw new ErroLudmilla('pagina_mudou', `Cheguei em gestao-projetos mas a página não está autenticada ("${await ag.titulo()}") — o cartão "Serviços para projetistas" não foi acionado.`);
  }
  log('login na CPFL ok', { url: (await ag.url()).replace(/\?.*$/, '') });
}

/**
 * Procura o cartão de perfil na tela atual por N segundos (a Agência é React:
 * o miolo chega depois do HTML). Tenta o subtítulo do cartão e, em seguida,
 * qualquer link visível do miolo para gestao-projetos.
 */
async function procurarCartao(ag: Agente, segundos: number): Promise<boolean> {
  for (let i = 0; i < segundos; i++) {
    if (/gestao-projetos/.test(await ag.url())) return true;
    if (await ag.js<boolean>(jsClicarTexto('Serviços para projetistas')).catch(() => false)) return true;
    if (await ag.js<boolean>(JS_CLICAR_LINK_PROJETOS).catch(() => false)) return true;
    await ag.esperar(1_000);
  }
  return false;
}

/** Clica no primeiro link VISÍVEL fora do cabeçalho/rodapé que leva a gestao-projetos (é o que o cartão faz). */
const JS_CLICAR_LINK_PROJETOS = `(() => {
  const vis = e => e.getClientRects().length > 0;
  const foraDoMenu = e => !e.closest('header, footer, nav, [role="navigation"]');
  const a = Array.from(document.querySelectorAll('a[href*="gestao-projetos"]')).find(x => vis(x) && foraDoMenu(x));
  if (!a) return false; a.click(); return true;
})()`;

/** Links e botões do miolo da página (fora de cabeçalho/rodapé/menu) — o que a tela oferece. */
const JS_LINKS_DO_MIOLO = `(() => {
  const vis = e => e.getClientRects().length > 0;
  const foraDoMenu = e => !e.closest('header, footer, nav, [role="navigation"]');
  return Array.from(document.querySelectorAll('a, button')).filter(x => vis(x) && foraDoMenu(x))
    .map(x => ((x.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 50) || '(sem texto)') + (x.getAttribute('href') ? ' → ' + x.getAttribute('href').slice(0, 80) : ''))
    .slice(0, 30);
})()`;

/** Banner de cookies (OneTrust): "Rejeitar todos" em pt-BR, "Reject All" quando o Chrome está em inglês. */
async function fecharCookies(ag: Agente): Promise<void> {
  for (const texto of ['Rejeitar todos', 'Reject All']) {
    if (await ag.js<boolean>(jsClicarTexto(texto)).catch(() => false)) { await ag.esperar(600); return; }
  }
}

/** URL (sem query), título e começo do texto da página — para o log dizer onde o robô estava. */
async function ondeEstou(ag: Agente): Promise<Record<string, unknown>> {
  const url = (await ag.url().catch(() => '')).replace(/\?.*$/, '');
  const titulo = await ag.titulo().catch(() => '');
  const texto = await ag.js<string>(`(document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 240)`).catch(() => '');
  const navegador = await ag.js<string>(`navigator.userAgent + ' | webdriver=' + navigator.webdriver + ' | ' + navigator.language + ' | ' + innerWidth + 'x' + innerHeight`).catch(() => '');
  return { url, titulo, texto, navegador };
}

/** Espera a URL casar com o padrão (navegações em cadeia do portal). */
async function esperarUrl(ag: Agente, padrao: RegExp, segundos: number): Promise<boolean> {
  const ate = Date.now() + segundos * 1_000;
  while (Date.now() < ate) {
    if (padrao.test(await ag.url())) { await ag.esperarCarga('networkidle'); return true; }
    await ag.esperar(1_000);
  }
  return false;
}

const JS_AUTENTICADO = `(() => {
  const t = (document.body.textContent || '');
  if (/Access denied|Acesso negado/i.test(document.title)) return false;
  return /GERENCIE SEUS PROJETOS/i.test(t) || !!Array.from(document.querySelectorAll('a')).find(a => /^\\s*Sair\\s*$/i.test(a.textContent || ''));
})()`;

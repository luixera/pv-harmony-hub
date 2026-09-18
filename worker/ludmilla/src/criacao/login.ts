import { ErroLudmilla } from '../erros.js';
import type { Credenciais } from '../fila.js';
import type { Agente } from './agente.js';
import { jsClicarTexto } from './js.js';

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
const URL_MEUS_PROJETOS = 'https://www.cpfl.com.br/gestao-projetos/meus-projetos';

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

export async function entrarNaCpfl(ag: Agente, creds: Credenciais, nomeCofre: string, log: (m: string, x?: Record<string, unknown>) => void): Promise<void> {
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
  await ag.js<boolean>(jsClicarTexto('Rejeitar todos')).catch(() => false);
  log('depois do B2C', await ondeEstou(ag));

  // Tela "Selecionar perfil": o cartão Projetos Particulares (subtítulo
  // "Serviços para projetistas") é o que CRIA a sessão do app gestao-projetos.
  // Abrir meus-projetos direto, sem esse clique, dá uma sessão anônima e
  // "Access denied" em criar-projeto (simulação de 18/09). A tela pode
  // renderizar tarde: espera o cartão até 20 s, clica, e espera a navegação.
  let clicou = false;
  for (let i = 0; i < 20 && !clicou; i++) {
    if (/gestao-projetos/.test(await ag.url())) break;
    clicou = await ag.js<boolean>(jsClicarTexto('Serviços para projetistas')).catch(() => false);
    if (!clicou) await ag.esperar(1_000);
  }
  if (clicou) {
    log('perfil "Serviços para projetistas" escolhido');
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

/** URL (sem query), título e começo do texto da página — para o log dizer onde o robô estava. */
async function ondeEstou(ag: Agente): Promise<Record<string, unknown>> {
  const url = (await ag.url().catch(() => '')).replace(/\?.*$/, '');
  const titulo = await ag.titulo().catch(() => '');
  const texto = await ag.js<string>(`(document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 240)`).catch(() => '');
  return { url, titulo, texto };
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

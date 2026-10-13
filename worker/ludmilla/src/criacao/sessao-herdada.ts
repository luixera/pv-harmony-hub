import { chmodSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { logarNaCpfl } from '../conectores/cpfl.js';
import { ErroLudmilla } from '../erros.js';
import type { Credenciais } from '../fila.js';
import type { Agente } from './agente.js';
import { USER_AGENT_LUDMILLA } from './tipos.js';

/**
 * A CRIAÇÃO NÃO TEM MAIS LOGIN PRÓPRIO: ela herda a sessão da varredura.
 *
 * Por que: o login próprio (CLI agent-browser) falhou nas 4 tentativas entre
 * 18/09 e 12/10/2026, sempre no passo 0. O print guardado conta a história —
 * "Olá **Usuário**" e "Você não tem acesso a essa página": o B2C autenticava,
 * mas a seleção de perfil ("Serviços para projetistas" / "Projetos
 * Particulares") nunca acontecia, e sem ela o Drupal do `gestao-projetos` nega
 * tudo. Enquanto isso a VARREDURA entra no mesmo portal, com a mesma conta, na
 * mesma VPS, duas vezes por dia, sem falhar.
 *
 * Em vez de um segundo login que precisa acertar a mesma dança de novo, a
 * criação passa a usar o caminho comprovado: o Playwright de `logarNaCpfl`
 * (exatamente o mesmo código da varredura) entra, e os cookies resultantes são
 * injetados na sessão da CLI, que segue para o formulário 60.
 *
 * Cuidados que valem como regra:
 * - **O arquivo de cookies é credencial de sessão**: vai para o tmp com
 *   permissão 0600 e é apagado em `finally`, como o cofre do `auth`.
 * - **Mesmo User-Agent dos dois lados** (`USER_AGENT_LUDMILLA`): cookie herdado
 *   com navegador "diferente" é o tipo de detalhe que um portal usa para
 *   derrubar a sessão.
 * - Nada de senha passa pela CLI, nem por argumento nem por stdin.
 */

/** Entrada do portal: o B2C devolve em /Internet/Projeto, onde fica o cartão de perfil. */
export const LOGIN_URL = 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto';

/** Primeira tela do app de projetos — serve de prova de que a sessão valeu. */
export const URL_MEUS_PROJETOS = 'https://www.cpfl.com.br/gestao-projetos/meus-projetos';

/**
 * Prova de sessão DENTRO do app de projetos: o menu "GERENCIE SEUS PROJETOS"
 * ou o link "Sair". Sem isto, "Olá Usuário" + "Você não tem acesso a essa
 * página" passava por login bem-sucedido.
 */
export const JS_AUTENTICADO = `(() => {
  const t = (document.body.textContent || '');
  if (/Access denied|Acesso negado/i.test(document.title)) return false;
  return /GERENCIE SEUS PROJETOS/i.test(t) || !!Array.from(document.querySelectorAll('a')).find(a => /^\\s*Sair\\s*$/i.test(a.textContent || ''));
})()`;

/** O cookie como o Playwright entrega. */
export interface CookieDoNavegador {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/** Só o que é do portal (e do B2C que o autentica) — o resto não viaja. */
export function cookiesDoPortal(cookies: CookieDoNavegador[]): CookieDoNavegador[] {
  return cookies.filter(c =>
    !!c.name && !!c.value && /(^|\.)(cpfl\.com\.br|b2clogin\.com|cpflb2cprd\.[^.]+)$/i.test(c.domain.replace(/^\./, '')));
}

/**
 * JSON enxuto para a CLI: só os campos que ela conhece, e `expires` some quando
 * o cookie é de sessão (`-1`), que é como o Playwright marca "morre ao fechar".
 */
export function cookiesParaArquivo(cookies: CookieDoNavegador[]): string {
  return JSON.stringify(cookies.map(c => {
    const base: Record<string, unknown> = {
      name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
      httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: c.sameSite ?? 'Lax',
    };
    if (typeof c.expires === 'number' && c.expires > 0) base.expires = Math.floor(c.expires);
    return base;
  }));
}

const UM_MINUTO = 60_000;

/**
 * Entra na CPFL pelo Playwright (código da varredura) e passa a sessão para a
 * CLI. Devolve o que foi lido do portal para o log do run.
 */
export async function herdarSessaoDaVarredura(
  ag: Agente,
  creds: Credenciais,
  loginUrl: string,
  log: (msg: string, extra?: Record<string, unknown>) => void,
  print?: (nome: string) => Promise<void>,
): Promise<{ cookies: number; trazidos: number }> {
  let navegador: Browser | undefined;
  let contexto: BrowserContext | undefined;
  const arquivo = join(tmpdir(), `ludmilla-cookies-${process.pid}-${Date.now()}.json`);
  try {
    navegador = await chromium.launch({ headless: true });
    contexto = await navegador.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1366, height: 768 },
      userAgent: USER_AGENT_LUDMILLA,
    });
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(UM_MINUTO);
    // O MESMO login da varredura: se ele quebrar, quebra para os dois e a
    // correção é num lugar só.
    await logarNaCpfl(pagina, creds, loginUrl);
    log('login herdado da varredura', { url: pagina.url().replace(/\?.*$/, '') });

    const doPortal = cookiesDoPortal((await contexto.cookies()) as CookieDoNavegador[]);
    if (doPortal.length === 0) {
      throw new ErroLudmilla('sessao_expirada', 'Entrei na CPFL mas não veio cookie nenhum da sessão — nada para herdar.');
    }
    writeFileSync(arquivo, cookiesParaArquivo(doPortal), { mode: 0o600 });
    try { chmodSync(arquivo, 0o600); } catch { /* Windows ignora; na VPS vale */ }

    // A CLI precisa de uma página antes de receber cookies de domínio.
    await ag.definirCabecalhos({ 'Accept-Language': 'pt-BR,pt;q=0.9' }).catch(() => undefined);
    await ag.abrir('https://www.cpfl.com.br/');
    const dentro = await ag.cookiesDeArquivo(arquivo, doPortal);
    log('sessão passada para a CLI', { trazidos: doPortal.length, aceitos: dentro });
    await print?.('login-1-sessao-herdada');
    if (dentro === 0) {
      throw new ErroLudmilla('falhou',
        `Trouxe ${doPortal.length} cookies da varredura mas a CLI não ficou com nenhum `
        + '— nem pelo arquivo nem um a um. Sem sessão não adianta seguir.');
    }
    return { cookies: dentro, trazidos: doPortal.length };
  } finally {
    await unlink(arquivo).catch(() => undefined);
    await contexto?.close().catch(() => undefined);
    await navegador?.close().catch(() => undefined);
  }
}

/**
 * O passo 0 da criação, inteiro: entra pela varredura, passa a sessão para a
 * CLI e **prova** que ela chegou autenticada no `gestao-projetos` antes de
 * deixar o roteiro começar.
 *
 * A prova importa: foi a falta dela que deixou o robô seguir com uma sessão
 * meia-boca e descobrir o problema três telas depois.
 */
export async function entrarNaCpflPelaVarredura(
  ag: Agente,
  creds: Credenciais,
  log: (msg: string, extra?: Record<string, unknown>) => void,
  print?: (nome: string) => Promise<void>,
): Promise<void> {
  const { cookies, trazidos } = await herdarSessaoDaVarredura(ag, creds, LOGIN_URL, log, print);

  // Navegar pode falhar com ERR_HTTP_RESPONSE_CODE_FAILURE, que é como o Chrome
  // conta "o servidor respondeu erro (403) e não há página". Sem tratar, isso
  // chegava ao usuário como um erro de CLI sem significado nenhum.
  try {
    await ag.abrir(URL_MEUS_PROJETOS);
  } catch (e) {
    await print?.('login-2-recusado');
    const bruto = (e as Error).message;
    const recusado = /ERR_HTTP_RESPONSE_CODE_FAILURE|ERR_ABORTED|403/i.test(bruto);
    throw new ErroLudmilla('sessao_expirada',
      recusado
        ? `O portal RECUSOU a navegação para Meus Projetos (${cookies} de ${trazidos} cookies herdados chegaram à CLI). `
          + 'A sessão da varredura não vale neste navegador: o caminho é rodar a criação dentro do mesmo Playwright da varredura.'
        : `Não consegui abrir Meus Projetos depois de herdar a sessão: ${bruto.slice(0, 200)}`);
  }
  await ag.esperarCarga('networkidle');
  await ag.esperar(1_000);
  await print?.('login-2-portal');

  const url = await ag.url();
  if (!/gestao-projetos/.test(url)) {
    throw new ErroLudmilla('sessao_expirada',
      `Herdei a sessão da varredura (${cookies} de ${trazidos} cookies) mas a CLI não ficou em gestao-projetos (parou em ${url.replace(/\?.*$/, '')}).`);
  }
  const autenticado = await ag.js<boolean>(JS_AUTENTICADO).catch(() => false);
  if (!autenticado) {
    throw new ErroLudmilla('sessao_expirada',
      `Herdei ${cookies} de ${trazidos} cookies da varredura, mas o portal não reconheceu a sessão na CLI ("${await ag.titulo()}"). `
      + 'Se o portal passou a prender a sessão ao navegador, a criação precisa rodar no mesmo Playwright da varredura.');
  }
  log('sessão herdada reconhecida pelo portal', { cookies });
}

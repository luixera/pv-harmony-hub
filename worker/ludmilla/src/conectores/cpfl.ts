import type { Page } from 'playwright';
import type { Conector } from './index.js';
import type { Credenciais } from '../fila.js';
import { ErroLudmilla } from '../erros.js';
import { reconhecerPagina } from '../reconhecer.js';
import { vereditoDepoisDaSenha } from '../veredito.js';

/**
 * CPFL — "Projetos Particulares" (projetosparticulares.cpfl.com.br).
 *
 * Reconhecimento de 14/09/2026: o login é Azure AD B2C
 * (cpflb2cprd.b2clogin.com, política B2C_1A_SIGNUP_SIGNIN_MFA_FRONT), sem
 * CAPTCHA, campos `#signInName` (e-mail) e `#password`, botão `#next`.
 * "Meus Projetos" mora em `/Internet/Projeto` no site da CPFL.
 *
 * `varrer` ainda não existe: depende do que o teste de acesso mostrar
 * depois da senha (segundo fator ou não).
 */

/** Tela logada da CPFL: a URL do site com a área de projetos, ou o título. */
const SINAL_DE_ENTRADA = /cpfl\.com\.br\/Internet\/Projeto|Meus Projetos/i;

export const cpfl: Conector = {
  chave: 'cpfl',
  loginUrl: 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto',

  async reconhecer(page: Page) {
    const resposta = await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    return reconhecerPagina(page, resposta?.status() ?? 0);
  },

  async testarLogin(page: Page, creds: Credenciais) {
    await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 60_000 });

    // a tela precisa ser a que o reconhecimento viu; se mudou, para aqui
    const email = page.locator('#signInName');
    const senha = page.locator('#password');
    if (await email.count() === 0 || await senha.count() === 0) {
      throw new ErroLudmilla('pagina_mudou', 'A tela de login da CPFL não tem mais os campos #signInName/#password.');
    }

    await email.fill(creds.login);
    await senha.fill(creds.senha);
    // um humano leva um instante entre digitar e enviar
    await page.waitForTimeout(800);
    const botao = page.locator('#next, button[type="submit"]').first();
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined),
      botao.click(),
    ]);
    // o B2C redireciona em cadeia; dá um fôlego para a última página assentar
    await page.waitForTimeout(2_000);

    return vereditoDepoisDaSenha(page, SINAL_DE_ENTRADA);
  },

  async varrer() {
    throw new ErroLudmilla('pagina_mudou',
      'O roteiro de leitura da CPFL ainda não foi configurado — depende do resultado do teste de acesso.');
  },
};

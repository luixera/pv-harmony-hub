import type { Page } from 'playwright';
import type { Conector } from './index.js';
import { ErroLudmilla } from '../erros.js';
import { reconhecerPagina } from '../reconhecer.js';

/**
 * CPFL — "Projetos Particulares" (projetosparticulares.cpfl.com.br).
 *
 * Sabido de fora (set/2026): o acesso passa por um autenticador central,
 * `/cpfl-auth/redirect-arame`, e "Meus Projetos" mora em `/Internet/Projeto`.
 * O resto (campos, CAPTCHA, tabela) o reconhecimento e a descoberta logada
 * vão dizer — por isso `varrer` ainda não existe.
 */
export const cpfl: Conector = {
  chave: 'cpfl',
  loginUrl: 'https://www.cpfl.com.br/cpfl-auth/redirect-arame?redirect_uri=/Internet/Projeto',

  async reconhecer(page: Page) {
    const resposta = await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    return reconhecerPagina(page, resposta?.status() ?? 0);
  },

  async varrer() {
    throw new ErroLudmilla('pagina_mudou',
      'O roteiro da CPFL ainda não foi configurado — falta a descoberta logada da tela "Meus Projetos".');
  },
};

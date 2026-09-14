import type { Page } from 'playwright';
import type { Conector } from './index.js';
import { ErroLudmilla } from '../erros.js';
import { reconhecerPagina } from '../reconhecer.js';

/**
 * Elektro — "Portal GD" da Neoenergia (gdneoenergiaelektro.neoenergia.com).
 *
 * Sabido de fora (set/2026): devolveu 403 a um cliente que não é navegador.
 * Se o reconhecimento também vier bloqueado com um Chromium de verdade, a
 * abordagem para este portal precisa ser revista antes de qualquer roteiro.
 */
export const elektro: Conector = {
  chave: 'elektro',
  loginUrl: 'https://gdneoenergiaelektro.neoenergia.com/',

  async reconhecer(page: Page) {
    const resposta = await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    return reconhecerPagina(page, resposta?.status() ?? 0);
  },

  async testarLogin(page: Page) {
    // a tela de login nem chega a aparecer — o reconhecimento já explica
    const r = await this.reconhecer(page);
    if (r.bloqueado_por_waf) throw new ErroLudmilla('bloqueado_por_waf', 'O Portal GD da Neoenergia bloqueou o navegador antes da tela de login.');
    throw new ErroLudmilla('pagina_mudou', 'O roteiro de login da Elektro ainda não foi configurado.');
  },

  async varrer() {
    throw new ErroLudmilla('pagina_mudou',
      'O roteiro da Elektro ainda não foi configurado — falta a descoberta logada do Portal GD.');
  },
};

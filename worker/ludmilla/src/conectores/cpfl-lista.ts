import type { Page } from 'playwright';
import type { Protocolo } from './index.js';

/**
 * Leitura da lista "Meus projetos" da CPFL (Projetos Particulares).
 *
 * Estrutura vista na descoberta de 14/09/2026 — um app React:
 *   [data-accordion-component="AccordionItem"][data-status="Pendente"]
 *     cabeçalho: pares <span class="… font-bold">Rótulo</span><span>Valor</span>
 *                (Nome do projeto · Nota de serviço/Atividade · Serviço) + selo
 *     painel (hidden até expandir, mas JÁ no DOM): Data de criação ·
 *                Última atualização · Cidade · link "Ver projeto"
 *                → /gestao-projetos/meus-projetos/{atividade}
 *   paginação: <select id="page-size"> (10…200), "1 - 10 de 203",
 *              botões aria-label="Previous page"/"Next page"
 *
 * A ATIVIDADE (2º número da nota) é o id do projeto no portal e tem o mesmo
 * formato de 10 dígitos do `protocol_number` do cadastro — é ela que vira
 * `protocolo`.
 */

export interface CartaoCpfl extends Protocolo {
  notaServico: string;
}

export const SELETOR_CARTAO = '[data-accordion-component="AccordionItem"]';
export const SELETOR_SPINNER = '[class*="loading-spinner"]';

export async function lerCartoesCpfl(page: Page): Promise<CartaoCpfl[]> {
  const brutos = await page.evaluate((seletor) => {
    const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll(seletor)).map(el => {
      const pares: Record<string, string> = {};
      // todo rótulo em negrito é seguido pelo valor — vale no cabeçalho e no painel
      el.querySelectorAll('span.font-bold, span[class*="font-bold"]').forEach(rotulo => {
        const valor = rotulo.nextElementSibling;
        if (valor && valor.tagName === 'SPAN') pares[limpar(rotulo.textContent)] = limpar(valor.textContent);
      });
      const link = el.querySelector('a[href*="/meus-projetos/"]')?.getAttribute('href') ?? '';
      const selo = limpar(el.querySelector('[data-status] span')?.textContent);
      return { status: el.getAttribute('data-status') ?? selo, pares, link };
    });
  }, SELETOR_CARTAO);

  return brutos.map(b => {
    const nota = b.pares['Nota de serviço/Atividade'] ?? '';
    const [notaServico = '', atividade = ''] = nota.split('/').map(s => s.trim());
    // sem atividade na nota, o id do link "Ver projeto" resolve
    const doLink = /\/meus-projetos\/(\d+)/.exec(b.link)?.[1] ?? '';
    return {
      protocolo: atividade || doLink,
      notaServico,
      titular: b.pares['Nome do projeto'] ?? '',
      status: b.status,
      raw: { ...b.pares, link: b.link },
    };
  });
}

export interface PaginacaoCpfl {
  de: number;
  ate: number;
  total: number;
  temProxima: boolean;
}

export async function lerPaginacaoCpfl(page: Page): Promise<PaginacaoCpfl> {
  return page.evaluate(() => {
    const texto = document.body.innerText;
    const m = /(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/.exec(texto);
    const proximo = document.querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    return {
      de: m ? Number(m[1]) : 0,
      ate: m ? Number(m[2]) : 0,
      total: m ? Number(m[3]) : 0,
      temProxima: !!proximo && !proximo.disabled,
    };
  });
}

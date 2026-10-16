import { chromium, type Page, type Request, type Response } from 'playwright';
import type { Log } from './tupi.js';

/**
 * Leitura do mapa público da Tupi PELO NAVEGADOR — autorizada pelo usuário em
 * 16/10/2026, depois que a API passou a responder 403 (Cloudflare) para
 * qualquer cliente que não seja um navegador.
 *
 * O que acontece aqui é o que uma pessoa faz: abrir a página do mapa
 * (tupimob.com/mapa-da-rede-de-recarga, que embute o app `eletropostos-tupi.web.app`)
 * e esperar ela carregar. A página pede as estações à API por conta própria;
 * nós só lemos a resposta que ELA recebeu. Nenhuma chamada nossa à API,
 * nenhum cabeçalho forjado, nenhum contorno de bloqueio: se a página não
 * carregar, a coleta falha e fica registrada como falha.
 *
 * Visto em 16/10/2026 à tarde: a própria página falhava ("Failed to fetch",
 * CORS sobre o 403) — o mapa público estava quebrado para todo mundo. Nesse
 * caso a leitura falha RÁPIDO (pelo evento requestfailed), não pelo teto.
 */

// A página do site, não o app embutido direto: aberto sozinho o app não pede as
// estações (visto em 16/10/2026); embutido em tupimob.com, pede.
export const URL_MAPA = 'https://tupimob.com/mapa-da-rede-de-recarga/';
const TETO_MS = 60_000;
const ALVO = 'stationsShortVersion';

/** Resolve com a resposta da API que a página recebeu, ou rejeita assim que a página falhar ao pedi-la. */
function esperarEstacoes(pagina: Page): Promise<Response> {
  return new Promise((resolver, rejeitar) => {
    const aoResponder = (r: Response) => { if (r.url().includes(ALVO)) { limpar(); resolver(r); } };
    const aoFalhar = (r: Request) => {
      if (r.url().includes(ALVO)) { limpar(); rejeitar(new Error(`a própria página da Tupi não conseguiu buscar as estações (${r.failure()?.errorText ?? 'falha de rede'}; API bloqueada?)`)); }
    };
    const teto = setTimeout(() => { limpar(); rejeitar(new Error(`a página da Tupi não pediu as estações em ${TETO_MS / 1000} s`)); }, TETO_MS);
    const limpar = () => { clearTimeout(teto); pagina.off('response', aoResponder); pagina.off('requestfailed', aoFalhar); };
    pagina.on('response', aoResponder);
    pagina.on('requestfailed', aoFalhar);
  });
}

export async function lerMapaPeloNavegador(log: Log = () => undefined): Promise<unknown> {
  const t0 = Date.now();
  // headless shell: o Chromium completo cai com SIGTRAP sob o endurecimento do
  // systemd (lição da Ludmilla); a página não precisa de tela.
  const navegador = await chromium.launch({ headless: true });
  try {
    const contexto = await navegador.newContext({
      locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1280, height: 800 },
    });
    const pagina = await contexto.newPage();
    const resposta = esperarEstacoes(pagina);
    resposta.catch(() => undefined);   // a rejeição é tratada no await abaixo; sem isto vira "unhandled"
    await pagina.goto(URL_MAPA, { waitUntil: 'domcontentloaded', timeout: TETO_MS });
    const r = await resposta;
    if (!r.ok()) throw new Error(`mapa no navegador: a página recebeu HTTP ${r.status()} da API`);
    const dados: unknown = await r.json();
    log('mapa carregado no navegador', { ms: Date.now() - t0, estacoes_total: Array.isArray(dados) ? dados.length : null });
    return dados;
  } finally {
    await navegador.close().catch(() => undefined);
  }
}

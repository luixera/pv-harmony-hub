import type { BrowserContext, Page, Response } from 'playwright';

/**
 * O QUE O ROTEIRO PRECISA DE UM NAVEGADOR — e só isso.
 *
 * O roteiro do formulário 60 (369 linhas, validadas tela a tela em 17/09 e
 * conferidas de novo em 12/10) foi escrito contra a CLI `agent-browser`. Em
 * 13/10/2026 descobrimos que o portal RECUSA essa CLI a partir da VPS: a
 * navegação para `gestao-projetos` volta vazia (`ERR_HTTP_RESPONSE_CODE_FAILURE`)
 * mesmo com os 21 cookies da sessão da varredura dentro do navegador — e a
 * varredura, no mesmo IP e com a mesma conta, entra sem problema 2×/dia.
 *
 * Em vez de reescrever o roteiro, ele passou a falar com esta interface. A CLI
 * (`Agente`) a cumpre, e o `AgentePlaywright` abaixo também — assim a criação
 * roda dentro do MESMO navegador da varredura, que é o que o portal aceita.
 */
export interface Navegador {
  abrir(url: string): Promise<unknown>;
  clicar(seletor: string): Promise<unknown>;
  js<T = unknown>(codigo: string): Promise<T>;
  titulo(): Promise<string>;
  url(): Promise<string>;
  esperar(ms: number): Promise<unknown>;
  esperarCarga(estado?: 'load' | 'domcontentloaded' | 'networkidle'): Promise<unknown>;
  screenshot(caminho: string, inteira?: boolean): Promise<unknown>;
  limparRede(): Promise<unknown>;
  ultimoPostHtml(): Promise<string>;
  definirCabecalhos(cabecalhos: Record<string, string>): Promise<unknown>;
  fechar(): Promise<unknown>;
}

const MINUTO = 60_000;

/**
 * O mesmo navegador da varredura, vestido com a interface que o roteiro já
 * conhece. Cada método faz exatamente o que o seu par na CLI fazia — nem mais
 * (nada de auto-wait escondido que mascare tela errada), nem menos.
 */
export class AgentePlaywright implements Navegador {
  private readonly respostas: Response[] = [];

  private constructor(private readonly pagina: Page, private readonly fecharPagina: boolean) {
    // `ultimoPostHtml` existe para dizer QUAL campo o servidor recusou quando o
    // Avançar não avança: guardamos as respostas de documento vindas de POST.
    this.pagina.on('response', r => {
      if (r.request().method() === 'POST' && r.request().resourceType() === 'document') this.respostas.push(r);
    });
  }

  /** Abre uma aba no contexto da varredura (o contexto continua vivo depois). */
  static async noContexto(contexto: BrowserContext): Promise<AgentePlaywright> {
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(MINUTO);
    pagina.setDefaultNavigationTimeout(MINUTO);
    return new AgentePlaywright(pagina, true);
  }

  /** A página do run — para quem precisa do Playwright puro (login). */
  get page(): Page { return this.pagina; }

  async abrir(url: string): Promise<unknown> {
    await this.pagina.goto(url, { waitUntil: 'load', timeout: 2 * MINUTO });
    return {};
  }

  async clicar(seletor: string): Promise<unknown> {
    await this.pagina.locator(seletor).first().click({ timeout: MINUTO });
    return {};
  }

  /**
   * O código dos snippets (`js.ts`) é sempre uma IIFE síncrona que devolve
   * valor — `evaluate` aceita a expressão como string, do mesmo jeito que o
   * `eval --stdin` da CLI.
   */
  js<T = unknown>(codigo: string): Promise<T> {
    return this.pagina.evaluate(codigo) as Promise<T>;
  }

  async titulo(): Promise<string> { return this.pagina.title(); }
  async url(): Promise<string> { return this.pagina.url(); }
  async esperar(ms: number): Promise<unknown> { await this.pagina.waitForTimeout(ms); return {}; }

  async esperarCarga(estado: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<unknown> {
    // tolerante como na CLI: o portal é lento e nem sempre aquieta a rede
    await this.pagina.waitForLoadState(estado, { timeout: MINUTO }).catch(() => undefined);
    return {};
  }

  async screenshot(caminho: string, inteira = true): Promise<unknown> {
    await this.pagina.screenshot({ path: caminho, fullPage: inteira });
    return {};
  }

  async limparRede(): Promise<unknown> { this.respostas.length = 0; return {}; }

  async ultimoPostHtml(): Promise<string> {
    const ultima = this.respostas[this.respostas.length - 1];
    if (!ultima) return '';
    return ultima.text().catch(() => '');
  }

  async definirCabecalhos(cabecalhos: Record<string, string>): Promise<unknown> {
    await this.pagina.setExtraHTTPHeaders(cabecalhos).catch(() => undefined);
    return {};
  }

  async fechar(): Promise<unknown> {
    // fecha só a ABA: o contexto é da varredura e segue vivo para o próximo run
    if (this.fecharPagina) await this.pagina.close().catch(() => undefined);
    return {};
  }
}

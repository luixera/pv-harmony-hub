import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ErroLudmilla } from '../erros.js';

/**
 * Invólucro fino da CLI `agent-browser` (vercel-labs): cada método é um
 * comando, sempre com `--session` próprio e `--json`. Valores de campo NUNCA
 * vão por argumento (aspas, °, JS): entram por `eval --stdin`. A senha entra
 * pelo cofre da CLI via stdin (`auth save --password-stdin`).
 */

export interface OpcoesAgente {
  sessao: string;
  headed?: boolean;
  perfil?: string;
  /** caminho do Chrome/Chromium (VPS: headless shell do Playwright se o Chrome completo cair) */
  executavel?: string;
  /** argumentos extras do Chrome, separados por vírgula */
  argsChrome?: string;
  timeoutMs?: number;
}

interface Resposta { success: boolean; data: Record<string, unknown> | null; error: string | null }

/**
 * Executável da CLI, chamado SEM shell: com shell o cmd.exe engole as aspas
 * dos seletores (`a[href$="x"]` vira `a[href$=x]`). LUDMILLA_AB_BIN vence;
 * no Windows procura o binário nativo do pacote global; no Linux a CLI está
 * no PATH (`npm i -g agent-browser`).
 */
function resolverBinario(): string {
  if (process.env.LUDMILLA_AB_BIN) return process.env.LUDMILLA_AB_BIN;
  if (process.platform === 'win32') {
    const base = join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'agent-browser', 'bin');
    for (const nome of ['agent-browser-win32-x64.exe', 'agent-browser-win32-arm64.exe']) {
      const p = join(base, nome);
      if (existsSync(p)) return p;
    }
  }
  return 'agent-browser';
}
const BIN = resolverBinario();

export class Agente {
  constructor(private readonly o: OpcoesAgente) {}

  private base(): string[] {
    const a = ['--session', this.o.sessao, '--json'];
    if (this.o.headed) a.push('--headed');
    if (this.o.perfil) a.push('--profile', this.o.perfil);
    if (this.o.executavel) a.push('--executable-path', this.o.executavel);
    if (this.o.argsChrome) a.push('--args', this.o.argsChrome);
    return a;
  }

  /** Roda um comando e devolve `data`; `success:false` vira erro com a mensagem da CLI. */
  async cmd(args: string[], o: { stdin?: string; timeoutMs?: number; tolerar?: boolean } = {}): Promise<Record<string, unknown>> {
    const todos = [...this.base(), ...args];
    const saida = await new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const p = spawn(BIN, todos, { windowsHide: true });
      let out = ''; let err = '';
      const t = setTimeout(() => { p.kill(); reject(new Error(`agent-browser ${args[0]} demorou mais de ${o.timeoutMs ?? this.o.timeoutMs ?? 90_000} ms`)); }, o.timeoutMs ?? this.o.timeoutMs ?? 90_000);
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', e => { clearTimeout(t); reject(e); });
      p.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
      if (o.stdin !== undefined) p.stdin.end(o.stdin); else p.stdin.end();
    });
    const inicio = saida.out.indexOf('{');
    let r: Resposta | null = null;
    if (inicio >= 0) { try { r = JSON.parse(saida.out.slice(inicio)) as Resposta; } catch { r = null; } }
    if (!r) {
      if (o.tolerar) return {};
      throw new Error(`agent-browser ${args.join(' ').slice(0, 80)}: resposta inesperada (${(saida.err || saida.out).trim().slice(0, 200)})`);
    }
    if (!r.success) {
      if (o.tolerar) return {};
      throw new Error(`agent-browser ${args[0]} ${args[1] ?? ''}: ${r.error ?? 'falhou'}`);
    }
    return r.data ?? {};
  }

  abrir(url: string) { return this.cmd(['open', url], { timeoutMs: 120_000 }); }
  /** Cabeçalhos extras para a aba atual e as futuras (User-Agent, Accept-Language). */
  definirCabecalhos(cabecalhos: Record<string, string>) { return this.cmd(['set', 'headers', JSON.stringify(cabecalhos)], { tolerar: true }); }
  definirViewport(largura: number, altura: number) { return this.cmd(['set', 'viewport', String(largura), String(altura)], { tolerar: true }); }
  async titulo(): Promise<string> { return String((await this.cmd(['get', 'title'])).title ?? ''); }
  async url(): Promise<string> { return String((await this.cmd(['get', 'url'])).url ?? ''); }
  clicar(seletor: string) { return this.cmd(['click', seletor]); }
  marcar(seletor: string) { return this.cmd(['check', seletor]); }
  /** Só para texto simples e seguro (sem aspas/°): o resto vai por `setValor`. */
  preencher(seletor: string, valor: string) { return this.cmd(['fill', seletor, valor]); }
  esperarCarga(estado: 'load' | 'domcontentloaded' | 'networkidle' = 'load') { return this.cmd(['wait', '--load', estado], { tolerar: true, timeoutMs: 60_000 }); }
  esperar(ms: number) { return this.cmd(['wait', String(ms)], { tolerar: true }); }
  screenshot(caminho: string, inteira = true) { return this.cmd(inteira ? ['screenshot', '--full', caminho] : ['screenshot', caminho], { timeoutMs: 60_000 }); }
  fechar() { return this.cmd(['close'], { tolerar: true }); }

  /** Executa JS na página (REPL: a última expressão é o resultado). */
  async js<T = unknown>(codigo: string): Promise<T> {
    const d = await this.cmd(['eval', '--stdin'], { stdin: codigo });
    return d.result as T;
  }

  /** Cofre da CLI: a senha entra por stdin, nunca por argumento. */
  authSalvar(nome: string, c: { url: string; usuario: string; senha: string; selUsuario: string; selSenha: string; selEnviar: string }) {
    return this.cmd(['auth', 'save', nome, '--url', c.url, '--username', c.usuario, '--password-stdin',
      '--username-selector', c.selUsuario, '--password-selector', c.selSenha, '--submit-selector', c.selEnviar], { stdin: c.senha + '\n' });
  }
  /** `semNavegar` + `origem`: usa a página já aberta (o B2C redireciona para outra origem). */
  authEntrar(nome: string, o: { semNavegar?: boolean; origem?: string } = {}) {
    const args = ['auth', 'login', nome];
    if (o.semNavegar) args.push('--no-navigate');
    if (o.origem) args.push('--url', o.origem);
    return this.cmd(args, { timeoutMs: 120_000 });
  }
  authApagar(nome: string) { return this.cmd(['auth', 'delete', nome], { tolerar: true }); }

  /** Última resposta de documento POST (o HTML que o servidor devolveu ao Avançar). */
  async ultimoPostHtml(): Promise<string> {
    const lista = await this.cmd(['network', 'requests', '--type', 'document', '--method', 'POST'], { tolerar: true });
    const reqs = (lista.requests ?? lista) as { requestId?: string }[] | undefined;
    const ultimo = Array.isArray(reqs) && reqs.length ? reqs[reqs.length - 1] : null;
    if (!ultimo?.requestId) return '';
    const det = await this.cmd(['network', 'request', ultimo.requestId], { tolerar: true });
    return String(det.responseBody ?? '');
  }
  limparRede() { return this.cmd(['network', 'requests', '--clear'], { tolerar: true }); }
}

/** Erro de navegador (CLI não abriu / travou) classificado para a conta ficar em paz. */
export const erroDeNavegador = (e: unknown) =>
  new ErroLudmilla('falhou', `O navegador da Ludmilla não respondeu: ${(e as Error).message.split('\n')[0].slice(0, 200)}`);

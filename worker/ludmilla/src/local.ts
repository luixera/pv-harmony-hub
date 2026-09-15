import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * MODO LOCAL — o robô numa máquina de pessoa (a estação do coworking).
 *
 * Existe por causa da Elektro: o Portal GD só abre para um Chrome de verdade
 * em IP de pessoa e tem CAPTCHA no login. Nessa máquina não há service role:
 * a estação entra no GD Manager com um usuário staff dedicado (o "operador
 * local" da conta), e usa as RPCs "_local", que só ele pode chamar.
 *
 * Tudo que é específico da estação mora aqui: modo, nomes de RPC, sessão em
 * arquivo, pasta do perfil do Chrome e o aviso na tela.
 */

export type Modo = 'vps' | 'local';

export function modoAtual(): Modo {
  return (process.env.LUDMILLA_MODO ?? '').trim().toLowerCase() === 'local' ? 'local' : 'vps';
}

/** `ludmilla_claim_run` → `ludmilla_claim_run_local` no modo local. */
export function nomeRpc(base: string): string {
  return modoAtual() === 'local' ? `${base}_local` : base;
}

/** Pasta da estação (%LOCALAPPDATA%\Ludmilla no Windows; LUDMILLA_DIR manda). */
export function dirEstacao(): string {
  const base = process.env.LUDMILLA_DIR
    ?? join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '.', 'Ludmilla');
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

export const caminhoSessao = () => join(dirEstacao(), 'sessao.json');
export const dirPerfilChrome = (conector: string) => join(dirEstacao(), `chrome-${conector}`);

/** Linhas `CHAVE=valor` (com ou sem aspas, com ou sem `export`); `#` é comentário. */
export function lerEnv(texto: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const linhaCrua of texto.split(/\r?\n/)) {
    const linha = linhaCrua.trim();
    if (!linha || linha.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha);
    if (!m) continue;
    let valor = m[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    env[m[1]] = valor;
  }
  return env;
}

/**
 * `%LOCALAPPDATA%\Ludmilla\env` — SUPABASE_URL e SUPABASE_ANON_KEY da estação
 * (valores públicos; segredo nenhum). O que já veio do ambiente vence.
 * Devolve quantas variáveis entraram.
 */
export function carregarEnvDaEstacao(): number {
  const caminho = join(dirEstacao(), 'env');
  if (!existsSync(caminho)) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(lerEnv(readFileSync(caminho, 'utf8')))) {
    if (process.env[k] === undefined) { process.env[k] = v; n++; }
  }
  return n;
}

/**
 * Primeira vez na estação: pergunta e-mail e senha do usuário operador no
 * terminal (senha sem eco). Com entrada canalizada (instalador), lê as duas
 * linhas. A senha vai direto para o Supabase Auth e não é gravada em lugar
 * nenhum — só a sessão resultante.
 */
export async function pedirLoginNoTerminal(): Promise<{ email: string; senha: string }> {
  const tty = process.stdin.isTTY === true;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  try {
    if (!tty) {
      // entrada canalizada chega inteira de uma vez: o iterador guarda as linhas
      // (com `question` a segunda linha se perderia enquanto a primeira resolve)
      const linhas = rl[Symbol.asyncIterator]();
      const proxima = async () => String((await linhas.next()).value ?? '');
      process.stdout.write('E-mail do usuário da estação no GD Manager: ');
      const email = (await proxima()).trim();
      process.stdout.write('\n');
      return { email, senha: await proxima() };
    }
    const perguntar = (p: string) => new Promise<string>(r => rl.question(p, r));
    const email = (await perguntar('E-mail do usuário da estação no GD Manager: ')).trim();
    process.stdout.write('Senha: ');
    const interno = rl as unknown as { _writeToOutput?: (s: string) => void };
    const original = interno._writeToOutput;
    interno._writeToOutput = () => { /* sem eco enquanto digita a senha */ };
    const senha = await perguntar('');
    interno._writeToOutput = original;
    process.stdout.write('\n');
    return { email, senha };
  } finally {
    rl.close();
  }
}

export interface SessaoGuardada {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function carregarSessao(): SessaoGuardada | null {
  try {
    const s = JSON.parse(readFileSync(caminhoSessao(), 'utf8')) as SessaoGuardada;
    return s.refresh_token ? s : null;
  } catch {
    return null;
  }
}

export function guardarSessao(s: SessaoGuardada): void {
  writeFileSync(caminhoSessao(), JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at,
  }), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Aviso na tela da estação (balão do Windows). É como a Ludmilla chama a
 * pessoa para digitar o CAPTCHA. Fora do Windows, só registra no log.
 */
export function avisar(titulo: string, texto: string): void {
  if (process.platform !== 'win32') { console.log(`[aviso] ${titulo}: ${texto}`); return; }
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$n = New-Object System.Windows.Forms.NotifyIcon',
    '$n.Icon = [System.Drawing.SystemIcons]::Information',
    '$n.Visible = $true',
    `$n.ShowBalloonTip(15000, '${titulo.replace(/'/g, "''")}', '${texto.replace(/'/g, "''")}', [System.Windows.Forms.ToolTipIcon]::Info)`,
    'Start-Sleep -Seconds 16',
    '$n.Dispose()',
  ].join('; ');
  try {
    const p = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { detached: true, stdio: 'ignore' });
    p.unref();
  } catch { /* sem aviso é melhor do que sem run */ }
}

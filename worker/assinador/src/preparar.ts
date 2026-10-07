import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { PDFDocument } from 'pdf-lib';

/** O que o LibreOffice headless dá conta de virar PDF neste fluxo. */
const CONVERSIVEIS = new Set(['.xlsx', '.xls', '.docx', '.doc', '.odt', '.ods']);

/** Onde procurar o LibreOffice (ordem de preferência). */
const CANDIDATOS_SOFFICE = ['/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice'];

const LIMITE_MS = 120_000;

/**
 * Um PDF de verdade, mesmo de uma página só, passa de alguns KB. Abaixo disso é
 * arquivo vazio ou truncado. É só a primeira peneira — a validação que importa
 * é abrir com o pdf-lib e contar páginas.
 */
const TAMANHO_MINIMO_PDF = 1000;

/** O `%%EOF` precisa estar nesta janela final: sem ele o arquivo foi cortado no meio. */
const JANELA_EOF = 1024;

/** Quanto do stderr/stdout do LibreOffice guardamos para o log. */
const LIMITE_SAIDA = 8 * 1024;

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
}

/**
 * Decide se o documento precisa passar pelo LibreOffice. A extensão manda; o MIME
 * só desempata quando a extensão não diz nada (o MIME de upload pode mentir).
 */
export function precisaConverter(nome: string, mime: string | null): boolean {
  const { ext: extensao } = parse(nome.toLowerCase());
  if (extensao === '.pdf') return false;
  if (CONVERSIVEIS.has(extensao)) return true;
  if ((mime ?? '').toLowerCase() === 'application/pdf') return false;
  return true; // converterParaPdf recusa o que não souber, com mensagem clara
}

/** Caminho do LibreOffice, resolvido num lugar só: quem testa e quem executa usam o mesmo. */
export function caminhoDoSoffice(): string | null {
  return CANDIDATOS_SOFFICE.find(c => existsSync(c)) ?? null;
}

export function temSoffice(): boolean {
  return caminhoDoSoffice() !== null;
}

interface ResultadoSoffice {
  codigo: number | null;
  estouroDeTempo: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Roda o soffice e, se passar do tempo, mata o GRUPO de processos. No Linux
 * `/usr/bin/soffice` é um script que dispara o `oosplash`, que sobe o
 * `soffice.bin`: matar só o processo que iniciamos deixa o `soffice.bin` vivo,
 * e conversões travadas repetidas esgotam a RAM da VPS. Por isso `detached`
 * (o filho vira líder de grupo) e `kill(-pid)`.
 */
function rodarSoffice(binario: string, args: string[]): Promise<ResultadoSoffice> {
  return new Promise((resolvePromessa, rejeitar) => {
    const filho = spawn(binario, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    conversaoEmCurso = filho;
    let stdout = '';
    let stderr = '';
    let encerrado = false;

    const encerrar = (r: ResultadoSoffice) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(relogio);
      if (conversaoEmCurso === filho) conversaoEmCurso = null;
      resolvePromessa(r);
    };

    filho.stdout?.on('data', d => { if (stdout.length < LIMITE_SAIDA) stdout += d.toString(); });
    filho.stderr?.on('data', d => { if (stderr.length < LIMITE_SAIDA) stderr += d.toString(); });

    const relogio = setTimeout(() => {
      matarGrupo(filho);
      encerrar({ codigo: null, estouroDeTempo: true, stdout, stderr });
    }, LIMITE_MS);

    filho.on('error', err => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(relogio);
      if (conversaoEmCurso === filho) conversaoEmCurso = null;
      rejeitar(err);
    });
    filho.on('close', codigo => encerrar({ codigo, estouroDeTempo: false, stdout, stderr }));
  });
}

/** A conversão em andamento (no máximo uma: o laço é serial). */
let conversaoEmCurso: ChildProcess | null = null;

function matarGrupo(filho: ChildProcess): void {
  try {
    if (filho.pid === undefined) throw new Error('sem pid');
    process.kill(-filho.pid, 'SIGKILL');
  } catch {
    // Sem grupo (ex.: Windows) ou o grupo já morreu: derruba só o processo.
    try { filho.kill('SIGKILL'); } catch { /* já morreu */ }
  }
}

/**
 * Para o worker (SIGTERM/SIGINT): como o soffice roda em grupo próprio, ele
 * SOBREVIVE à morte do worker. Quem encerra o worker chama isto antes. O kill
 * faz o `close` disparar, a conversão rejeita e o `finally` apaga a pasta
 * temporária. Devolve `true` se havia conversão para cancelar.
 */
export function encerrarConversaoEmCurso(): boolean {
  if (!conversaoEmCurso) return false;
  matarGrupo(conversaoEmCurso);
  return true;
}

function mensagemArquivoRuim(nomeOriginal: string): string {
  return `Não consegui converter "${nomeOriginal}" para PDF. O arquivo pode estar corrompido, protegido por senha ou em formato antigo. Abra no Excel/Word, salve de novo, ou exporte para PDF e suba o PDF.`;
}

/** PDF só vale se abre no pdf-lib, tem página e termina como PDF (não foi cortado). */
async function validarPdf(pdf: Buffer, nomeOriginal: string): Promise<void> {
  const cauda = pdf.subarray(Math.max(0, pdf.length - JANELA_EOF)).toString('latin1');
  if (pdf.length < TAMANHO_MINIMO_PDF || pdf.subarray(0, 5).toString() !== '%PDF-' || !cauda.includes('%%EOF')) {
    log('assinador.converter.pdf_invalido', { arquivo: nomeOriginal, bytes: pdf.length, motivo: 'cabecalho_ou_eof' });
    throw new Error(mensagemArquivoRuim(nomeOriginal));
  }
  try {
    const paginas = (await PDFDocument.load(pdf)).getPageCount();
    if (paginas < 1) throw new Error('PDF sem páginas');
  } catch (err) {
    log('assinador.converter.pdf_invalido', { arquivo: nomeOriginal, bytes: pdf.length, motivo: 'pdflib', erro: String(err) });
    throw new Error(mensagemArquivoRuim(nomeOriginal));
  }
}

/**
 * Converte para PDF com o LibreOffice headless. Roda numa pasta temporária
 * própria (`-env:UserInstallation`), senão duas conversões simultâneas brigam
 * pelo mesmo perfil e uma delas devolve PDF vazio.
 */
export async function converterParaPdf(bytes: Buffer, nomeOriginal: string): Promise<Buffer> {
  const { ext: extensao } = parse(nomeOriginal.toLowerCase());
  if (!CONVERSIVEIS.has(extensao)) {
    throw new Error(`Não sei converter "${extensao || 'sem extensão'}" para PDF. Suba o documento já em PDF.`);
  }
  const binario = caminhoDoSoffice();
  if (binario === null) {
    log('assinador.converter.sem_soffice', { arquivo: nomeOriginal });
    throw new Error('O LibreOffice não está instalado nesta máquina — a conversão só funciona no servidor.');
  }

  const pasta = await mkdtemp(join(tmpdir(), 'gdm-assinador-'));
  try {
    const entrada = join(pasta, `entrada${extensao}`);
    await writeFile(entrada, bytes);

    let resultado: ResultadoSoffice;
    try {
      resultado = await rodarSoffice(binario, [
        `-env:UserInstallation=file://${join(pasta, 'perfil')}`,
        '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', pasta, entrada,
      ]);
    } catch (err) {
      const codigo = (err as NodeJS.ErrnoException).code;
      log('assinador.converter.falha_ao_iniciar', { arquivo: nomeOriginal, codigo, erro: String(err) });
      if (codigo === 'ENOENT') {
        throw new Error('O LibreOffice não está instalado nesta máquina — a conversão só funciona no servidor.');
      }
      throw new Error(mensagemArquivoRuim(nomeOriginal));
    }

    // O stderr do LibreOffice só aparece no log, nunca na mensagem do usuário.
    if (resultado.stderr.trim() || resultado.codigo !== 0 || resultado.estouroDeTempo) {
      log('assinador.converter.saida_soffice', {
        arquivo: nomeOriginal, codigo: resultado.codigo, estouroDeTempo: resultado.estouroDeTempo,
        stderr: resultado.stderr.trim(), stdout: resultado.stdout.trim(),
      });
    }
    if (resultado.estouroDeTempo) {
      throw new Error('A conversão passou de 2 minutos e foi interrompida. O arquivo pode ser muito grande ou estar corrompido.');
    }
    if (resultado.codigo !== 0) throw new Error(mensagemArquivoRuim(nomeOriginal));

    const saida = join(pasta, 'entrada.pdf');
    if (!existsSync(saida)) throw new Error(mensagemArquivoRuim(nomeOriginal));
    const pdf = await readFile(saida);
    await validarPdf(pdf, nomeOriginal);
    return pdf;
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

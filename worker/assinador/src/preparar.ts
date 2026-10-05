import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { promisify } from 'node:util';

const executar = promisify(execFile);

/** O que o LibreOffice headless dá conta de virar PDF neste fluxo. */
const CONVERSIVEIS = new Set(['.xlsx', '.xls', '.docx', '.doc', '.odt', '.ods', '.csv']);

export function precisaConverter(nome: string, mime: string | null): boolean {
  if ((mime ?? '').toLowerCase() === 'application/pdf') return false;
  return parse(nome.toLowerCase()).ext !== '.pdf';
}

export function temSoffice(): boolean {
  const caminhos = ['/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice'];
  return caminhos.some(c => existsSync(c));
}

/**
 * Converte para PDF com o LibreOffice headless. Roda numa pasta temporária
 * própria (`-env:UserInstallation`), senão duas conversões simultâneas brigam
 * pelo mesmo perfil e uma delas devolve PDF vazio.
 */
export async function converterParaPdf(bytes: Buffer, nomeOriginal: string): Promise<Buffer> {
  const { ext, name } = parse(nomeOriginal.toLowerCase());
  if (!CONVERSIVEIS.has(ext)) {
    throw new Error(`Não sei converter "${ext || 'sem extensão'}" para PDF. Suba o documento já em PDF.`);
  }
  const pasta = await mkdtemp(join(tmpdir(), 'gdm-assinador-'));
  try {
    const entrada = join(pasta, `entrada${ext}`);
    await writeFile(entrada, bytes);
    await executar('soffice', [
      `-env:UserInstallation=file://${join(pasta, 'perfil')}`,
      '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', pasta, entrada,
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

    const saida = join(pasta, 'entrada.pdf');
    if (!existsSync(saida)) throw new Error('O LibreOffice não produziu o PDF.');
    const pdf = await readFile(saida);
    if (pdf.length < 1000 || pdf.subarray(0, 5).toString() !== '%PDF-') {
      throw new Error(`A conversão de "${name}${ext}" saiu vazia ou ilegível.`);
    }
    return pdf;
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

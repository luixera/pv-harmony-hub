import { createWriteStream } from 'node:fs';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { lerDisco } from '../disco.js';

const exec = promisify(execFile);

/** A ANEEL publica a BDGD como item "File Geodatabase" no ArcGIS. */
const BUSCA = 'https://www.arcgis.com/sharing/rest/search';
const DADOS = (id: string) => `https://www.arcgis.com/sharing/rest/content/items/${id}/data`;

/** Medido em 13/10/2026: 0,41 GB de zip viraram 2,2 GB extraídos. */
const INFLACAO = 5.3;
const FOLGA = 1.3;

export interface ItemBdgd {
  id: string;
  titulo: string;
  sigla: string;
  codigoAneel: string;
  dataBase: string;
  bytesZip: number;
}

/**
 * `CPFL_Piratininga_2937_2025-12-31_V11_20260823-1826` →
 * sigla `CPFL_Piratininga`, código ANEEL `2937`, data-base `2025-12-31`.
 * A sigla pode ter underscore no meio (`Energisa_Minas_Rio`), então ancoramos
 * no código numérico seguido da data, não na contagem de partes.
 */
export function interpretarTitulo(titulo: string): Omit<ItemBdgd, 'id' | 'bytesZip'> | null {
  const m = /^(.+)_(\d+)_(\d{4}-\d{2}-\d{2})_V\d+_/.exec(titulo);
  if (!m) return null;
  return { titulo, sigla: m[1], codigoAneel: m[2], dataBase: m[3] };
}

/**
 * Zip e extraído coexistem em disco, então o guard-rail soma os dois.
 * Reprovar ANTES de baixar é o ponto: um "no space left on device" no meio da
 * extração deixa lixo de gigabytes e nenhum diagnóstico.
 */
export function cabeNoDisco(livreBytes: number, bytesZip: number): { cabe: boolean; precisaBytes: number } {
  const precisaBytes = Math.ceil((bytesZip + bytesZip * INFLACAO) * FOLGA);
  return { cabe: livreBytes >= precisaBytes, precisaBytes };
}

export async function acharItem(sigla: string): Promise<ItemBdgd> {
  const url = new URL(BUSCA);
  url.searchParams.set('q', `${sigla} BDGD`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('num', '50');
  url.searchParams.set('sortField', 'modified');
  url.searchParams.set('sortOrder', 'desc');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Busca no ArcGIS falhou: HTTP ${r.status}`);
  const corpo = await r.json() as { results?: { id: string; title: string; type: string }[] };

  const candidatos = (corpo.results ?? [])
    .filter(x => x.type === 'File Geodatabase')
    .map(x => ({ item: x, meta: interpretarTitulo(x.title) }))
    .filter((x): x is { item: { id: string; title: string; type: string }; meta: NonNullable<ReturnType<typeof interpretarTitulo>> } =>
      x.meta !== null && x.meta.sigla.toLowerCase() === sigla.toLowerCase());

  if (candidatos.length === 0) throw new Error(`Nenhuma BDGD encontrada para "${sigla}".`);
  // A mais recente por data-base; o ArcGIS já devolveu ordenado por modified.
  candidatos.sort((a, b) => b.meta.dataBase.localeCompare(a.meta.dataBase));
  const { item, meta } = candidatos[0];

  // O tamanho não vem na busca; o HEAD do download traz.
  const h = await fetch(DADOS(item.id), { method: 'HEAD', redirect: 'follow' });
  const bytesZip = Number(h.headers.get('content-length') ?? 0);
  if (!bytesZip) throw new Error(`Nao consegui medir o zip de ${item.title} antes de baixar.`);

  return { id: item.id, bytesZip, ...meta };
}

/** Devolve o caminho do `.gdb` extraído. Derruba o zip depois de extrair. */
export async function baixarEExtrair(item: ItemBdgd, dir: string): Promise<string> {
  const disco = await lerDisco('/');
  const g = cabeNoDisco(disco.livreBytes, item.bytesZip);
  if (!g.cabe) {
    throw new Error(
      `Disco insuficiente para ${item.sigla}: livre ${(disco.livreBytes / 1024 ** 3).toFixed(1)} GB, ` +
      `preciso de ${(g.precisaBytes / 1024 ** 3).toFixed(1)} GB (zip + extraido + folga).`);
  }

  await mkdir(dir, { recursive: true });
  const zip = join(dir, `${item.sigla}.zip`);

  const r = await fetch(DADOS(item.id), { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Download de ${item.titulo} falhou: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(zip));

  await exec('unzip', ['-q', '-o', zip, '-d', dir], { maxBuffer: 1 << 24 });
  await rm(zip, { force: true });   // o extraído basta; o zip é 5,3x menor mas ainda é 1 GB

  const achados = (await readdir(dir)).filter(n => n.endsWith('.gdb'));
  if (achados.length !== 1) {
    throw new Error(`Esperava um .gdb em ${dir}, achei ${achados.length}: ${achados.join(', ')}`);
  }
  return join(dir, achados[0]);
}

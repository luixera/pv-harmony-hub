import { supabase } from '../fila.js';

/**
 * Dos CSVs do ogr2ogr para as tabelas de staging.
 *
 * Volume real: ~53 mil trafos, 553 alimentadores, 139 subestações — ~6 MB na
 * Piratininga. É por isso que não há `COPY` nem driver Postgres aqui: os 2
 * milhões de UCs foram agregados pelo ogr2ogr e nunca entram no banco.
 */

export interface LinhaTrafo {
  codigo: string;
  alimentador_codigo: string | null;
  potencia_nominal_kva: number | null;
  fases: number | null;
  tensao_secundaria_v: number | null;
  carga_min_diurna_kw: number | null;
  gd_conectada_kw: number | null;
  lng: number;
  lat: number;
}

/** CSV do ogr2ogr: vírgula, aspas duplas, `""` para aspas literal. */
export function lerCsv(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = '', atual: string[] = [], dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentro) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else dentro = false;
      } else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === ',') { atual.push(campo); campo = ''; }
    else if (c === '\n') { atual.push(campo); linhas.push(atual); atual = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || atual.length > 0) { atual.push(campo); linhas.push(atual); }
  if (linhas.length === 0) return [];
  const [cab, ...resto] = linhas;
  return resto
    .filter(l => l.length === cab.length)
    .map(l => Object.fromEntries(cab.map((k, i) => [k, l[i]])));
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `ABCN` = três fases mais neutro: o N não conta. */
export function fasesDe(fasCon: string): number | null {
  const n = (fasCon.match(/[ABC]/g) ?? []).length;
  return n >= 1 && n <= 3 ? n : null;
}

export function pontoDeWkt(wkt: string): { lng: number; lat: number } | null {
  const m = /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(wkt.trim());
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
}

const duasCasas = (n: number | null): number | null =>
  n === null ? null : Math.round(n * 100) / 100;

export function montarTrafos(
  trafos: Record<string, string>[],
  carga: Record<string, string>[],
  gd: Record<string, string>[],
): LinhaTrafo[] {
  const porCarga = new Map(carga.map(c => [c.trafo, num(c.carga_min_diurna_kw)]));
  const porGd = new Map(gd.map(g => [g.trafo, num(g.gd_kw)]));

  const saida: LinhaTrafo[] = [];
  const descartados: string[] = [];
  for (const t of trafos) {
    if (t.SIT_ATIV !== 'AT') continue;          // desativado na BDGD não entra
    const p = pontoDeWkt(t.Shape ?? '');
    if (!p) { descartados.push(t.COD_ID); continue; }
    const tenKv = num(t.TEN_LIN_SE);
    saida.push({
      codigo: t.COD_ID,
      alimentador_codigo: t.CTMT || null,
      potencia_nominal_kva: num(t.POT_NOM),
      fases: fasesDe(t.FAS_CON_P ?? ''),
      tensao_secundaria_v: tenKv === null ? null : duasCasas(tenKv * 1000),
      // nulo = "nao sei"; zero diria "sei que e zero". Sao coisas diferentes.
      carga_min_diurna_kw: duasCasas(porCarga.get(t.COD_ID) ?? null),
      // GD ausente E zero de verdade: ninguem conectou nada neste trafo.
      gd_conectada_kw: duasCasas(porGd.get(t.COD_ID) ?? 0),
      lng: p.lng, lat: p.lat,
    });
  }
  // Abortar 6,5 GB de ingestão por uma linha torta é pior que seguir sem ela.
  // Mas descarte em massa é defeito de dado, e aí parar é o certo: na
  // Piratininga o número real é ZERO (medido em 13/10/2026).
  if (descartados.length > 0) {
    const pct = descartados.length / trafos.length * 100;
    const amostra = descartados.slice(0, 5).join(', ');
    if (pct > 1) {
      throw new Error(
        `${descartados.length} trafos (${pct.toFixed(2)}%) sem geometria utilizavel: ${amostra}...`);
    }
    console.warn(`[bdgd] ${descartados.length} trafos sem geometria, descartados: ${amostra}`);
  }
  return saida;
}

/**
 * Lotes de 2000: ~27 requisições para a Piratininga. Cada `insert` é aguardado,
 * porque `supabase-js` é lazy e um builder sem `await` nunca sai do lugar.
 */
export async function enviarEmLotes<T>(tabela: string, linhas: T[], tamanho = 2000): Promise<number> {
  let enviadas = 0;
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const { error } = await supabase().from(tabela).insert(lote as never);
    if (error) throw new Error(`Lote ${i / tamanho + 1} de ${tabela} falhou: ${error.message}`);
    enviadas += lote.length;
  }
  return enviadas;
}

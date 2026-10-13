import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gerarCaseSql, type Curva } from './curvas.js';

const exec = promisify(execFile);

/**
 * Extração das camadas da BDGD com `ogr2ogr`, dialeto SQLite.
 *
 * REGRA QUE NÃO SE NEGOCIA: nada de `JOIN` entre camadas. O
 * `JOIN UCBT_tab × CRVCRG` foi abortado depois de 11 minutos sem uma linha de
 * saída (laço aninhado de 2 milhões × 68). O `CASE` gerado em `curvas.ts` faz
 * o mesmo em 12,5 s. Ver "Decisões medidas" no plano.
 *
 * A coluna de geometria do FileGDB chama-se `Shape` (não `geometry`), e vem
 * já em graus — EPSG:4326, sem reprojeção.
 */

const soma12 = (p: string) =>
  Array.from({ length: 12 }, (_, i) => `${p}.ENE_${String(i + 1).padStart(2, '0')}`).join('+');

export function sqlCargaPorTrafo(caseSql: string, camada: 'UCBT_tab' | 'UCMT_tab'): string {
  // kWh/mes -> kW medio: energia media mensal / (30,4 dias x 24 h).
  // Depois, x fator de forma = minimo na janela de geracao.
  return `SELECT u.UNI_TR_MT AS trafo, count(*) AS ucs,
       sum( ((${soma12('u')})/12.0) / (30.4*24.0) * (${caseSql}) ) AS carga_min_diurna_kw
  FROM ${camada} u
 WHERE u.UNI_TR_MT <> ''
 GROUP BY u.UNI_TR_MT`;
}

/**
 * A geometria vem NO SELECT, via `ST_AsText`. Com `-dialect SQLITE` o SELECT
 * não carrega a geometria implícita, então `-lco GEOMETRY=AS_WKT` não emite
 * coluna nenhuma — e o CSV sai sem ponto, com a contagem de linhas certa.
 * `ST_AsText` dá 6 casas decimais, ~11 cm: de sobra para um trafo num mapa.
 */
export function sqlTrafos(): string {
  return `SELECT ST_AsText(SHAPE) AS Shape, COD_ID, POT_NOM, CTMT, SUB,
            FAS_CON_P, FAS_CON_S, TEN_LIN_SE, SIT_ATIV
       FROM UNTRMT`;
}

export function sqlGdPorTrafo(camada: 'UGBT_tab' | 'UGMT_tab'): string {
  return `SELECT UNI_TR_MT AS trafo, count(*) AS unidades, sum(POT_INST) AS gd_kw
  FROM ${camada}
 WHERE UNI_TR_MT <> ''
 GROUP BY UNI_TR_MT`;
}

async function paraCsv(gdb: string, destino: string, sql: string): Promise<string> {
  // A geometria vem no proprio SELECT, via ST_AsText — NAO por
  // `-lco GEOMETRY=AS_WKT`. Com `-dialect SQLITE` o SELECT nao carrega a
  // geometria implicita, entao aquela opcao nao emite nada e o CSV sai sem
  // coluna de ponto. Pego em 13/10/2026: a contagem de linhas ficava certa
  // (52.976) e TODOS os trafos seriam descartados por falta de geometria.
  await exec('ogr2ogr', ['-f', 'CSV', destino, gdb, '-dialect', 'SQLITE',
                         '-sql', sql, '-lco', 'SEPARATOR=COMMA'],
             { maxBuffer: 1 << 26 });
  return destino;
}

/** As 68 tipologias: 204 linhas, leitura instantânea. */
export async function lerCurvas(gdb: string): Promise<Curva[]> {
  const tmp = `${gdb}.curvas.csv`;
  await paraCsv(gdb, tmp, 'SELECT * FROM CRVCRG');
  const texto = await readFile(tmp, 'utf8');
  const [cab, ...linhas] = texto.trim().split('\n');
  const cols = cab.split(',');
  const idx = (n: string) => cols.indexOf(n);
  const iCod = idx('COD_ID'), iDia = idx('TIP_DIA');
  const iPot = Array.from({ length: 96 }, (_, i) => idx(`POT_${String(i + 1).padStart(2, '0')}`));

  return linhas.map(l => {
    const c = l.split(',');
    return {
      codId: c[iCod]?.replace(/^"|"$/g, '') ?? '',
      tipDia: c[iDia]?.replace(/^"|"$/g, '') ?? '',
      pot: iPot.map(i => Number(c[i])),
    };
  }).filter(c => c.codId !== '');
}

export async function extrair(
  gdb: string, dir: string, janela: { inicio: number; fim: number },
): Promise<{ trafos: string; carga: string; gd: string; alimentadores: string;
             cargaAlim: string; gdAlim: string; subestacoes: string }> {
  await mkdir(dir, { recursive: true });
  const caseSql = gerarCaseSql(await lerCurvas(gdb), janela.inicio, janela.fim);

  // 0,46 s na Piratininga (52.976 pontos).
  const trafos = await paraCsv(gdb, join(dir, 'trafos.csv'), sqlTrafos());

  // 12,5 s na Piratininga (2.037.215 UCs -> 49.378 trafos).
  const carga = await paraCsv(gdb, join(dir, 'carga.csv'), sqlCargaPorTrafo(caseSql, 'UCBT_tab'));

  // 0,37 s (49.771 unidades geradoras -> 19.643 trafos, 267,9 MW).
  const gd = await paraCsv(gdb, join(dir, 'gd.csv'), sqlGdPorTrafo('UGBT_tab'));

  // TEN_NOM e codigo de dominio (46/63/49/37), nao kV: nao vem, para ninguem
  // ser tentado a converter. Ver "Decisoes medidas".
  const alimentadores = await paraCsv(gdb, join(dir, 'alimentadores.csv'),
    `SELECT COD_ID, NOME, SUB FROM CTMT`);

  // Carga e GD por ALIMENTADOR: 0,3 s cada, e sem elas
  // `rede_aplicar_alimentadores` e letra morta — todo alimentador ficaria
  // `sem_dado` para sempre. Mesma agregacao dos trafos, agrupando por CTMT.
  const cargaAlim = await paraCsv(gdb, join(dir, 'carga-alim.csv'),
    `SELECT u.CTMT AS alimentador,
            sum( ((${soma12('u')})/12.0) / (30.4*24.0) * (${caseSql}) ) AS carga_min_diurna_kw
       FROM UCBT_tab u WHERE u.CTMT <> '' GROUP BY u.CTMT`);
  const gdAlim = await paraCsv(gdb, join(dir, 'gd-alim.csv'),
    `SELECT CTMT AS alimentador, sum(POT_INST) AS gd_kw
       FROM UGBT_tab WHERE CTMT <> '' GROUP BY CTMT`);

  // SUB e MultiPolygon e rede_subestacao.geom e Point: ponto na superficie.
  const subestacoes = await paraCsv(gdb, join(dir, 'subestacoes.csv'),
    `SELECT COD_ID, NOME, ST_X(ST_PointOnSurface(SHAPE)) AS lng,
            ST_Y(ST_PointOnSurface(SHAPE)) AS lat FROM SUB`);

  return { trafos, carga, gd, alimentadores, cargaAlim, gdAlim, subestacoes };
}

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

/**
 * POT_INST corrigido para kW.
 *
 * Em baixa tensão nenhuma unidade passa de 75 kW, então um POT_INST acima de
 * 1000 não pode estar em kW: está em WATTS. Medido em 13/10/2026 na CPFL
 * Paulista: 815 de 288.154 unidades vinham assim (5000, 10000, 13202 — tamanhos
 * residenciais típicos em W), e somadas como kW davam 12.779 MW fantasmas, 13,7
 * GW de "microgeração". Na Piratininga eram 25 unidades e 88,6 MW, um terço do
 * total. Corrigido: Paulista 1.015 MW, Piratininga 179,3 MW.
 *
 * A faixa 75–1000 (234 unidades na Paulista, 59 na Piratininga) fica COMO ESTÁ:
 * é ambígua, e mantê-la em kW erra para o lado seguro — mais GD, mais risco,
 * nunca uma "folga" otimista.
 */
export const POT_INST_KW = 'CASE WHEN POT_INST > 1000 THEN POT_INST / 1000.0 ELSE POT_INST END';

export function sqlGdPorTrafo(camada: 'UGBT_tab' | 'UGMT_tab'): string {
  return `SELECT UNI_TR_MT AS trafo, count(*) AS unidades, sum(${POT_INST_KW}) AS gd_kw
  FROM ${camada}
 WHERE UNI_TR_MT <> ''
 GROUP BY UNI_TR_MT`;
}

export function sqlGdPorAlimentador(camada: 'UGBT_tab' | 'UGMT_tab'): string {
  return `SELECT CTMT AS alimentador, sum(${POT_INST_KW}) AS gd_kw
  FROM ${camada}
 WHERE CTMT <> ''
 GROUP BY CTMT`;
}

/**
 * Traçado dos alimentadores: a SSDMT (trechos de média tensão) agregada por
 * CTMT, UMA linha por alimentador. Medido na Piratininga em 13/10/2026:
 * 396.983 trechos → 550 linhas em 3,3 s, 5,4 MB (máx. 69 KB, mediana 6,4 KB).
 *
 * `ST_LineMerge` ANTES do simplify é obrigatório. Cada trecho tem 2 pontos;
 * sem o merge o simplify não remove nada (8.582 → 8.582 pontos num CTMT); com
 * o merge, 8.582 → 2.210. `PreserveTopology` para a linha não se cruzar.
 * 0,00005° ≈ 5 m: a resolução guardada; o servidor simplifica mais por zoom.
 */
export const TOLERANCIA_TRACADO = 0.00005;

export function sqlTracadoAlimentadores(): string {
  return `SELECT CTMT AS alimentador,
       ST_AsText(ST_SimplifyPreserveTopology(ST_LineMerge(ST_Collect(SHAPE)), ${TOLERANCIA_TRACADO})) AS wkt
  FROM SSDMT
 WHERE CTMT <> ''
 GROUP BY CTMT`;
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
             cargaAlim: string; gdAlim: string; subestacoes: string; tracado: string }> {
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
  const gdAlim = await paraCsv(gdb, join(dir, 'gd-alim.csv'), sqlGdPorAlimentador('UGBT_tab'));

  // SUB e MultiPolygon e rede_subestacao.geom e Point: ponto na superficie.
  const subestacoes = await paraCsv(gdb, join(dir, 'subestacoes.csv'),
    `SELECT COD_ID, NOME, ST_X(ST_PointOnSurface(SHAPE)) AS lng,
            ST_Y(ST_PointOnSurface(SHAPE)) AS lat FROM SUB`);

  // 3,3 s na Piratininga (396.983 trechos -> 550 alimentadores, 5,4 MB).
  const tracado = await paraCsv(gdb, join(dir, 'tracado-alim.csv'), sqlTracadoAlimentadores());

  return { trafos, carga, gd, alimentadores, cargaAlim, gdAlim, subestacoes, tracado };
}

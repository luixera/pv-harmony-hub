import { ComponentKind, Point, Scene, TechnicalJsonMvp } from './types';
import { CONNECTION_INSET, SYMBOL_BBOX, SYMBOL_DEFS } from './symbols';
import { CENTER_Y, drawFrameAndHeader, drawTitleBlock, LEGEND_LINE_H, PITCH_X, START_X } from './paper';
import { resolveProjectTags } from '@/utils/projectValues';

/**
 * Layout EDITÁVEL: o usuário pode arrastar, girar, redimensionar e ligar
 * componentes na tela (ver UnifilarTab.tsx). Isto é o "ManualLayoutSource" da
 * proposta de arquitetura (§17.2) — uma origem de layout alternativa ao
 * cálculo fixo, ao lado do algoritmo automático (ainda não construído).
 */

export interface PlacedSymbol {
  id: string;
  kind: ComponentKind;
  label: string;
  legend: string[];
  x: number;
  y: number;
  /** Graus, 0/90/180/270. */
  rotation: number;
  /** Fator de escala uniforme em torno do centro do bloco (1 = tamanho padrão). */
  scale: number;
}

/**
 * Ponta de uma ligação: um componente (`symbol`) ou um ponto fixo em mm
 * (`point`) — usado tanto para derivar um ramal a partir de um ponto
 * qualquer de outra linha (o ponto fica onde o usuário clicou, "colado"
 * visualmente na linha original) quanto para uma linha totalmente solta
 * (as duas pontas são `point`), sem representar uma ligação elétrica real.
 */
export type ConnectionEndpoint =
  | { kind: 'symbol'; id: string }
  | { kind: 'point'; at: Point };

export interface ManualConnection {
  id: string;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  /** Pontos de dobra adicionados manualmente pelo usuário, na ordem de `from` a `to`. */
  waypoints?: Point[];
}

/** Foto solta no diagrama (ex.: local, fachada, padrão de entrada) — não é um `ComponentKind`. */
export interface PlacedPhoto {
  id: string;
  /** Data URL (já redimensionada/comprimida no upload). */
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Texto solto no diagrama (anotação, título de seção, legenda extra). O
 *  valor pode conter tags `{chave}` do mesmo catálogo dos templates .docx
 *  (`buildProjectValues`) — resolvidas na hora de desenhar/exportar. */
export interface PlacedText {
  id: string;
  value: string;
  x: number;
  y: number;
  /** Tamanho da fonte em mm (convenção da Scene — ver `Primitive.text.size`). */
  size: number;
}

const GRID = 2.5; // mm — mesmo módulo da proposta (§7, Fase 3)

export function snapToGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Posição inicial: a mesma fileira do layout fixo — ponto de partida para o usuário ajustar. */
export function initialPlacement(json: TechnicalJsonMvp): PlacedSymbol[] {
  const y = CENTER_Y - SYMBOL_BBOX.h / 2;
  return json.components.map((c, i) => ({
    id: c.id, kind: c.kind, label: c.label, legend: c.legend,
    x: START_X + i * PITCH_X, y, rotation: 0, scale: 1,
  }));
}

export function initialConnections(json: TechnicalJsonMvp): ManualConnection[] {
  return json.connections.map(c => ({
    id: c.id,
    from: { kind: 'symbol', id: c.from },
    to: { kind: 'symbol', id: c.to },
  }));
}

/**
 * Caminho ortogonal (Manhattan) simplificado entre dois pontos: meio do
 * caminho na horizontal, depois vertical, depois o resto na horizontal.
 * Não é o roteador com detecção de cruzamento da proposta (§7, Fase 3) —
 * é o suficiente para as linhas acompanharem o arrasto sem ficar diagonal.
 */
export function orthogonalPath(a: Point, b: Point): Point[] {
  if (Math.abs(a.y - b.y) < 0.01) return [a, b]; // mesma altura: reta simples
  const midX = a.x + (b.x - a.x) / 2;
  return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
}

/** Centro do bloco, em coordenadas de página, dado o canto superior-esquerdo — já considera a escala. */
export function blockCenter(p: PlacedSymbol): Point {
  return { x: p.x + (SYMBOL_BBOX.w * p.scale) / 2, y: p.y + (SYMBOL_BBOX.h * p.scale) / 2 };
}

/**
 * Ponto de saída/entrada do condutor na borda do símbolo, na direção do
 * outro extremo — mantém a linha "encostando" no símbolo em vez de cruzá-lo,
 * mesmo depois de girar, mover ou redimensionar. Recua pelo `CONNECTION_INSET`
 * do tipo do símbolo: sem isso, o ponto cairia na borda "vazia" da caixa
 * (24×20mm) em vez da ponta real do traço/círculo desenhado — cada símbolo
 * tem uma margem própria (ex.: o medidor é um círculo de raio 8, 4mm menor
 * que a caixa).
 */
function edgePoint(from: PlacedSymbol, towards: Point): Point {
  const c = blockCenter(from);
  const dx = towards.x - c.x, dy = towards.y - c.y;
  const inset = CONNECTION_INSET[from.kind] * from.scale;
  const hw = (SYMBOL_BBOX.w * from.scale) / 2 - inset, hh = (SYMBOL_BBOX.h * from.scale) / 2 - inset;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: c.x + Math.sign(dx || 1) * hw, y: c.y };
  }
  return { x: c.x, y: c.y + Math.sign(dy || 1) * hh };
}

export const SNAP_RADIUS = 6; // mm — clicar/soltar perto o bastante de um componente ou linha "gruda" nele

/** Componente cuja caixa (já considerando escala) está mais perto do ponto, dentro do raio de captura. */
export function findNearestSymbol(pt: Point, placements: PlacedSymbol[], radius = SNAP_RADIUS): PlacedSymbol | null {
  let best: PlacedSymbol | null = null;
  let bestDist = radius;
  for (const p of placements) {
    const hw = (SYMBOL_BBOX.w * p.scale) / 2, hh = (SYMBOL_BBOX.h * p.scale) / 2;
    const cx = p.x + hw, cy = p.y + hh;
    // distância até a borda da caixa (0 se o ponto já estiver dentro dela)
    const dx = Math.max(Math.abs(pt.x - cx) - hw, 0);
    const dy = Math.max(Math.abs(pt.y - cy) - hh, 0);
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  return best;
}

/** Ponto mais próximo sobre uma polilinha, e a distância até ele. */
export function nearestPointOnPolyline(pt: Point, pts: Point[]): { point: Point; dist: number } | null {
  let best: { point: Point; dist: number } | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(pt.x - point.x, pt.y - point.y);
    if (!best || dist < best.dist) best = { point, dist };
  }
  return best;
}

/** Resolve uma ponta de ligação para um ponto "de referência" (centro do bloco, ou o próprio ponto fixo). */
function endpointReference(e: ConnectionEndpoint, byId: Map<string, PlacedSymbol>): Point | null {
  if (e.kind === 'point') return e.at;
  const sym = byId.get(e.id);
  return sym ? blockCenter(sym) : null;
}

/** Uma ligação só é desenhável se as duas pontas resolverem — pontas `point` sempre resolvem;
 *  pontas `symbol` precisam que o componente ainda exista no layout atual. */
export function isConnectionResolvable(conn: ManualConnection, byId: Map<string, PlacedSymbol>): boolean {
  const ok = (e: ConnectionEndpoint) => e.kind === 'point' || byId.has(e.id);
  return ok(conn.from) && ok(conn.to);
}

/**
 * Pontos do condutor entre duas pontas (componente ou ponto fixo). Sem
 * pontos de dobra manuais, cai no roteamento ortogonal automático
 * (`orthogonalPath`). Com pontos de dobra, a linha passa exatamente por
 * eles (roteamento manual — o usuário controla o traço), sem tentar
 * "ortogonalizar" o meio.
 */
export function computeConnectorPoints(
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
  byId: Map<string, PlacedSymbol>,
  waypoints?: Point[],
): Point[] {
  const wps = waypoints ?? [];
  const toRef = endpointReference(to, byId);
  const fromRef = endpointReference(from, byId);
  const towardsFromA = wps[0] ?? toRef ?? { x: 0, y: 0 };
  const towardsFromB = wps[wps.length - 1] ?? fromRef ?? { x: 0, y: 0 };
  const pa = from.kind === 'point' ? from.at : edgePoint(byId.get(from.id)!, towardsFromA);
  const pb = to.kind === 'point' ? to.at : edgePoint(byId.get(to.id)!, towardsFromB);
  if (wps.length === 0) return orthogonalPath(pa, pb);
  return [pa, ...wps, pb];
}

export function buildSceneFromPlacement(
  json: TechnicalJsonMvp,
  placements: PlacedSymbol[],
  connections: ManualConnection[],
  photos: PlacedPhoto[] = [],
  texts: PlacedText[] = [],
  tagValues?: Record<string, string>,
): Scene {
  const scene: Scene = { paper: { widthMm: 297, heightMm: 210 }, shapes: [], blocks: [], blockDefs: SYMBOL_DEFS };
  drawFrameAndHeader(scene, json);
  const resolve = (s: string) => (tagValues ? resolveProjectTags(s, tagValues) : s);

  for (const photo of photos) {
    scene.shapes.push({
      layer: 'PHOTO',
      geometry: { kind: 'image', at: { x: photo.x, y: photo.y }, w: photo.w, h: photo.h, href: photo.href },
    });
  }

  const byId = new Map(placements.map(p => [p.id, p]));

  for (const conn of connections) {
    if (!isConnectionResolvable(conn, byId)) continue;
    const points = computeConnectorPoints(conn.from, conn.to, byId, conn.waypoints);
    scene.shapes.push({ layer: 'CONDUCTOR_AC', geometry: { kind: 'polyline', points } });
  }

  for (const p of placements) {
    scene.blocks.push({ layer: 'SYMBOLS', blockRef: p.kind, at: { x: p.x, y: p.y }, rotation: p.rotation, scale: p.scale });

    const legendX = p.x + (SYMBOL_BBOX.w * p.scale) / 2;
    let legendY = p.y + SYMBOL_BBOX.h * p.scale + 5;
    scene.shapes.push({
      layer: 'TEXT_LABEL',
      geometry: { kind: 'text', at: { x: legendX, y: legendY }, value: resolve(p.label), size: 2.6, anchor: 'middle', weight: 'bold' },
    });
    for (const line of p.legend) {
      legendY += LEGEND_LINE_H;
      scene.shapes.push({
        layer: 'TEXT_LABEL',
        geometry: { kind: 'text', at: { x: legendX, y: legendY }, value: resolve(line), size: 2.4, anchor: 'middle' },
      });
    }
  }

  for (const t of texts) {
    scene.shapes.push({
      layer: 'TEXT_LABEL',
      geometry: { kind: 'text', at: { x: t.x, y: t.y }, value: resolve(t.value), size: t.size, anchor: 'start' },
    });
  }

  drawTitleBlock(scene, json);
  return scene;
}

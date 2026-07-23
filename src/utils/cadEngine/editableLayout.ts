import { ComponentKind, Point, Scene, TechnicalJsonMvp } from './types';
import { SYMBOL_BBOX, SYMBOL_DEFS } from './symbols';
import { CENTER_Y, drawFrameAndHeader, drawTitleBlock, LEGEND_LINE_H, PITCH_X, START_X } from './paper';

/**
 * Layout EDITÁVEL: o usuário pode arrastar, girar e ligar componentes na
 * tela (ver UnifilarTab.tsx). Isto é o "ManualLayoutSource" da proposta de
 * arquitetura (§17.2) — uma origem de layout alternativa ao cálculo fixo,
 * ao lado do algoritmo automático (ainda não construído).
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
}

export interface ManualConnection {
  id: string;
  from: string;
  to: string;
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

const GRID = 2.5; // mm — mesmo módulo da proposta (§7, Fase 3)

export function snapToGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Posição inicial: a mesma fileira do layout fixo — ponto de partida para o usuário ajustar. */
export function initialPlacement(json: TechnicalJsonMvp): PlacedSymbol[] {
  const y = CENTER_Y - SYMBOL_BBOX.h / 2;
  return json.components.map((c, i) => ({
    id: c.id, kind: c.kind, label: c.label, legend: c.legend,
    x: START_X + i * PITCH_X, y, rotation: 0,
  }));
}

export function initialConnections(json: TechnicalJsonMvp): ManualConnection[] {
  return json.connections.map(c => ({ id: c.id, from: c.from, to: c.to }));
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

/** Centro do bloco, em coordenadas de página, dado o canto superior-esquerdo. */
function blockCenter(p: PlacedSymbol): Point {
  return { x: p.x + SYMBOL_BBOX.w / 2, y: p.y + SYMBOL_BBOX.h / 2 };
}

/**
 * Ponto de saída/entrada do condutor na borda do símbolo, na direção do
 * outro extremo — mantém a linha "encostando" no símbolo em vez de cruzá-lo,
 * mesmo depois de girar ou mover.
 */
function edgePoint(from: PlacedSymbol, towards: Point): Point {
  const c = blockCenter(from);
  const dx = towards.x - c.x, dy = towards.y - c.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: c.x + Math.sign(dx || 1) * (SYMBOL_BBOX.w / 2), y: c.y };
  }
  return { x: c.x, y: c.y + Math.sign(dy || 1) * (SYMBOL_BBOX.h / 2) };
}

/**
 * Pontos do condutor entre dois símbolos. Sem pontos de dobra manuais, cai no
 * roteamento ortogonal automático (`orthogonalPath`). Com pontos de dobra, a
 * linha passa exatamente por eles (roteamento manual — o usuário controla o
 * traço), sem tentar "ortogonalizar" o meio.
 */
export function computeConnectorPoints(a: PlacedSymbol, b: PlacedSymbol, waypoints?: Point[]): Point[] {
  const wps = waypoints ?? [];
  const towardsFromA = wps[0] ?? blockCenter(b);
  const towardsFromB = wps[wps.length - 1] ?? blockCenter(a);
  const pa = edgePoint(a, towardsFromA);
  const pb = edgePoint(b, towardsFromB);
  if (wps.length === 0) return orthogonalPath(pa, pb);
  return [pa, ...wps, pb];
}

export function buildSceneFromPlacement(
  json: TechnicalJsonMvp,
  placements: PlacedSymbol[],
  connections: ManualConnection[],
  photos: PlacedPhoto[] = [],
): Scene {
  const scene: Scene = { paper: { widthMm: 297, heightMm: 210 }, shapes: [], blocks: [], blockDefs: SYMBOL_DEFS };
  drawFrameAndHeader(scene, json);

  for (const photo of photos) {
    scene.shapes.push({
      layer: 'PHOTO',
      geometry: { kind: 'image', at: { x: photo.x, y: photo.y }, w: photo.w, h: photo.h, href: photo.href },
    });
  }

  const byId = new Map(placements.map(p => [p.id, p]));

  for (const conn of connections) {
    const a = byId.get(conn.from), b = byId.get(conn.to);
    if (!a || !b) continue;
    const points = computeConnectorPoints(a, b, conn.waypoints);
    scene.shapes.push({ layer: 'CONDUCTOR_AC', geometry: { kind: 'polyline', points } });
  }

  for (const p of placements) {
    scene.blocks.push({ layer: 'SYMBOLS', blockRef: p.kind, at: { x: p.x, y: p.y }, rotation: p.rotation });

    const legendX = p.x + SYMBOL_BBOX.w / 2;
    let legendY = p.y + SYMBOL_BBOX.h + 5;
    scene.shapes.push({
      layer: 'TEXT_LABEL',
      geometry: { kind: 'text', at: { x: legendX, y: legendY }, value: p.label, size: 2.6, anchor: 'middle', weight: 'bold' },
    });
    for (const line of p.legend) {
      legendY += LEGEND_LINE_H;
      scene.shapes.push({
        layer: 'TEXT_LABEL',
        geometry: { kind: 'text', at: { x: legendX, y: legendY }, value: line, size: 2.4, anchor: 'middle' },
      });
    }
  }

  drawTitleBlock(scene, json);
  return scene;
}

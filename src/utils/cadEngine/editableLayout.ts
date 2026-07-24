import { ComponentKind, Point, Scene, TechnicalJsonMvp } from './types';
import { CONNECTION_INSET, SYMBOL_BBOX, SYMBOL_DEFS } from './symbols';
import {
  CENTER_Y, DRAW_BOTTOM, DRAW_TOP, drawFrameAndHeader, drawLegendTable, drawTitleBlock,
  LEGEND_LINE_H, LEGEND_X0, PITCH_X, SheetOptions, START_X,
} from './paper';
import { resolveProjectTags } from '@/utils/projectValues';

export type { SheetOptions } from './paper';

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
  /** Rótulo do condutor (ex.: bitola "2#6mm² + #6mm²"), desenhado junto ao trecho mais longo. Aceita tags. */
  label?: string;
}

/** Caixa de agrupamento (ex.: "QG – Sistema Fotovoltaico", "MEDIÇÃO E DISJUNTOR GERAL")
 *  — puramente visual, desenhada atrás dos símbolos/linhas, com título em cima. */
export interface PlacedGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** Fundo de referência (o PDF original importado): esmaecida, travada e
   *  NUNCA exportada — serve só pra conferir/traçar por cima no editor. */
  underlay?: boolean;
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

/**
 * Estado completo de um diagrama editável — usado tanto pelo `UnifilarTab`
 * (por projeto, salvo em `localStorage`) quanto pelo motor de templates
 * (por template, salvo em `diagram_templates.scene_data`). O mesmo formato
 * nos dois lugares é o que permite reaproveitar o `DiagramEditor` inteiro.
 */
export interface DiagramSceneState {
  placements: PlacedSymbol[];
  connections: ManualConnection[];
  photos: PlacedPhoto[];
  texts: PlacedText[];
  /** Caixas de agrupamento — opcional porque diagramas salvos antes desta versão não têm o campo. */
  groups?: PlacedGroup[];
  /** Campos editáveis da folha (resp. técnico/ART/revisão do carimbo + legenda lig./desl.). */
  sheet?: SheetOptions;
}

const GRID = 2.5; // mm — mesmo módulo da proposta (§7, Fase 3)

export function snapToGrid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Posição inicial: a mesma fileira do layout fixo — ponto de partida para o usuário ajustar. */
export function initialPlacement(json: Pick<TechnicalJsonMvp, 'components'>): PlacedSymbol[] {
  const y = CENTER_Y - SYMBOL_BBOX.h / 2;
  return json.components.map((c, i) => ({
    id: c.id, kind: c.kind, label: c.label, legend: c.legend,
    x: START_X + i * PITCH_X, y, rotation: 0, scale: 1,
  }));
}

export function initialConnections(json: Pick<TechnicalJsonMvp, 'connections'>): ManualConnection[] {
  return json.connections.map(c => ({
    id: c.id,
    from: { kind: 'symbol', id: c.from },
    to: { kind: 'symbol', id: c.to },
  }));
}

export interface RecognizedComponentInput {
  id: string;
  kind: ComponentKind;
  label: string;
  /** Posição no fluxo principal (0 = geração, crescente até a rede) — vem da IA de reconhecimento. */
  stage?: number;
  /** true = deriva do condutor principal (DPS, aterramento...), não fica em série nele. */
  branch?: boolean;
  /** Posição aproximada no documento original, normalizada 0–100 (x = esquerda→direita, y = topo→baixo). */
  x?: number;
  /** Ver `x`. */
  y?: number;
}

export interface RecognizedGroupInput {
  title: string;
  /** Caixa em coordenadas normalizadas 0–100 do documento original. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecognizedConnectionInput {
  from: string;
  to: string;
  /** Especificação do condutor escrita no trecho (ex.: "2#6mm² + #6mm²"). */
  label?: string;
}

/**
 * Posiciona os componentes reconhecidos por IA usando `stage`/`branch`
 * (edge function `diagram-recognize`): componentes de um mesmo `stage` que
 * NÃO são derivação (`branch: false`) ficam na fileira principal (mesmo `x`
 * de `initialPlacement`); os que são derivação (`branch: true`) empilham
 * abaixo da fileira, no `x` do próprio `stage` — a mesma convenção visual já
 * usada quando o usuário arrasta um DPS/aterramento manualmente pra baixo da
 * linha principal (esses símbolos já são desenhados pra conectar "por
 * cima"). Ainda não é pixel-perfeito (a IA erra posição/rotação exata), mas
 * já se parece com um unifilar de verdade em vez de uma fileira única —
 * revisão manual no editor continua necessária.
 */
export function layoutFromRecognition(components: RecognizedComponentInput[]): PlacedSymbol[] {
  const mainY = CENTER_Y - SYMBOL_BBOX.h / 2;
  const branchGapY = SYMBOL_BBOX.h + 8;
  const branchCountByStage = new Map<number, number>();
  const stageOf = (c: RecognizedComponentInput) =>
    Number.isFinite(c.stage) ? Math.max(0, Math.trunc(c.stage as number)) : 0;
  // Comprime o espaçamento quando há muitos estágios, pra não invadir a
  // coluna reservada da tabela de legenda no lado direito da folha.
  const maxStage = Math.max(0, ...components.map(stageOf));
  const available = LEGEND_X0 - START_X - SYMBOL_BBOX.w - 2;
  const pitch = maxStage > 0 ? Math.min(PITCH_X, available / maxStage) : PITCH_X;
  return components.map(c => {
    const stage = stageOf(c);
    const x = snapToGrid(START_X + stage * pitch);
    if (!c.branch) {
      return { id: c.id, kind: c.kind, label: c.label, legend: [], x, y: mainY, rotation: 0, scale: 1 };
    }
    const n = (branchCountByStage.get(stage) ?? 0) + 1;
    branchCountByStage.set(stage, n);
    return { id: c.id, kind: c.kind, label: c.label, legend: [], x, y: mainY + branchGapY * n, rotation: 0, scale: 1 };
  });
}

/** Área útil de desenho da folha (fora da coluna de legenda e do carimbo) — alvo do mapeamento 0–100. */
const DRAW_AREA = {
  x0: START_X, x1: LEGEND_X0 - SYMBOL_BBOX.w - 2,
  y0: DRAW_TOP, y1: DRAW_BOTTOM - SYMBOL_BBOX.h,
};

/** Inverso do `mapNorm`: posição mm na folha → 0–100 da área útil (clampado). */
function toNorm(x: number, y: number): { x: number; y: number } {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return {
    x: clamp(((x - DRAW_AREA.x0) / (DRAW_AREA.x1 - DRAW_AREA.x0)) * 100),
    y: clamp(((y - DRAW_AREA.y0) / (DRAW_AREA.y1 - DRAW_AREA.y0)) * 100),
  };
}

/**
 * Cena atual → o mesmo JSON que o reconhecimento devolve — pra mandar o
 * estado ATUAL do diagrama pro revisor de IA (`diagram-review`) e receber a
 * versão corrigida no mesmo formato. Perdas conhecidas (documentadas na UI):
 * ligações com ponta em derivação (`kind: 'point'`) não têm como ser
 * expressas no schema simples from/to e ficam de fora da revisão.
 */
export function sceneStateToRecognitionInput(state: DiagramSceneState): {
  components: RecognizedComponentInput[];
  connections: RecognizedConnectionInput[];
  groups: RecognizedGroupInput[];
} {
  const components = state.placements.map(p => {
    const center = toNorm(p.x + (SYMBOL_BBOX.w * p.scale) / 2, p.y + (SYMBOL_BBOX.h * p.scale) / 2);
    return { id: p.id, kind: p.kind, label: p.label, x: center.x, y: center.y };
  });
  const connections = state.connections
    .filter(c => c.from.kind === 'symbol' && c.to.kind === 'symbol')
    .map(c => ({
      from: (c.from as { kind: 'symbol'; id: string }).id,
      to: (c.to as { kind: 'symbol'; id: string }).id,
      label: c.label,
    }));
  const groups = (state.groups ?? []).map(g => {
    const tl = toNorm(g.x, g.y);
    const br = toNorm(g.x + g.w, g.y + g.h);
    return { title: g.title, x: tl.x, y: tl.y, w: Math.max(1, br.x - tl.x), h: Math.max(1, br.y - tl.y) };
  });
  return { components, connections, groups };
}

const normValid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

/** Mapeia uma coordenada normalizada 0–100 do documento original pra área útil da folha. */
function mapNorm(x: number, y: number): Point {
  return {
    x: snapToGrid(DRAW_AREA.x0 + (x / 100) * (DRAW_AREA.x1 - DRAW_AREA.x0)),
    y: snapToGrid(DRAW_AREA.y0 + (y / 100) * (DRAW_AREA.y1 - DRAW_AREA.y0)),
  };
}

/**
 * Layout por coordenadas normalizadas (0–100) vindas da IA — o diagrama sai
 * com a MESMA disposição espacial do PDF original (aproximada; a IA erra
 * alguns %, mas o conjunto preserva a cara do documento). Pós-processo:
 * separa componentes que caíram em cima um do outro (a IA às vezes devolve
 * posições coincidentes pra itens próximos).
 */
function layoutFromNormalizedCoords(components: RecognizedComponentInput[]): PlacedSymbol[] {
  const placed: PlacedSymbol[] = components.map(c => {
    const { x, y } = mapNorm(c.x as number, c.y as number);
    return { id: c.id, kind: c.kind, label: c.label, legend: [], x, y, rotation: 0, scale: 1 };
  });
  // afasta sobreposições diretas (mesma célula): empurra pra baixo em passos de meia caixa
  const taken = new Set<string>();
  for (const p of placed) {
    let key = `${p.x},${p.y}`;
    while (taken.has(key)) {
      p.y = snapToGrid(p.y + SYMBOL_BBOX.h / 2 + 2.5);
      key = `${p.x},${p.y}`;
    }
    taken.add(key);
  }
  return placed;
}

/**
 * Monta uma cena a partir do resultado do reconhecimento automático por IA
 * (edge function `diagram-recognize`, ver `useDiagramRecognition`).
 * Preferência de layout: (1) coordenadas normalizadas 0–100, quando a IA
 * devolveu posição válida pra maioria dos componentes — o resultado
 * preserva a disposição espacial do PDF original ("redesenhado"); (2)
 * fallback `stage`/`branch` (fileira principal + derivações empilhadas)
 * quando não. Grupos reconhecidos viram `PlacedGroup`; bitolas viram
 * `label` da ligação. Revisão manual no editor continua necessária.
 */
export function buildSceneFromRecognition(
  components: RecognizedComponentInput[],
  connections: RecognizedConnectionInput[],
  groups: RecognizedGroupInput[] = [],
): DiagramSceneState {
  const withCoords = components.filter(c => normValid(c.x) && normValid(c.y));
  const useCoords = components.length > 0 && withCoords.length >= components.length * 0.6;

  const placements = useCoords
    ? layoutFromNormalizedCoords(components.map(c => ({
        ...c,
        // componente sem coordenada num lote majoritariamente posicionado: joga no canto inferior-esquerdo
        x: normValid(c.x) ? c.x : 2,
        y: normValid(c.y) ? c.y : 95,
      })))
    : layoutFromRecognition(components);

  const manualConnections: ManualConnection[] = connections.map((c, i) => ({
    id: `rec-${i}`,
    from: { kind: 'symbol', id: c.from },
    to: { kind: 'symbol', id: c.to },
    label: c.label || undefined,
  }));

  const placedGroups: PlacedGroup[] = useCoords
    ? groups.filter(g => normValid(g.x) && normValid(g.y)).map((g, i) => {
        const tl = mapNorm(g.x, g.y);
        const br = mapNorm(Math.min(100, g.x + g.w), Math.min(100, g.y + g.h));
        return {
          id: `rec-group-${i}`, title: g.title,
          x: tl.x, y: tl.y,
          w: Math.max(20, br.x - tl.x + SYMBOL_BBOX.w), // +bbox: a caixa deve envolver os símbolos, não os cantos
          h: Math.max(15, br.y - tl.y + SYMBOL_BBOX.h),
        };
      })
    : []; // sem coordenadas confiáveis, um grupo posicionado às cegas atrapalharia mais que ajudaria

  return {
    placements,
    connections: manualConnections,
    photos: [],
    texts: [],
    groups: placedGroups,
  };
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

/** Tipos de componente efetivamente usados, na ordem de primeira aparição — alimenta a tabela de legenda. */
export function usedKindsOf(placements: PlacedSymbol[]): ComponentKind[] {
  const seen = new Set<ComponentKind>();
  const out: ComponentKind[] = [];
  for (const p of placements) {
    if (!seen.has(p.kind)) { seen.add(p.kind); out.push(p.kind); }
  }
  return out;
}

function resolveSheet(sheet: SheetOptions | undefined, resolve: (s: string) => string): SheetOptions {
  return {
    respTecnico: sheet?.respTecnico ? resolve(sheet.respTecnico) : undefined,
    art: sheet?.art ? resolve(sheet.art) : undefined,
    revisao: sheet?.revisao ? resolve(sheet.revisao) : undefined,
    showLegend: sheet?.showLegend,
  };
}

/**
 * "Mobília" da folha — moldura, cabeçalho, carimbo (com os campos editáveis
 * do `sheet`) e tabela de legenda automática. Separada da cena completa
 * porque o canvas interativo desenha a mobília como camada estática (via
 * innerHTML) e o conteúdo (símbolos/linhas/fotos/textos) como elementos
 * React interativos por cima.
 */
export function buildSheetFurnitureScene(
  json: TechnicalJsonMvp,
  usedKinds: ComponentKind[],
  sheet?: SheetOptions,
  tagValues?: Record<string, string>,
): Scene {
  const scene: Scene = { paper: { widthMm: 297, heightMm: 210 }, shapes: [], blocks: [], blockDefs: SYMBOL_DEFS };
  const resolve = (s: string) => (tagValues ? resolveProjectTags(s, tagValues) : s);
  drawFrameAndHeader(scene, json);
  drawTitleBlock(scene, json, resolveSheet(sheet, resolve));
  if (sheet?.showLegend !== false) drawLegendTable(scene, usedKinds);
  return scene;
}

/** Rótulo do condutor: no meio do trecho mais longo, acima (horizontal) ou ao lado (vertical). */
export function connectionLabelPosition(points: Point[]): { at: Point; anchor: 'middle' | 'start' } {
  let best = { len: -1, a: points[0], b: points[points.length - 1] };
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (len > best.len) best = { len, a: points[i], b: points[i + 1] };
  }
  const mid = { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
  const horizontal = Math.abs(best.b.x - best.a.x) >= Math.abs(best.b.y - best.a.y);
  return horizontal
    ? { at: { x: mid.x, y: mid.y - 1.4 }, anchor: 'middle' }
    : { at: { x: mid.x + 1.6, y: mid.y + 0.8 }, anchor: 'start' };
}

export function buildSceneFromPlacement(
  json: TechnicalJsonMvp,
  state: DiagramSceneState,
  tagValues?: Record<string, string>,
): Scene {
  const { placements, connections, photos, texts } = state;
  const groups = state.groups ?? [];
  const scene: Scene = { paper: { widthMm: 297, heightMm: 210 }, shapes: [], blocks: [], blockDefs: SYMBOL_DEFS };
  drawFrameAndHeader(scene, json);
  const resolve = (s: string) => (tagValues ? resolveProjectTags(s, tagValues) : s);

  for (const photo of photos) {
    if (photo.underlay) continue; // fundo de referência é só do editor — nunca sai no SVG/PDF
    scene.shapes.push({
      layer: 'PHOTO',
      geometry: { kind: 'image', at: { x: photo.x, y: photo.y }, w: photo.w, h: photo.h, href: photo.href },
    });
  }

  for (const g of groups) {
    scene.shapes.push({ layer: 'GROUP_BOX', geometry: { kind: 'rect', x: g.x, y: g.y, w: g.w, h: g.h, dashed: true } });
    scene.shapes.push({
      layer: 'GROUP_BOX',
      geometry: { kind: 'text', at: { x: g.x + 2, y: g.y - 1.4 }, value: resolve(g.title), size: 2.6, anchor: 'start', weight: 'bold' },
    });
  }

  const byId = new Map(placements.map(p => [p.id, p]));

  for (const conn of connections) {
    if (!isConnectionResolvable(conn, byId)) continue;
    const points = computeConnectorPoints(conn.from, conn.to, byId, conn.waypoints);
    scene.shapes.push({ layer: 'CONDUCTOR_AC', geometry: { kind: 'polyline', points } });
    if (conn.label) {
      const { at, anchor } = connectionLabelPosition(points);
      scene.shapes.push({ layer: 'TEXT_LABEL', geometry: { kind: 'text', at, value: resolve(conn.label), size: 2.2, anchor } });
    }
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

  drawTitleBlock(scene, json, resolveSheet(state.sheet, resolve));
  if (state.sheet?.showLegend !== false) drawLegendTable(scene, usedKindsOf(placements));
  return scene;
}

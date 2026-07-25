import { ComponentKind, Point, Scene, TechnicalJsonMvp } from './types';
import { CONNECTION_INSET, SYMBOL_BBOX, SYMBOL_DEFS, SYMBOL_PORTS, SymbolPort } from './symbols';
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
 * Ponta de uma ligação. Quatro formas, da mais "viva" pra mais crua:
 * - `port`: uma PORTA nomeada de um componente (ex.: lado CA do inversor) —
 *   pixel-perfeita, acompanha mover/girar/redimensionar o símbolo.
 * - `symbol`: um componente, lado escolhido automaticamente (`edgePoint`,
 *   a borda na direção do outro extremo) — o comportamento clássico.
 * - `line`: DERIVAÇÃO FORMAL — a ponta nasce de outra ligação, na fração
 *   `t` (0–1) do comprimento do traçado dela. Mover/redesenhar a linha-mãe
 *   arrasta a derivação junto, e o ponto de junção ganha o nó preto (•).
 * - `point`: ponto fixo em mm — legado (derivações antigas salvas antes da
 *   derivação formal) e posição temporária durante um arrasto de ponta.
 */
export type ConnectionEndpoint =
  | { kind: 'symbol'; id: string }
  | { kind: 'port'; id: string; port: string }
  | { kind: 'line'; connId: string; t: number }
  | { kind: 'point'; at: Point };

/** Tipo elétrico do condutor — muda cor (e traço, no terra) no canvas e nos exports. */
export type ConductorType = 'ac' | 'dc' | 'ground';

export interface ManualConnection {
  id: string;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  /** Pontos de dobra adicionados manualmente pelo usuário, na ordem de `from` a `to`. */
  waypoints?: Point[];
  /** Rótulo do condutor (ex.: bitola "2#6mm² + #6mm²"), desenhado junto ao trecho mais longo. Aceita tags. */
  label?: string;
  /** Tipo do condutor — ausente = 'ac' (retrocompatível com diagramas salvos). */
  conductor?: ConductorType;
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
  /** Traço da caixa — `dashed` (padrão, retrocompatível) ou `solid`. */
  style?: 'dashed' | 'solid';
  /** true: arrastar a caixa arrasta junto os símbolos/textos/pontos de dobra dentro dela. */
  moveContents?: boolean;
}

/**
 * Figura de anotação livre (seção, destaque, divisória, seta) — camada
 * visual, sem efeito elétrico. `rect`/`ellipse` usam x/y/w/h como caixa;
 * `divider`/`arrow` são uma LINHA de (x,y) a (x+w,y+h) — w/h podem ser
 * negativos (direção).
 */
export interface PlacedShape {
  id: string;
  shape: 'rect' | 'ellipse' | 'divider' | 'arrow';
  x: number;
  y: number;
  w: number;
  h: number;
  dashed?: boolean;
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
  /** Figuras de anotação (retângulo/elipse/divisória/seta) — idem, opcional por retrocompatibilidade. */
  shapes?: PlacedShape[];
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
 * versão corrigida no mesmo formato. Pontas `port` contam como o próprio
 * componente. Perdas conhecidas (documentadas na UI): ligações com ponta em
 * derivação (`line`/`point`) não têm como ser expressas no schema simples
 * from/to e ficam de fora da revisão.
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
  const symbolIdOf = (e: ConnectionEndpoint): string | null =>
    e.kind === 'symbol' || e.kind === 'port' ? e.id : null;
  const connections = state.connections
    .map(c => ({ from: symbolIdOf(c.from), to: symbolIdOf(c.to), label: c.label }))
    .filter((c): c is { from: string; to: string; label: string | undefined } => !!c.from && !!c.to);
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

/** Encaixa um ponto no eixo H/V em relação ao ponto anterior — o desenho de
 *  linha "anda em esquadro" por padrão (Shift segurado libera o ângulo). */
export function orthoSnapPoint(prev: Point, pt: Point): Point {
  return Math.abs(pt.x - prev.x) >= Math.abs(pt.y - prev.y)
    ? { x: pt.x, y: prev.y }
    : { x: prev.x, y: pt.y };
}

interface ObstacleRect { x: number; y: number; w: number; h: number }

/** Um segmento H/V "limpa" o retângulo (com folga)? Como os segmentos dos
 *  candidatos são sempre ortogonais, o teste de caixa-contra-caixa é exato. */
function segmentClearsRect(a: Point, b: Point, r: ObstacleRect, margin: number): boolean {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return !(x0 < r.x + r.w + margin && x1 > r.x - margin && y0 < r.y + r.h + margin && y1 > r.y - margin);
}

function pathClear(pts: Point[], obstacles: ObstacleRect[], margin = 1.5): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const r of obstacles) {
      if (!segmentClearsRect(pts[i], pts[i + 1], r, margin)) return false;
    }
  }
  return true;
}

/**
 * Roteamento ortogonal com DESVIO de obstáculo: tenta uma família de rotas
 * H-V-H / V-H-V (o "corredor" do meio varrido do centro pra fora) e L
 * simples, e devolve a primeira que não atravessa nenhum símbolo. Sem rota
 * limpa (diagrama congestionado), cai no Z clássico do `orthogonalPath` —
 * o comportamento antigo, nunca pior que ele.
 */
export function routeAvoidingObstacles(a: Point, b: Point, obstacles: ObstacleRect[]): Point[] {
  const dedupe = (pts: Point[]) =>
    pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01);
  const candidates: Point[][] = [];
  if (Math.abs(a.y - b.y) < 0.01 || Math.abs(a.x - b.x) < 0.01) candidates.push([a, b]); // reta direta
  const offsets = [0, -5, 5, -10, 10, -15, 15, -20, 20, -30, 30, -40, 40, -50, 50];
  const baseX = (a.x + b.x) / 2;
  for (const o of offsets) {
    const midX = baseX + o;
    candidates.push(dedupe([a, { x: midX, y: a.y }, { x: midX, y: b.y }, b]));
  }
  const baseY = (a.y + b.y) / 2;
  for (const o of offsets) {
    const midY = baseY + o;
    candidates.push(dedupe([a, { x: a.x, y: midY }, { x: b.x, y: midY }, b]));
  }
  candidates.push(dedupe([a, { x: b.x, y: a.y }, b]));
  candidates.push(dedupe([a, { x: a.x, y: b.y }, b]));
  for (const c of candidates) {
    if (c.length >= 2 && pathClear(c, obstacles)) return c;
  }
  return orthogonalPath(a, b);
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

/**
 * Posição de uma porta na página: aplica escala em torno do centro do bloco,
 * depois rotação em torno do mesmo centro, depois a posição — EXATAMENTE a
 * ordem do `blockTransform()` (exportSvg.ts), pra porta cair sempre em cima
 * da geometria desenhada, girada/escalada ou não.
 */
export function portPagePosition(p: PlacedSymbol, port: Pick<SymbolPort, 'x' | 'y'>): Point {
  const cx = SYMBOL_BBOX.w / 2, cy = SYMBOL_BBOX.h / 2;
  const sx = cx + (port.x - cx) * p.scale, sy = cy + (port.y - cy) * p.scale;
  const rad = (p.rotation * Math.PI) / 180;
  const dx = sx - cx, dy = sy - cy;
  return {
    x: p.x + cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: p.y + cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

export const SNAP_RADIUS = 6; // mm — clicar/soltar perto o bastante de um componente ou linha "gruda" nele
export const PORT_SNAP = 3; // mm — mais apertado que o do componente: a porta é um alvo pequeno e específico

/** Porta mais próxima do ponto entre todos os componentes, dentro do raio de captura. */
export function findNearestPort(
  pt: Point, placements: PlacedSymbol[], radius = PORT_SNAP,
): { symbolId: string; portId: string; at: Point } | null {
  let best: { symbolId: string; portId: string; at: Point } | null = null;
  let bestDist = radius;
  for (const p of placements) {
    for (const port of SYMBOL_PORTS[p.kind] ?? []) {
      const at = portPagePosition(p, port);
      const dist = Math.hypot(pt.x - at.x, pt.y - at.y);
      if (dist < bestDist) { bestDist = dist; best = { symbolId: p.id, portId: port.id, at }; }
    }
  }
  return best;
}

/** Ponto na fração `t` (0–1) do comprimento total de uma polilinha. */
export function pointAtT(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const clamped = Math.max(0, Math.min(1, t));
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segs.push(len);
    total += len;
  }
  if (total === 0) return points[0];
  let target = clamped * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const f = segs[i] === 0 ? 0 : Math.min(1, target / segs[i]);
      const a = points[i], b = points[i + 1];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    target -= segs[i];
  }
  return points[points.length - 1];
}

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

/** Ponto mais próximo sobre uma polilinha, a distância até ele e a fração `t`
 *  (0–1 do comprimento total) — `t` é o que a derivação formal grava. */
export function nearestPointOnPolyline(pt: Point, pts: Point[]): { point: Point; dist: number; t: number } | null {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(len);
    total += len;
  }
  let best: { point: Point; dist: number; t: number } | null = null;
  let lenBefore = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const f = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    const point = { x: a.x + f * dx, y: a.y + f * dy };
    const dist = Math.hypot(pt.x - point.x, pt.y - point.y);
    const t = total === 0 ? 0 : (lenBefore + f * segs[i]) / total;
    if (!best || dist < best.dist) best = { point, dist, t };
    lenBefore += segs[i];
  }
  return best;
}

/** Uma ligação só é desenhável se as duas pontas resolverem — pontas `point`
 *  sempre resolvem; `symbol`/`port` precisam que o componente exista;
 *  `line` (derivação formal) precisa da linha-mãe (verificada de fato em
 *  `computeAllConnectionPoints`, que também detecta ciclos). */
export function isConnectionResolvable(
  conn: ManualConnection,
  byId: Map<string, PlacedSymbol>,
  byConnId?: Map<string, ManualConnection>,
): boolean {
  const ok = (e: ConnectionEndpoint) => {
    if (e.kind === 'point') return true;
    if (e.kind === 'line') return byConnId ? byConnId.has(e.connId) : true;
    return byId.has(e.id);
  };
  return ok(conn.from) && ok(conn.to);
}

/**
 * Resolve TODAS as ligações do diagrama de uma vez, na ordem de dependência
 * (uma derivação formal só resolve depois da linha-mãe). É a única fonte de
 * verdade da geometria dos condutores — canvas e exportadores usam o mesmo
 * mapa. Ligações com ponta quebrada (símbolo/linha-mãe removidos) ou em
 * ciclo (A deriva de B que deriva de A) ficam FORA do mapa e não são
 * desenhadas.
 *
 * Regras de traçado por ligação: sem pontos de dobra manuais, roteamento
 * ortogonal automático (`orthogonalPath`); com pontos de dobra, a linha
 * passa exatamente por eles.
 */
export function computeAllConnectionPoints(
  connections: ManualConnection[],
  byId: Map<string, PlacedSymbol>,
): Map<string, Point[]> {
  const byConnId = new Map(connections.map(c => [c.id, c]));
  const resolved = new Map<string, Point[]>();
  const visiting = new Set<string>();
  const failed = new Set<string>();
  // caixas dos símbolos (já escaladas) — obstáculos do roteamento automático
  const rects = [...byId.values()].map(p => ({
    id: p.id, x: p.x, y: p.y, w: SYMBOL_BBOX.w * p.scale, h: SYMBOL_BBOX.h * p.scale,
  }));

  const portOf = (kind: ComponentKind, portId: string): SymbolPort | null =>
    (SYMBOL_PORTS[kind] ?? []).find(p => p.id === portId) ?? null;

  // ponto "alvo" de uma ponta — usado pra decidir de que lado o condutor sai de um símbolo
  const endpointAnchor = (e: ConnectionEndpoint): Point | null => {
    if (e.kind === 'point') return e.at;
    if (e.kind === 'symbol') {
      const s = byId.get(e.id);
      return s ? blockCenter(s) : null;
    }
    if (e.kind === 'port') {
      const s = byId.get(e.id);
      const port = s ? portOf(s.kind, e.port) : null;
      return s && port ? portPagePosition(s, port) : null;
    }
    const parent = resolve(e.connId);
    return parent ? pointAtT(parent, e.t) : null;
  };

  const endpointPoint = (e: ConnectionEndpoint, towards: Point): Point | null => {
    if (e.kind === 'symbol') {
      const s = byId.get(e.id);
      return s ? edgePoint(s, towards) : null;
    }
    return endpointAnchor(e); // point/port/line não dependem da direção
  };

  const resolve = (id: string): Point[] | null => {
    if (resolved.has(id)) return resolved.get(id)!;
    if (failed.has(id) || visiting.has(id)) return null; // quebrada ou ciclo
    const conn = byConnId.get(id);
    if (!conn) return null;
    visiting.add(id);
    try {
      const wps = conn.waypoints ?? [];
      const fromAnchor = endpointAnchor(conn.from);
      const toAnchor = endpointAnchor(conn.to);
      if (!fromAnchor || !toAnchor) { failed.add(id); return null; }
      const pa = endpointPoint(conn.from, wps[0] ?? toAnchor);
      const pb = endpointPoint(conn.to, wps[wps.length - 1] ?? fromAnchor);
      if (!pa || !pb) { failed.add(id); return null; }
      let pts: Point[];
      if (wps.length === 0) {
        // roteamento automático desvia dos símbolos — menos os das próprias pontas
        const excluded = new Set(
          [conn.from, conn.to].flatMap(e => (e.kind === 'symbol' || e.kind === 'port' ? [e.id] : [])),
        );
        pts = routeAvoidingObstacles(pa, pb, rects.filter(r => !excluded.has(r.id)));
      } else {
        pts = [pa, ...wps, pb];
      }
      resolved.set(id, pts);
      return pts;
    } finally {
      visiting.delete(id);
    }
  };

  for (const c of connections) resolve(c.id);
  return resolved;
}

/** `conn` depende (direta ou indiretamente, via derivação formal) de `targetId`?
 *  Usado pra impedir ciclos ao grudar a ponta de uma linha em outra. */
export function connectionDependsOn(
  conn: ManualConnection, targetId: string, byConnId: Map<string, ManualConnection>, depth = 0,
): boolean {
  if (conn.id === targetId) return true;
  if (depth > 20) return true; // profundidade absurda: trata como ciclo por segurança
  for (const e of [conn.from, conn.to]) {
    if (e.kind !== 'line') continue;
    if (e.connId === targetId) return true;
    const parent = byConnId.get(e.connId);
    if (parent && connectionDependsOn(parent, targetId, byConnId, depth + 1)) return true;
  }
  return false;
}

/**
 * Remove ligações e SOLTA as derivações formais que nasciam delas: cada ponta
 * `line` órfã vira um ponto fixo na posição atual (nada some da tela sem o
 * usuário pedir — a derivação só perde o vínculo "vivo").
 * `allPts` deve ser o mapa calculado ANTES da remoção (com as linhas-mãe
 * ainda presentes), senão a posição atual da derivação já não resolve.
 */
export function detachDerivations(
  connections: ManualConnection[],
  removedIds: Set<string>,
  allPts: Map<string, Point[]>,
): ManualConnection[] {
  return connections
    .filter(c => !removedIds.has(c.id))
    .map(c => {
      const fix = (e: ConnectionEndpoint, which: 'from' | 'to'): ConnectionEndpoint => {
        if (e.kind !== 'line' || !removedIds.has(e.connId)) return e;
        const pts = allPts.get(c.id);
        const at = pts ? (which === 'from' ? pts[0] : pts[pts.length - 1]) : { x: 0, y: 0 };
        return { kind: 'point', at };
      };
      const from = fix(c.from, 'from');
      const to = fix(c.to, 'to');
      return from === c.from && to === c.to ? c : { ...c, from, to };
    });
}

/**
 * Primitivas de uma figura de anotação — compartilhadas entre o canvas ao
 * vivo e o export (mesma geometria nos dois). A seta ganha a ponta como
 * duas linhas curtas a ±150° da direção.
 */
export function shapePrimitives(sh: PlacedShape): import('./types').Primitive[] {
  if (sh.shape === 'rect') {
    const x = Math.min(sh.x, sh.x + sh.w), y = Math.min(sh.y, sh.y + sh.h);
    return [{ kind: 'rect', x, y, w: Math.abs(sh.w), h: Math.abs(sh.h), dashed: sh.dashed }];
  }
  if (sh.shape === 'ellipse') {
    return [{
      kind: 'ellipse',
      center: { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 },
      rx: Math.abs(sh.w) / 2, ry: Math.abs(sh.h) / 2, dashed: sh.dashed,
    }];
  }
  const a = { x: sh.x, y: sh.y };
  const b = { x: sh.x + sh.w, y: sh.y + sh.h };
  const prims: import('./types').Primitive[] = [{ kind: 'line', a, b, dashed: sh.dashed }];
  if (sh.shape === 'arrow') {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const HEAD = 2.5, SPREAD = Math.PI / 6;
    for (const s of [-1, 1]) {
      prims.push({
        kind: 'line', a: b,
        b: { x: b.x - HEAD * Math.cos(ang + s * SPREAD), y: b.y - HEAD * Math.sin(ang + s * SPREAD) },
      });
    }
  }
  return prims;
}

/**
 * TEMPLATE PARAMÉTRICO — multiplica o ramal FV pelo nº de inversores do
 * projeto. Válido quando o desenho tem EXATAMENTE 1 inversor e o projeto
 * tem N > 1: o subgrafo a montante do inversor (módulos, chave CC, DPS CC...
 * tudo que alimenta ele) é clonado N-1 vezes, empilhado abaixo do original,
 * e cada inversor clonado liga NO MESMO ponto a jusante do original (o
 * barramento CA/QG continua único, como nos unifilares reais de múltiplos
 * inversores). Topologia fora desse caso → devolve `null` (quem chama mantém
 * a cena original e avisa).
 */
export function multiplyInverterBranches(state: DiagramSceneState, targetCount: number): DiagramSceneState | null {
  if (targetCount < 2) return null;
  const inverters = state.placements.filter(p => p.kind === 'inverter');
  if (inverters.length !== 1) return null;
  const inv = inverters[0];

  const symIdOf = (e: ConnectionEndpoint): string | null =>
    e.kind === 'symbol' || e.kind === 'port' ? e.id : null;

  // subgrafo a montante: BFS pelos predecessores (conexões que TERMINAM em cada nó)
  const upstream = new Set<string>([inv.id]);
  let frontier = [inv.id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const conn of state.connections) {
      const to = symIdOf(conn.to);
      const from = symIdOf(conn.from);
      if (to && frontier.includes(to) && from && !upstream.has(from)) {
        upstream.add(from);
        next.push(from);
      }
    }
    frontier = next;
  }
  const branchSyms = state.placements.filter(p => upstream.has(p.id));
  if (branchSyms.length < 2) return null; // inversor sem nada a montante: não há ramal pra clonar

  // altura do ramal → passo vertical dos clones
  const minY = Math.min(...branchSyms.map(p => p.y));
  const maxY = Math.max(...branchSyms.map(p => p.y + SYMBOL_BBOX.h * p.scale));
  const stepY = snapToGrid(maxY - minY + 12);

  const placements = [...state.placements];
  const connections = [...state.connections];
  for (let i = 1; i < targetCount; i++) {
    const idMap = new Map<string, string>();
    for (const p of branchSyms) {
      const cloneId = `manual-${p.kind}-param${i}-${p.id.replace(/[^a-z0-9]/gi, '').slice(-8)}`;
      idMap.set(p.id, cloneId);
      placements.push({
        ...p, id: cloneId, y: p.y + stepY * i,
        label: p.kind === 'inverter' ? `${p.label} ${i + 1}` : p.label,
      });
    }
    const remap = (e: ConnectionEndpoint): ConnectionEndpoint => {
      const sid = symIdOf(e);
      if (!sid || !idMap.has(sid)) return e;
      return e.kind === 'port'
        ? { kind: 'port', id: idMap.get(sid)!, port: e.port }
        : { kind: 'symbol', id: idMap.get(sid)! };
    };
    for (const conn of state.connections) {
      const fromId = symIdOf(conn.from);
      const toId = symIdOf(conn.to);
      const fromIn = !!fromId && upstream.has(fromId);
      const toIn = !!toId && upstream.has(toId);
      // interna ao ramal: clona inteira (com pontos de dobra deslocados);
      // saída do inversor pro resto: clona só remapeando a origem (junta no
      // mesmo barramento); qualquer outra fica só no original
      if (fromIn && toIn) {
        connections.push({
          ...conn,
          id: `${conn.id}-param${i}`,
          from: remap(conn.from),
          to: remap(conn.to),
          waypoints: conn.waypoints?.map(p => ({ x: p.x, y: p.y + stepY * i })),
        });
      } else if (fromIn && !toIn && fromId === inv.id) {
        connections.push({
          ...conn,
          id: `${conn.id}-param${i}`,
          from: remap(conn.from),
          waypoints: undefined, // re-roteia sozinha até o barramento
        });
      }
    }
  }
  // o inversor original também ganha numeração quando vira "1 de N"
  const renamed = placements.map(p => (p.id === inv.id ? { ...p, label: `${p.label} 1` } : p));
  return { ...state, placements: renamed, connections };
}

/** Nº de inversores desenhados numa cena — usado no casamento paramétrico de modelos. */
export function inverterCountOf(state: DiagramSceneState): number {
  return state.placements.filter(p => p.kind === 'inverter').length;
}

/**
 * "Organizar": arruma um diagrama bagunçado num clique — alinha fileiras
 * (centros com Y próximo → mesma altura) e colunas (X próximo → mesmo eixo),
 * uniformiza o espaçamento de fileiras longas e limpa os pontos de dobra
 * manuais pra todos os condutores re-rotearem com desvio de obstáculo.
 * Puramente geométrico: não cria, remove nem religa nada.
 */
export function autoArrange(state: DiagramSceneState): DiagramSceneState {
  if (state.placements.length === 0) return state;
  const placements = state.placements.map(p => ({ ...p }));
  const center = (p: PlacedSymbol) => ({
    x: p.x + (SYMBOL_BBOX.w * p.scale) / 2,
    y: p.y + (SYMBOL_BBOX.h * p.scale) / 2,
  });
  const ROW_TOL = 15; // mm — centros a menos disso na vertical = mesma fileira
  const COL_TOL = 12;

  // fileiras: clusteriza por Y e alinha cada uma na média
  const rows: { members: PlacedSymbol[]; sumY: number }[] = [];
  for (const p of [...placements].sort((a, b) => center(a).y - center(b).y)) {
    const cy = center(p).y;
    const row = rows.find(r => Math.abs(r.sumY / r.members.length - cy) <= ROW_TOL);
    if (row) { row.members.push(p); row.sumY += cy; }
    else rows.push({ members: [p], sumY: cy });
  }
  for (const r of rows) {
    const avgY = snapToGrid(r.sumY / r.members.length);
    for (const p of r.members) p.y = avgY - (SYMBOL_BBOX.h * p.scale) / 2;
  }

  // colunas: idem pra X (só colunas com 2+ — coluna de 1 não tem com o que alinhar)
  const cols: { members: PlacedSymbol[]; sumX: number }[] = [];
  for (const p of [...placements].sort((a, b) => center(a).x - center(b).x)) {
    const cx = center(p).x;
    const col = cols.find(c => Math.abs(c.sumX / c.members.length - cx) <= COL_TOL);
    if (col) { col.members.push(p); col.sumX += cx; }
    else cols.push({ members: [p], sumX: cx });
  }
  for (const c of cols) {
    if (c.members.length < 2) continue;
    const avgX = snapToGrid(c.sumX / c.members.length);
    for (const p of c.members) p.x = avgX - (SYMBOL_BBOX.w * p.scale) / 2;
  }

  // espaçamento uniforme dentro de fileiras longas (3+), mantendo a ordem e
  // as extremidades — só quando o passo médio comporta os símbolos
  for (const r of rows) {
    if (r.members.length < 3) continue;
    const ms = [...r.members].sort((a, b) => a.x - b.x);
    const first = center(ms[0]).x;
    const last = center(ms[ms.length - 1]).x;
    const pitch = (last - first) / (ms.length - 1);
    if (pitch < SYMBOL_BBOX.w + 4) continue; // apertado demais: não força sobreposição
    ms.forEach((p, i) => {
      p.x = snapToGrid(first + i * pitch) - (SYMBOL_BBOX.w * p.scale) / 2;
    });
  }

  // limpa pontos de dobra: os condutores re-roteiam sozinhos (com desvio)
  const connections = state.connections.map(c =>
    c.waypoints?.length ? { ...c, waypoints: undefined } : c,
  );

  return { ...state, placements, connections };
}

/** Camada da Scene correspondente ao tipo de condutor (ausente = CA). */
export function conductorLayer(c: ConductorType | undefined): 'CONDUCTOR_AC' | 'CONDUCTOR_DC' | 'CONDUCTOR_GROUND' {
  if (c === 'dc') return 'CONDUCTOR_DC';
  if (c === 'ground') return 'CONDUCTOR_GROUND';
  return 'CONDUCTOR_AC';
}

/** Tipos de condutor efetivamente usados (na ordem CA→CC→terra) — alimenta a legenda. */
export function usedConductorsOf(connections: ManualConnection[]): ConductorType[] {
  const present = new Set(connections.map(c => c.conductor ?? 'ac'));
  return (['ac', 'dc', 'ground'] as ConductorType[]).filter(t => present.has(t));
}

/** Componentes em série (entrada→saída no fluxo) — os que podem ser soltos "no fio". */
export const SERIES_KINDS: ReadonlySet<ComponentKind> = new Set([
  'breaker', 'breaker-tripolar', 'dc-switch', 'fuse', 'distribution-panel',
]);

/**
 * "Soltar no fio": divide a ligação `conn` em duas, passando pelo componente
 * em série `sym` (porta entrada ← lado do `from`; porta saída → lado do
 * `to`). A primeira metade HERDA o id da ligação original — derivações
 * formais penduradas nela continuam resolvendo (a posição ao longo do `t`
 * se acomoda no traçado mais curto). Bitola e tipo de condutor são
 * preservados; os pontos de dobra são descartados (as duas metades
 * re-roteiam sozinhas com desvio de obstáculo).
 */
export function splitConnectionAtSymbol(
  connections: ManualConnection[],
  connId: string,
  sym: PlacedSymbol,
): ManualConnection[] {
  const conn = connections.find(c => c.id === connId);
  if (!conn) return connections;
  const first: ManualConnection = {
    id: conn.id,
    from: conn.from,
    to: { kind: 'port', id: sym.id, port: 'entrada' },
    label: conn.label,
    conductor: conn.conductor,
  };
  const second: ManualConnection = {
    id: `manual-${Date.now()}-split`,
    from: { kind: 'port', id: sym.id, port: 'saida' },
    to: conn.to,
    conductor: conn.conductor,
  };
  return connections.flatMap(c => (c.id === connId ? [first, second] : [c]));
}

/**
 * "Refazer o fio": ao remover um componente em série que tinha EXATAMENTE
 * uma ligação chegando e uma saindo, funde as duas numa só (a ligação
 * original volta a atravessar direto) — o inverso do soltar-no-fio. Se a
 * topologia for outra (0 ou 2+ de cada lado), nada é fundido e as ligações
 * do componente caem como antes.
 */
export function healConnectionsThrough(
  connections: ManualConnection[],
  removedIds: Set<string>,
): { connections: ManualConnection[]; mergedAwayIds: Set<string> } {
  let result = connections;
  const mergedAwayIds = new Set<string>();
  for (const symId of removedIds) {
    const refs = (e: ConnectionEndpoint) => (e.kind === 'symbol' || e.kind === 'port') && e.id === symId;
    const incoming = result.filter(c => refs(c.to) && !refs(c.from));
    const outgoing = result.filter(c => refs(c.from) && !refs(c.to));
    if (incoming.length !== 1 || outgoing.length !== 1) continue;
    const merged: ManualConnection = {
      id: incoming[0].id,
      from: incoming[0].from,
      to: outgoing[0].to,
      label: incoming[0].label ?? outgoing[0].label,
      conductor: incoming[0].conductor ?? outgoing[0].conductor,
    };
    mergedAwayIds.add(outgoing[0].id); // derivações penduradas nele precisam ser soltas
    result = result.flatMap(c => (c.id === incoming[0].id ? [merged] : c.id === outgoing[0].id ? [] : [c]));
  }
  return { connections: result, mergedAwayIds };
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
  usedConductors: ConductorType[] = [],
): Scene {
  const scene: Scene = { paper: { widthMm: 297, heightMm: 210 }, shapes: [], blocks: [], blockDefs: SYMBOL_DEFS };
  const resolve = (s: string) => (tagValues ? resolveProjectTags(s, tagValues) : s);
  drawFrameAndHeader(scene, json);
  drawTitleBlock(scene, json, resolveSheet(sheet, resolve));
  if (sheet?.showLegend !== false) drawLegendTable(scene, usedKinds, usedConductors);
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
    scene.shapes.push({ layer: 'GROUP_BOX', geometry: { kind: 'rect', x: g.x, y: g.y, w: g.w, h: g.h, dashed: g.style !== 'solid' } });
    scene.shapes.push({
      layer: 'GROUP_BOX',
      geometry: { kind: 'text', at: { x: g.x + 2, y: g.y - 1.4 }, value: resolve(g.title), size: 2.6, anchor: 'start', weight: 'bold' },
    });
  }

  for (const sh of state.shapes ?? []) {
    for (const prim of shapePrimitives(sh)) {
      scene.shapes.push({ layer: 'ANNOTATION', geometry: prim });
    }
  }

  const byId = new Map(placements.map(p => [p.id, p]));
  const allPts = computeAllConnectionPoints(connections, byId);

  for (const conn of connections) {
    const points = allPts.get(conn.id);
    if (!points) continue;
    const layer = conductorLayer(conn.conductor);
    scene.shapes.push({ layer, geometry: { kind: 'polyline', points, dashed: conn.conductor === 'ground' || undefined } });
    if (conn.label) {
      const { at, anchor } = connectionLabelPosition(points);
      scene.shapes.push({ layer: 'TEXT_LABEL', geometry: { kind: 'text', at, value: resolve(conn.label), size: 2.2, anchor } });
    }
    // nó de junção (•) onde a derivação formal nasce da linha-mãe — convenção dos unifilares reais
    if (conn.from.kind === 'line') {
      scene.shapes.push({ layer, geometry: { kind: 'circle', center: points[0], radius: 0.8, filled: true } });
    }
    if (conn.to.kind === 'line') {
      scene.shapes.push({ layer, geometry: { kind: 'circle', center: points[points.length - 1], radius: 0.8, filled: true } });
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
  if (state.sheet?.showLegend !== false) drawLegendTable(scene, usedKindsOf(placements), usedConductorsOf(connections));
  return scene;
}

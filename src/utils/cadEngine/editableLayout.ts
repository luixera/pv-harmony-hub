import { ComponentKind, Point, Scene, TechnicalJsonMvp } from './types';
import { CONNECTION_INSET, SYMBOL_BBOX, SYMBOL_DEFS, SYMBOL_PORTS, SymbolPort } from './symbols';
import { WARNING_PLATE_ENEL, WARNING_PLATE_GENERIC } from './warningPlates';
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
  /** Deslocamento do BLOCO DE RÓTULO (nome + legendas) em relação à posição
   *  padrão (centrado logo abaixo do símbolo) — o usuário arrasta o texto pra
   *  onde quiser quando o desenho aperta. Ausente = posição padrão. */
  labelDx?: number;
  labelDy?: number;
}

/** Distância padrão entre a base do símbolo e a 1ª linha do rótulo (mm). */
export const LABEL_GAP = 3.4;

/** Posição do bloco de rótulo de um símbolo (já com o deslocamento manual). */
export function labelAnchor(p: PlacedSymbol): Point {
  return {
    x: p.x + (SYMBOL_BBOX.w * p.scale) / 2 + (p.labelDx ?? 0),
    y: p.y + SYMBOL_BBOX.h * p.scale + LABEL_GAP + (p.labelDy ?? 0),
  };
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
  /** Ids de componentes FIXOS do cadastro removidos à mão pelo usuário — o
   *  reconcile() não os semeia de novo (edição manual livre no projeto). */
  suppressedIds?: string[];
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

/**
 * Plano pra arrastar UM trecho de um condutor individualmente: dado o traçado
 * completo `full` e o índice do trecho `k` (entre full[k] e full[k+1]),
 * devolve os pontos de dobra base (materializando o traçado atual e inserindo
 * uma dobra na PONTA quando o trecho toca uma, pra a ponta ficar parada), os
 * índices que se movem perpendicular e o eixo do movimento. É o que faz cada
 * trecho ser editável "individual até as duas dobras" em vez da linha andar
 * como bloco.
 */
export function segmentDragPlan(full: Point[], k: number): { waypoints: Point[]; moveIdx: number[]; axis: 'x' | 'y' } {
  const n = full.length - 1;
  const interior = full.slice(1, n).map(p => ({ ...p }));
  const firstIsEnd = k === 0;
  const lastIsEnd = k + 1 === n;
  let wps = interior;
  const shift = firstIsEnd ? 1 : 0;
  if (firstIsEnd) wps = [{ ...full[0] }, ...wps];
  const li = firstIsEnd ? 0 : (k - 1) + shift;
  let ri: number;
  if (lastIsEnd) { wps = [...wps, { ...full[n] }]; ri = wps.length - 1; }
  else ri = k + shift;
  const axis: 'x' | 'y' = Math.abs(full[k].y - full[k + 1].y) <= Math.abs(full[k].x - full[k + 1].x) ? 'y' : 'x';
  return { waypoints: wps, moveIdx: [...new Set([li, ri])], axis };
}

/** Interseção de dois segmentos, se cruzarem de verdade (paralelos → null). */
function segmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/**
 * Ponto de ENCAIXE especial sobre as linhas: finais de linha (t=0/1) e
 * interseções entre duas linhas — alvos mais específicos que o corpo do
 * traço, com prioridade sobre a derivação em ponto qualquer. Devolve o
 * `t` na linha escolhida (a derivação formal continua "viva": final de
 * linha acompanha a ponta, interseção acompanha o traçado).
 */
export function findLineSnapPoint(
  pt: Point,
  connections: ManualConnection[],
  allPts: Map<string, Point[]>,
  excludeIds?: Set<string>,
  radius = SNAP_RADIUS,
): { connId: string; t: number; point: Point; snap: 'end' | 'intersection' } | null {
  const usable = connections.filter(c => !excludeIds?.has(c.id) && allPts.has(c.id));
  const byConnId = new Map(connections.map(c => [c.id, c]));
  // Prioridade quando dois candidatos empatam na distância (o caso das
  // interseções, em que o MESMO ponto pertence às duas linhas): prefere a
  // linha que NÃO é derivação da outra — grudar na derivada faria a junção
  // pular de lugar quando a linha-mãe se movesse.
  const rank = (snap: 'end' | 'intersection') => (snap === 'end' ? 0 : 1);
  let best: { connId: string; t: number; point: Point; snap: 'end' | 'intersection'; dist: number } | null = null;
  const consider = (connId: string, point: Point, snap: 'end' | 'intersection') => {
    const dist = Math.hypot(pt.x - point.x, pt.y - point.y);
    if (dist > radius) return;
    if (best) {
      const closer = dist < best.dist - 0.01;
      const tied = Math.abs(dist - best.dist) <= 0.01;
      if (!closer && !(tied && rank(snap) < rank(best.snap))) return;
    }
    const onLine = nearestPointOnPolyline(point, allPts.get(connId)!);
    best = { connId, t: onLine?.t ?? 0, point, snap, dist };
  };
  for (const c of usable) {
    const pts = allPts.get(c.id)!;
    consider(c.id, pts[0], 'end');
    consider(c.id, pts[pts.length - 1], 'end');
  }
  /** O ponto é (quase) uma das pontas da linha? Aí já foi tratado como 'end' —
   *  contar de novo como interseção criava um alvo fantasma em cima de cada
   *  junção que já existe. */
  const isEndpointOf = (connId: string, p: Point) => {
    const pts = allPts.get(connId)!;
    const near = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y) < 0.2;
    return near(pts[0]) || near(pts[pts.length - 1]);
  };
  for (let i = 0; i < usable.length; i++) {
    const ca = usable[i];
    const pa = allPts.get(ca.id)!;
    for (let j = i + 1; j < usable.length; j++) {
      const cb = usable[j];
      const pb = allPts.get(cb.id)!;
      for (let si = 0; si < pa.length - 1; si++) {
        for (let sj = 0; sj < pb.length - 1; sj++) {
          const x = segmentIntersection(pa[si], pa[si + 1], pb[sj], pb[sj + 1]);
          if (!x) continue;
          if (isEndpointOf(ca.id, x) || isEndpointOf(cb.id, x)) continue; // é ponta, não cruzamento
          // a interseção pertence às DUAS linhas: oferece as duas e deixa o
          // desempate escolher a mãe (antes gravava sempre na primeira do par,
          // o que fazia a derivação grudar numa linha arbitrária)
          const aDependsOnB = connectionDependsOn(ca, cb.id, byConnId);
          const bDependsOnA = connectionDependsOn(cb, ca.id, byConnId);
          if (!aDependsOnB) consider(ca.id, x, 'intersection');
          if (!bDependsOnA) consider(cb.id, x, 'intersection');
        }
      }
    }
  }
  return best;
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
 * Plano pra EXCLUIR UM TRECHO de um condutor (pedido do usuário: "quero
 * conseguir excluir um traço de linha, hoje só consigo movimentá-lo").
 * Trabalha sobre o traçado real (`full`), então funciona igual em linha
 * roteada automaticamente e em linha com dobras manuais:
 *
 * - único trecho da linha  → a ligação inteira sai (devolve []);
 * - trecho de uma PONTA    → a linha encolhe e a ponta vira livre;
 * - trecho do MEIO         → a ligação vira DUAS, com pontas livres na
 *                            falha (é o comportamento de CAD esperado).
 *
 * As ligações devolvidas ganham ids novos quando há divisão, pra não
 * herdarem derivações que apontavam pro traçado antigo (quem chama passa
 * o id original por `detachDerivations`).
 */
export function deleteSegmentPlan(
  conn: ManualConnection,
  full: Point[],
  segIndex: number,
): ManualConnection[] {
  const last = full.length - 2; // índice do último trecho
  if (full.length < 2 || segIndex < 0 || segIndex > last) return [conn];
  if (full.length === 2) return []; // linha de um trecho só: some inteira

  const freePoint = (p: Point): ConnectionEndpoint => ({ kind: 'point', at: { x: p.x, y: p.y } });
  const rest = { conductor: conn.conductor, label: conn.label };

  if (segIndex === 0) {
    return [{ ...conn, from: freePoint(full[1]), waypoints: full.slice(2, -1) }];
  }
  if (segIndex === last) {
    return [{ ...conn, to: freePoint(full[full.length - 2]), waypoints: full.slice(1, -2) }];
  }
  return [
    { id: `${conn.id}-a`, from: conn.from, to: freePoint(full[segIndex]), waypoints: full.slice(1, segIndex), ...rest },
    { id: `${conn.id}-b`, from: freePoint(full[segIndex + 1]), to: conn.to, waypoints: full.slice(segIndex + 2, -1), ...rest },
  ];
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
 * Cena COMPLETA de um projeto com 1..N arranjos, na topologia padrão pedida
 * pelo usuário (boas práticas + facilitar a análise da concessionária):
 *
 *   Arranjo 1: FV ─(CC)─ INV 1 ─ Disj. Arranjo 1 ─┐         Cargas do local
 *   Arranjo N: FV ─(CC)─ INV N ─ Disj. Arranjo N ─┴•─[Geral*]─┬──╔══ PADRÃO DE ENTRADA ══╗── Rede
 *                                                        DPS ┘  ║ Disj. padrão ─┬─ Medidor ║
 *                                                               ║          DPS ┘  ⚠ placa  ║
 *
 * - UM disjuntor CA por arranjo; junção em nó (•, derivação formal).
 * - Disjuntor geral de seccionamento OPCIONAL (`includeGeneralBreaker`).
 * - DPS em PARALELO depois da junção dos arranjos.
 * - Cargas do local (referência) derivadas do mesmo barramento, acima.
 * - **PADRÃO DE ENTRADA** (caixa de grupo): disjuntor do padrão AO LADO do
 *   medidor (legenda vem das regras da concessionária — `matchEntryRule`),
 *   DPS do padrão em paralelo ao disjuntor do padrão (exigência das
 *   concessionárias) e a placa de advertência de geração própria.
 * - Layout SE REORGANIZA com muitos inversores: acima de 3 arranjos o
 *   espaçamento entre fileiras comprime e os símbolos do ramal reduzem de
 *   escala pra prancha A4 continuar comportando tudo.
 * - TODOS os ids são `manual-` → cena 100% editável no projeto e o
 *   reconcile() nunca recria nada por cima (mesma regra dos modelos).
 */
export function buildMultiArrangementScene(options: {
  inverterCount: number;
  /** Legenda do bloco FV de cada arranjo (ex.: o arranjo de strings escolhido). */
  pvLegends?: string[][];
  includeGeneralBreaker?: boolean;
  includeLoadsReference?: boolean;
  /** Legenda do disjuntor do padrão de entrada (ex.: "63A · B1", das regras da concessionária). */
  entryBreakerLegend?: string[];
  /** Legenda do medidor (ex.: caixa de medição das regras da concessionária). */
  meterLegend?: string[];
  /** Placa de advertência do padrão: 'enel' = placa AVISO/RETORNO GERADOR da
   *  ENEL; 'generic' (padrão) = placa amarela CUIDADO/GERAÇÃO PRÓPRIA
   *  (CPFL e demais concessionárias). */
  warningVariant?: 'generic' | 'enel';
  /** Nome da concessionária — vira o rótulo da rede ("Rede – CPFL"). */
  utilityName?: string;
  /** Corrente nominal do disjuntor de cada arranjo (ex.: [40, 40]) — vira a
   *  legenda do disjuntor, dimensionada pela corrente CA de cada inversor. */
  branchBreakerA?: (number | null)[];
  /** Corrente do disjuntor geral (proporcional à soma das correntes). */
  generalBreakerA?: number | null;
  /** Bitolas pra rotular os trechos: CC (FV→inversor), CA de cada arranjo e
   *  o tronco depois da junção (ex.: '6 mm²'). */
  dcSection?: string;
  branchSection?: string;
  trunkSection?: string;
  /** PLANTA DE LOCALIZAÇÃO: recorte de satélite do local (data URL) + as
   *  coordenadas pra legenda. Entra no canto superior esquerdo e empurra as
   *  fileiras pra baixo. */
  locationMap?: { href: string; caption?: string };
}): DiagramSceneState {
  const n = Math.max(1, options.inverterCount);
  const includeGB = options.includeGeneralBreaker !== false;
  const includeLoads = options.includeLoadsReference !== false;
  const uid = (() => { let i = 0; return (kind: string) => `manual-${kind}-arr${++i}`; })();

  // Colunas (x do canto sup-esq; caixa 24×20). TUDO fica à esquerda de
  // LEGEND_X0 (235): a coluna da direita é reservada à tabela de LEGENDA, que
  // cresce com o nº de símbolos — desenhar por baixo dela deixava o tracejado
  // do padrão de entrada em cima da legenda (relato do usuário).
  const X_PV = 18, X_INV = 54, X_CB = 90;
  const X_JUNC = 116;                       // x do nó de junção dos arranjos
  const X_GB = 122;                         // disjuntor geral (se incluído)
  const X_EB = 156;                         // disjuntor do padrão de entrada
  const X_METER = 182, X_GRID = 208;
  const MID_TOP = 110;                      // y do tronco CA (portas em MID_TOP+10) — abaixo da tabela de legenda, que ocupa o canto sup-direito até ~108mm
  const ROW_GAP = 36;
  const midY = MID_TOP + 10;

  // Auto-reorganização: com até 3 arranjos, fileiras centradas no tronco em
  // escala cheia; acima disso, o espaçamento comprime, o CONJUNTO sobe (o
  // limite de baixo é mais apertado — carimbo) e os símbolos do ramal
  // reduzem de escala pra prancha A4 comportar tudo. Com a PLANTA DE
  // LOCALIZAÇÃO no canto superior esquerdo, a faixa útil começa mais abaixo.
  const hasMap = !!options.locationMap;
  const topLimit = hasMap ? 82 : 30;    // 1ª fileira não sobe além disso
  const BOTTOM = 162;                   // acima do carimbo (com folga pro snap de 2,5mm)
  const avail = BOTTOM - topLimit;
  const minGap = hasMap ? 13 : 16;
  // afrouxa o espaçamento até o conjunto (fileiras + altura do último
  // símbolo, já escalado) caber na faixa útil
  let gap = ROW_GAP;
  const heightAt = (g: number) => 20 * Math.max(0.6, Math.min(1, g / ROW_GAP));
  while (gap > minGap && (n - 1) * gap + heightAt(gap) > avail) gap -= 0.5;
  const rowScale = Math.max(0.6, Math.min(1, gap / ROW_GAP));
  // centra no tronco quando cabe; senão encosta na faixa útil (topo primeiro)
  const half = ((n - 1) / 2) * gap;
  const rowCenter = Math.max(topLimit + half, Math.min(MID_TOP, BOTTOM - 20 * rowScale - half));
  const rowY = (i: number) => rowCenter + (i - (n - 1) / 2) * gap;

  const placements: PlacedSymbol[] = [];
  const connections: ManualConnection[] = [];
  const sym = (kind: ComponentKind, x: number, y: number, label: string, legend: string[] = [], scale = 1): PlacedSymbol => {
    const p: PlacedSymbol = { id: uid(kind), kind, label, legend, x, y: snapToGrid(y), rotation: 0, scale };
    placements.push(p);
    return p;
  };

  const cbs: PlacedSymbol[] = [];
  for (let i = 0; i < n; i++) {
    const y = rowY(i);
    const breakerA = options.branchBreakerA?.[i] ?? null;
    const pv = sym('pv-array', X_PV, y, n > 1 ? `Arranjo ${i + 1}` : 'Arranjo FV', options.pvLegends?.[i] ?? [], rowScale);
    const inv = sym('inverter', X_INV, y, n > 1 ? `Inversor ${i + 1}` : 'Inversor', [], rowScale);
    const cb = sym(
      'breaker', X_CB, y,
      n > 1 ? `Disjuntor Arranjo ${i + 1}` : 'Disjuntor CA',
      breakerA ? [`${breakerA}A`] : [], rowScale,
    );
    cbs.push(cb);
    connections.push({
      id: `${pv.id}-dc`, from: { kind: 'port', id: pv.id, port: 'dir' }, to: { kind: 'port', id: inv.id, port: 'cc' },
      conductor: 'dc', label: options.dcSection,
    });
    connections.push({
      id: `${inv.id}-ac`, from: { kind: 'port', id: inv.id, port: 'ca' }, to: { kind: 'port', id: cb.id, port: 'entrada' },
      label: options.branchSection,
    });
  }

  const gb = includeGB
    ? sym('breaker', X_GB, MID_TOP, 'Disjuntor Geral',
        [options.generalBreakerA ? `${options.generalBreakerA}A` : '', '(seccionamento — opcional)'].filter(Boolean))
    : null;
  // ── Padrão de entrada: disjuntor do padrão + medidor + DPS + placa ──
  const entryBreaker = sym('breaker', X_EB, MID_TOP, 'Disjuntor do Padrão', options.entryBreakerLegend ?? []);
  const meter = sym('meter-bidirectional', X_METER, MID_TOP, 'Medidor', options.meterLegend ?? []);
  // rótulo da rede com o nome da concessionária ("Rede – CPFL") — pedido do
  // usuário: o analista identifica de cara de quem é a rede do desenho
  const grid = sym('utility-grid', X_GRID, MID_TOP, options.utilityName ? `Rede – ${options.utilityName}` : 'Rede');

  // tronco: do disjuntor do 1º arranjo até o próximo elemento, dobrando no nó
  const trunkTo: ConnectionEndpoint = gb
    ? { kind: 'port', id: gb.id, port: 'entrada' }
    : { kind: 'port', id: entryBreaker.id, port: 'entrada' };
  const firstCbY = cbs[0].y + 10 * rowScale; // y da PORTA (placement já snapado à grade)
  const trunk: ManualConnection = {
    id: 'manual-trunk-arr',
    from: { kind: 'port', id: cbs[0].id, port: 'saida' },
    to: trunkTo,
    waypoints: n > 1 ? [{ x: X_JUNC, y: firstCbY }, { x: X_JUNC, y: midY }] : undefined,
    // depois da junção o tronco carrega a soma dos arranjos
    label: n > 1 ? options.trunkSection : options.branchSection,
  };
  connections.push(trunk);

  // demais arranjos entram como DERIVAÇÃO FORMAL no nó do tronco (•)
  if (n > 1) {
    const byId = new Map(placements.map(p => [p.id, p]));
    const allPts = computeAllConnectionPoints(connections, byId);
    const trunkPts = allPts.get(trunk.id)!;
    const junction = nearestPointOnPolyline({ x: X_JUNC, y: midY }, trunkPts)!;
    for (let i = 1; i < n; i++) {
      connections.push({
        id: `${cbs[i].id}-junc`,
        from: { kind: 'port', id: cbs[i].id, port: 'saida' },
        to: { kind: 'line', connId: trunk.id, t: junction.t },
        label: options.branchSection,
      });
    }
  }

  // trecho pós-junção (depois do disjuntor geral) até o disjuntor do padrão
  const busConnId = gb ? 'manual-bus-arr' : trunk.id;
  if (gb) {
    connections.push({
      id: busConnId,
      from: { kind: 'port', id: gb.id, port: 'saida' },
      to: { kind: 'port', id: entryBreaker.id, port: 'entrada' },
      label: options.trunkSection,
    });
  }
  // dentro do padrão: disjuntor do padrão → medidor → rede
  connections.push({
    id: 'manual-entry-arr',
    from: { kind: 'port', id: entryBreaker.id, port: 'saida' },
    to: { kind: 'port', id: meter.id, port: 'esq' },
  });
  connections.push({ id: 'manual-grid-arr', from: { kind: 'port', id: meter.id, port: 'dir' }, to: { kind: 'port', id: grid.id, port: 'esq' } });

  // DPS pós-junção (paralelo, abaixo) + cargas do local (referência, acima) +
  // DPS do padrão de entrada (paralelo ao disjuntor do padrão) — todos
  // derivações formais com t calculado da geometria real
  // depois do rótulo do disjuntor geral (senão a descida do DPS corta o texto)
  const dps = sym('dps', 144, MID_TOP + 26, 'DPS CA');
  // cargas ficam acima e à esquerda do padrão de entrada (rótulo não pode
  // colidir com o título da caixa "PADRÃO DE ENTRADA")
  const loadsPanel = includeLoads
    ? sym('distribution-panel', 128, MID_TOP - 46, 'Cargas do local', ['(apenas referência)'])
    : null;
  const entryDps = sym('dps', 168, MID_TOP + 26, 'DPS do Padrão');
  // placa de advertência: a FOTO REAL entra nativa no diagrama (pedido do
  // usuário — não é redesenho); sem ligação elétrica, dentro do bloco do padrão
  const plate = options.warningVariant === 'enel' ? WARNING_PLATE_ENEL : WARNING_PLATE_GENERIC;
  const photos: PlacedPhoto[] = [{
    id: uid('plate'), href: plate.href,
    // ACIMA do medidor: embaixo ela cobria os rótulos do disjuntor do padrão
    // e do DPS (os três dividem a mesma faixa de texto)
    x: X_METER + (24 - plate.w) / 2, y: MID_TOP - 28, w: plate.w, h: plate.h,
  }];
  {
    const byId = new Map(placements.map(p => [p.id, p]));
    const allPts = computeAllConnectionPoints(connections, byId);
    const busPts = allPts.get(busConnId)!;
    const tapT = (pts: Point[], x: number) => nearestPointOnPolyline({ x, y: midY }, pts)!.t;
    connections.push({
      id: 'manual-dps-arr',
      from: { kind: 'line', connId: busConnId, t: tapT(busPts, 156) },
      to: { kind: 'port', id: dps.id, port: 'topo' },
    });
    if (loadsPanel) {
      connections.push({
        id: 'manual-loads-arr',
        from: { kind: 'line', connId: busConnId, t: tapT(busPts, 152) },
        to: { kind: 'port', id: loadsPanel.id, port: 'entrada' },
      });
    }
    // DPS do padrão deriva do trecho disjuntor do padrão → medidor
    const entryPts = allPts.get('manual-entry-arr')!;
    connections.push({
      id: 'manual-entrydps-arr',
      from: { kind: 'line', connId: 'manual-entry-arr', t: tapT(entryPts, 180) },
      to: { kind: 'port', id: entryDps.id, port: 'topo' },
    });
  }

  // ── PLANTA DE LOCALIZAÇÃO (recorte de satélite do local) ────────────────
  const texts: PlacedText[] = [];
  if (options.locationMap) {
    // abaixo do cabeçalho da folha (título + subtítulo ocupam até ~28mm)
    const MAP = { x: 18, y: 36, w: 54, h: 38 };
    photos.push({ id: uid('planta'), href: options.locationMap.href, ...MAP });
    if (options.locationMap.caption) {
      texts.push({
        id: uid('planta-legenda'), value: options.locationMap.caption,
        x: MAP.x, y: MAP.y + MAP.h + 5, size: 2.2,
      });
    }
  }

  // Caixa de grupo do padrão de entrada — arrastar a caixa move o bloco todo.
  // Vai só até o medidor: a REDE fica fora (não faz parte do padrão) e a caixa
  // inteira mora à esquerda da coluna da legenda.
  const groups: PlacedGroup[] = [{
    id: uid('group'),
    title: 'PADRÃO DE ENTRADA',
    // engloba a placa (acima do medidor) e os rótulos dos DPS (abaixo)
    x: X_EB - 4, y: MID_TOP - 32, w: (X_METER + 24 + 4) - (X_EB - 4), h: 90,
    style: 'dashed', moveContents: true,
  }];
  if (options.locationMap) {
    groups.unshift({
      id: uid('group'),
      title: 'PLANTA DE LOCALIZAÇÃO',
      x: 15, y: 32, w: 60, h: options.locationMap.caption ? 50 : 46,
      style: 'solid', moveContents: true,
    });
  }

  return { placements, connections, photos, texts, groups, shapes: [] };
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

    const anchor = labelAnchor(p);
    const legendX = anchor.x;
    let legendY = anchor.y;
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

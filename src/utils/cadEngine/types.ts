/**
 * CAD Engine — tipos (fatia vertical mínima).
 *
 * Alpha interno, só para o master (ver src/components/projects/UnifilarTab.tsx).
 * Segue os princípios da proposta de arquitetura em
 * DIAGRAMA UNIFILAR/cad-engine-arquitetura.md, reduzidos ao necessário para
 * um caminho ponta a ponta: JSON técnico → layout FIXO (sem motor de
 * roteamento ainda) → Scene IR → exportadores SVG/PDF.
 *
 * A Scene IR (D1 da proposta) é o contrato entre layout e exportadores: um
 * exportador novo é ~1 arquivo, sem tocar em layout/símbolos.
 */

// ── JSON técnico (mínimo) ────────────────────────────────────────────────────

export type ComponentKind =
  | 'pv-array' | 'inverter' | 'breaker' | 'meter' | 'utility-grid' | 'dps';

export interface ComponentNode {
  id: string;
  kind: ComponentKind;
  label: string;
  /** Linhas de legenda já formatadas (a IR não sabe de i18n/unidades). */
  legend: string[];
}

export interface ConnectionEdge {
  id: string;
  from: string;
  to: string;
}

export interface TechnicalJsonMvp {
  documentId: string;
  title: {
    projectCode: string;
    holderName: string;
    concessionaire: string;
    installedPower: string;
    date: string;
  };
  components: ComponentNode[];
  connections: ConnectionEdge[];
}

// ── Scene IR (subconjunto de D1) ─────────────────────────────────────────────

export interface Point { x: number; y: number }

export type Primitive =
  | { kind: 'line'; a: Point; b: Point }
  | { kind: 'polyline'; points: Point[] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; center: Point; radius: number }
  | { kind: 'text'; at: Point; value: string; size: number; anchor: 'start' | 'middle' | 'end'; weight?: 'normal' | 'bold' }
  | { kind: 'image'; at: Point; w: number; h: number; href: string };

export type LayerId =
  | 'FRAME' | 'TITLE_BLOCK' | 'SYMBOLS' | 'CONDUCTOR_AC' | 'TEXT_LABEL' | 'PHOTO';

export interface ShapeNode {
  layer: LayerId;
  geometry: Primitive;
}

/** Instância de símbolo: um bloco reaproveitado (id do símbolo) numa posição. */
export interface BlockInstance {
  layer: LayerId;
  blockRef: ComponentKind;
  at: Point;
  /** Graus, sentido horário, em torno do centro do bloco (0/90/180/270). */
  rotation?: number;
}

export interface Scene {
  /** Papel em mm. A4 paisagem = 297×210. */
  paper: { widthMm: number; heightMm: number };
  shapes: ShapeNode[];
  blocks: BlockInstance[];
  /** Definições de bloco (símbolo → primitivas locais, origem em 0,0). */
  blockDefs: Record<ComponentKind, Primitive[]>;
}

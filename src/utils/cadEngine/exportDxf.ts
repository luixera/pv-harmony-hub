import { LayerId, Point, Primitive, Scene } from './types';
import { SYMBOL_BBOX } from './symbols';

/**
 * Scene → DXF (AutoCAD R12/AC1009 — o dialeto mais compatível: abre em
 * qualquer AutoCAD, QCAD, LibreCAD e nos visualizadores das concessionárias).
 *
 * Mesmo princípio dos exportadores SVG/PDF: a Scene é a única fonte de
 * verdade, este arquivo só serializa. Particularidades do DXF:
 * - Y cresce PRA CIMA (o inverso da Scene) — todo Y é espelhado na altura da
 *   folha; a unidade fica em mm (1 unidade DXF = 1 mm).
 * - Cada camada da Scene vira uma LAYER do DXF com cor ACI própria — quem
 *   abrir no CAD liga/desliga carimbo, condutores, símbolos etc.
 * - Tracejado vira o linetype DASHED (definido na tabela LTYPE).
 * - Blocos (símbolos) são ACHATADOS: as primitivas entram já transformadas
 *   (escala em torno do centro → rotação → posição, a MESMA ordem do
 *   blockTransform/exportPdf), sem BLOCK/INSERT — mais simples e todo CAD lê.
 * - Elipse é aproximada por polilinha (R12 não tem a entidade ELLIPSE).
 * - Fotos (primitiva image) ficam de fora — raster não entra neste DXF.
 */

/** Cor ACI (AutoCAD Color Index) por camada da Scene. */
const LAYER_ACI: Record<LayerId, number> = {
  FRAME: 8,             // cinza
  TITLE_BLOCK: 8,
  SYMBOLS: 7,           // branco/preto (cor "de destaque" do CAD)
  CONDUCTOR_AC: 1,      // vermelho
  CONDUCTOR_DC: 5,      // azul
  CONDUCTOR_GROUND: 3,  // verde
  TEXT_LABEL: 7,
  PHOTO: 8,             // (nunca usado — imagens não são exportadas)
  GROUP_BOX: 8,
  ANNOTATION: 8,
};

const LAYERS: LayerId[] = [
  'FRAME', 'TITLE_BLOCK', 'SYMBOLS', 'CONDUCTOR_AC', 'CONDUCTOR_DC', 'CONDUCTOR_GROUND',
  'TEXT_LABEL', 'GROUP_BOX', 'ANNOTATION',
];

function rotatePoint(p: Point, deg: number, cx: number, cy: number): Point {
  if (!deg) return p;
  const rad = (deg * Math.PI) / 180;
  const dx = p.x - cx, dy = p.y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}
function scalePoint(p: Point, s: number, cx: number, cy: number): Point {
  if (s === 1) return p;
  return { x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s };
}

const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

class DxfWriter {
  private out: string[] = [];
  private readonly h: number;
  constructor(paperHeightMm: number) { this.h = paperHeightMm; }
  /** Par código/valor — o átomo do formato DXF. */
  tag(code: number, value: string | number) { this.out.push(String(code), String(value)); }
  /** Y da Scene (pra baixo) → Y do DXF (pra cima). */
  flipY(y: number) { return this.h - y; }

  line(layer: LayerId, a: Point, b: Point, dashed?: boolean) {
    this.tag(0, 'LINE'); this.tag(8, layer);
    if (dashed) this.tag(6, 'DASHED');
    this.tag(10, num(a.x)); this.tag(20, num(this.flipY(a.y))); this.tag(30, 0);
    this.tag(11, num(b.x)); this.tag(21, num(this.flipY(b.y))); this.tag(31, 0);
  }
  circle(layer: LayerId, center: Point, r: number) {
    this.tag(0, 'CIRCLE'); this.tag(8, layer);
    this.tag(10, num(center.x)); this.tag(20, num(this.flipY(center.y))); this.tag(30, 0);
    this.tag(40, num(r));
  }
  text(layer: LayerId, at: Point, value: string, sizeMm: number, anchor: 'start' | 'middle' | 'end') {
    if (!value) return;
    this.tag(0, 'TEXT'); this.tag(8, layer);
    const height = sizeMm * 0.72; // font-size (mm) → altura de caixa-alta aproximada
    this.tag(10, num(at.x)); this.tag(20, num(this.flipY(at.y))); this.tag(30, 0);
    this.tag(40, num(height));
    this.tag(1, value);
    if (anchor !== 'start') {
      this.tag(72, anchor === 'middle' ? 1 : 2); // 1=center 2=right
      this.tag(11, num(at.x)); this.tag(21, num(this.flipY(at.y))); this.tag(31, 0);
    }
  }
  polylineAsLines(layer: LayerId, pts: Point[], dashed?: boolean) {
    for (let i = 0; i < pts.length - 1; i++) this.line(layer, pts[i], pts[i + 1], dashed);
  }

  header() {
    this.tag(0, 'SECTION'); this.tag(2, 'HEADER');
    this.tag(9, '$ACADVER'); this.tag(1, 'AC1009');
    this.tag(9, '$INSUNITS'); this.tag(70, 4); // milímetros
    this.tag(0, 'ENDSEC');
  }
  tables() {
    this.tag(0, 'SECTION'); this.tag(2, 'TABLES');
    // linetypes: contínuo + tracejado (mesmo padrão 2/1.4mm dos outros exports)
    this.tag(0, 'TABLE'); this.tag(2, 'LTYPE'); this.tag(70, 2);
    this.tag(0, 'LTYPE'); this.tag(2, 'CONTINUOUS'); this.tag(70, 0);
    this.tag(3, 'Solid line'); this.tag(72, 65); this.tag(73, 0); this.tag(40, 0);
    this.tag(0, 'LTYPE'); this.tag(2, 'DASHED'); this.tag(70, 0);
    this.tag(3, 'Dashed __ __ __'); this.tag(72, 65); this.tag(73, 2); this.tag(40, 3.4);
    this.tag(49, 2); this.tag(49, -1.4);
    this.tag(0, 'ENDTAB');
    // uma LAYER do DXF por camada da Scene, com a cor ACI dela
    this.tag(0, 'TABLE'); this.tag(2, 'LAYER'); this.tag(70, LAYERS.length);
    for (const layer of LAYERS) {
      this.tag(0, 'LAYER'); this.tag(2, layer); this.tag(70, 0);
      this.tag(62, LAYER_ACI[layer]); this.tag(6, 'CONTINUOUS');
    }
    this.tag(0, 'ENDTAB');
    this.tag(0, 'ENDSEC');
  }
  beginEntities() { this.tag(0, 'SECTION'); this.tag(2, 'ENTITIES'); }
  end() { this.tag(0, 'ENDSEC'); this.tag(0, 'EOF'); }
  toString() { return this.out.join('\n') + '\n'; }
}

function writePrimitive(
  w: DxfWriter, layer: LayerId, p: Primitive,
  dx = 0, dy = 0, rotDeg = 0, rotCenter: Point = { x: 0, y: 0 }, scale = 1,
) {
  const T = (pt: Point): Point => {
    const t = rotatePoint(scalePoint(pt, scale, rotCenter.x, rotCenter.y), rotDeg, rotCenter.x, rotCenter.y);
    return { x: t.x + dx, y: t.y + dy };
  };
  switch (p.kind) {
    case 'line':
      w.line(layer, T(p.a), T(p.b), p.dashed);
      break;
    case 'polyline':
      w.polylineAsLines(layer, p.points.map(T), p.dashed);
      break;
    case 'rect': {
      const corners = [
        { x: p.x, y: p.y }, { x: p.x + p.w, y: p.y },
        { x: p.x + p.w, y: p.y + p.h }, { x: p.x, y: p.y + p.h },
      ].map(T);
      for (let i = 0; i < 4; i++) w.line(layer, corners[i], corners[(i + 1) % 4], p.dashed);
      break;
    }
    case 'circle':
      w.circle(layer, T(p.center), p.radius * scale);
      break;
    case 'ellipse': {
      // R12 não tem ELLIPSE: aproxima com 32 segmentos
      const SEGS = 32;
      const pts: Point[] = [];
      for (let i = 0; i <= SEGS; i++) {
        const ang = (i / SEGS) * Math.PI * 2;
        pts.push(T({ x: p.center.x + p.rx * Math.cos(ang), y: p.center.y + p.ry * Math.sin(ang) }));
      }
      w.polylineAsLines(layer, pts, p.dashed);
      break;
    }
    case 'text':
      w.text(layer, T(p.at), p.value, p.size * scale, p.anchor);
      break;
    case 'image':
      break; // raster fica de fora do DXF
  }
}

export function sceneToDxf(scene: Scene): string {
  const w = new DxfWriter(scene.paper.heightMm);
  w.header();
  w.tables();
  w.beginEntities();
  for (const shape of scene.shapes) {
    writePrimitive(w, shape.layer, shape.geometry);
  }
  const blockCenter: Point = { x: SYMBOL_BBOX.w / 2, y: SYMBOL_BBOX.h / 2 };
  for (const block of scene.blocks) {
    for (const prim of scene.blockDefs[block.blockRef] ?? []) {
      writePrimitive(w, block.layer, prim, block.at.x, block.at.y, block.rotation ?? 0, blockCenter, block.scale ?? 1);
    }
  }
  w.end();
  return w.toString();
}

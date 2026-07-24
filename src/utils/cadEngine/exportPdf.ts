import { LayerId, Point, Primitive, Scene } from './types';
import { SYMBOL_BBOX } from './symbols';

/** Rotação padrão (mesma fórmula do `rotate()` do SVG), em torno de (cx,cy). */
function rotatePoint(p: Point, deg: number, cx: number, cy: number): Point {
  if (!deg) return p;
  const rad = (deg * Math.PI) / 180;
  const dx = p.x - cx, dy = p.y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Escala em torno de (cx,cy) — mesmo efeito do `translate(cx,cy) scale(s) translate(-cx,-cy)` do SVG. */
function scalePoint(p: Point, s: number, cx: number, cy: number): Point {
  if (s === 1) return p;
  return { x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s };
}

/**
 * Scene → PDF, via jsPDF (já usado em resumoPdf.ts — sem dependência nova).
 * Espelha exatamente as mesmas primitivas do exportador SVG: a Scene é a
 * única fonte de verdade do desenho, os dois exportadores só serializam.
 */

const LAYER_RGB: Record<LayerId, [number, number, number]> = {
  FRAME: [153, 153, 153],
  TITLE_BLOCK: [85, 85, 85],
  SYMBOLS: [26, 26, 26],
  CONDUCTOR_AC: [176, 39, 26],
  TEXT_LABEL: [51, 51, 51],
  PHOTO: [0, 0, 0],
  GROUP_BOX: [122, 122, 122],
};
const LAYER_WIDTH: Record<LayerId, number> = {
  FRAME: 0.5, TITLE_BLOCK: 0.3, SYMBOLS: 0.35, CONDUCTOR_AC: 0.4, TEXT_LABEL: 0.2, PHOTO: 0, GROUP_BOX: 0.3,
};

const DASH_MM = [2, 1.4]; // mesmo padrão de tracejado do exportador SVG

/** `data:image/jpeg;base64,...` → `JPEG` (formato que o jsPDF espera em `addImage`). */
function imageFormatFromDataUrl(href: string): string {
  const match = /^data:image\/(\w+);/.exec(href);
  const ext = (match?.[1] ?? 'jpeg').toLowerCase();
  return ext === 'jpg' ? 'JPEG' : ext.toUpperCase();
}

/**
 * `rotDeg`/`rotCenter`/`scale` transformam a geometria ANTES de aplicar
 * (dx,dy) — usado para girar/escalar os símbolos (bloco inteiro), em
 * coordenadas locais do bloco. Escala primeiro, depois gira — mesma ordem
 * do `transform` do SVG (`blockTransform()` em exportSvg.ts).
 */
function drawPrimitive(
  doc: import('jspdf').default, p: Primitive, rgb: [number, number, number], lineWidth: number,
  dx = 0, dy = 0, rotDeg = 0, rotCenter: Point = { x: 0, y: 0 }, scale = 1,
) {
  doc.setDrawColor(...rgb);
  doc.setTextColor(...rgb);
  doc.setLineWidth(lineWidth);
  const dashed = (p.kind === 'line' || p.kind === 'rect') && p.dashed;
  if (dashed) doc.setLineDashPattern(DASH_MM, 0);
  const R = (pt: Point) => rotatePoint(scalePoint(pt, scale, rotCenter.x, rotCenter.y), rotDeg, rotCenter.x, rotCenter.y);
  switch (p.kind) {
    case 'line': {
      const a = R(p.a), b = R(p.b);
      doc.line(a.x + dx, a.y + dy, b.x + dx, b.y + dy);
      break;
    }
    case 'polyline': {
      const pts = p.points.map(R);
      for (let i = 0; i < pts.length - 1; i++) {
        doc.line(pts[i].x + dx, pts[i].y + dy, pts[i + 1].x + dx, pts[i + 1].y + dy);
      }
      break;
    }
    case 'rect': {
      if (!rotDeg && scale === 1) { doc.rect(p.x + dx, p.y + dy, p.w, p.h); break; }
      // sem rotação/escala nativas de retângulo no jsPDF: desenha como 4 lados transformados
      const corners = [
        { x: p.x, y: p.y }, { x: p.x + p.w, y: p.y },
        { x: p.x + p.w, y: p.y + p.h }, { x: p.x, y: p.y + p.h },
      ].map(R);
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        doc.line(a.x + dx, a.y + dy, b.x + dx, b.y + dy);
      }
      break;
    }
    case 'circle': {
      const c = R(p.center);
      doc.circle(c.x + dx, c.y + dy, p.radius * scale);
      break;
    }
    case 'text': {
      const at = R(p.at);
      const align = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      doc.setFont('helvetica', p.weight === 'bold' ? 'bold' : 'normal');
      doc.setFontSize(p.size * 2.83 * scale); // mm → pt aproximado para o mesmo tamanho visual do SVG
      doc.text(p.value, at.x + dx, at.y + dy, { align });
      break;
    }
    case 'image': {
      // fotos não giram/escalam nesta fatia — rotDeg/scale sempre neutros para este tipo de primitiva
      doc.addImage(p.href, imageFormatFromDataUrl(p.href), p.at.x + dx, p.at.y + dy, p.w, p.h);
      break;
    }
  }
  if (dashed) doc.setLineDashPattern([], 0); // volta pro traço contínuo pras próximas primitivas
}

export async function sceneToPdfBlob(scene: Scene): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [scene.paper.widthMm, scene.paper.heightMm] });

  for (const shape of scene.shapes) {
    drawPrimitive(doc, shape.geometry, LAYER_RGB[shape.layer], LAYER_WIDTH[shape.layer]);
  }
  const blockCenter: Point = { x: SYMBOL_BBOX.w / 2, y: SYMBOL_BBOX.h / 2 };
  for (const block of scene.blocks) {
    const defs = scene.blockDefs[block.blockRef] ?? [];
    for (const prim of defs) {
      drawPrimitive(doc, prim, LAYER_RGB[block.layer], LAYER_WIDTH[block.layer], block.at.x, block.at.y, block.rotation ?? 0, blockCenter, block.scale ?? 1);
    }
  }

  return doc.output('blob');
}

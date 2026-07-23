import { LayerId, Primitive, Scene } from './types';

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
};
const LAYER_WIDTH: Record<LayerId, number> = {
  FRAME: 0.5, TITLE_BLOCK: 0.3, SYMBOLS: 0.35, CONDUCTOR_AC: 0.4, TEXT_LABEL: 0.2,
};

function drawPrimitive(doc: import('jspdf').default, p: Primitive, rgb: [number, number, number], lineWidth: number, dx = 0, dy = 0) {
  doc.setDrawColor(...rgb);
  doc.setTextColor(...rgb);
  doc.setLineWidth(lineWidth);
  switch (p.kind) {
    case 'line':
      doc.line(p.a.x + dx, p.a.y + dy, p.b.x + dx, p.b.y + dy);
      break;
    case 'polyline':
      for (let i = 0; i < p.points.length - 1; i++) {
        doc.line(p.points[i].x + dx, p.points[i].y + dy, p.points[i + 1].x + dx, p.points[i + 1].y + dy);
      }
      break;
    case 'rect':
      doc.rect(p.x + dx, p.y + dy, p.w, p.h);
      break;
    case 'circle':
      doc.circle(p.center.x + dx, p.center.y + dy, p.radius);
      break;
    case 'text': {
      const align = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      doc.setFont('helvetica', p.weight === 'bold' ? 'bold' : 'normal');
      doc.setFontSize(p.size * 2.83); // mm → pt aproximado para o mesmo tamanho visual do SVG
      doc.text(p.value, p.at.x + dx, p.at.y + dy, { align });
      break;
    }
  }
}

export async function sceneToPdfBlob(scene: Scene): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [scene.paper.widthMm, scene.paper.heightMm] });

  for (const shape of scene.shapes) {
    drawPrimitive(doc, shape.geometry, LAYER_RGB[shape.layer], LAYER_WIDTH[shape.layer]);
  }
  for (const block of scene.blocks) {
    const defs = scene.blockDefs[block.blockRef] ?? [];
    for (const prim of defs) {
      drawPrimitive(doc, prim, LAYER_RGB[block.layer], LAYER_WIDTH[block.layer], block.at.x, block.at.y);
    }
  }

  return doc.output('blob');
}

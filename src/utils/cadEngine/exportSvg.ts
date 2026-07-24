import { BlockInstance, LayerId, Point, Primitive, Scene } from './types';
import { SYMBOL_BBOX } from './symbols';

/** Scene → SVG. Serializador dedicado (não usa canvas/lib externa). */

const LAYER_COLOR: Record<LayerId, string> = {
  FRAME: '#999999',
  TITLE_BLOCK: '#555555',
  SYMBOLS: '#1A1A1A',
  CONDUCTOR_AC: '#B0271A',
  TEXT_LABEL: '#333333',
  PHOTO: 'transparent',
  GROUP_BOX: '#7A7A7A',
};
const LAYER_WIDTH: Record<LayerId, number> = {
  FRAME: 0.5, TITLE_BLOCK: 0.3, SYMBOLS: 0.35, CONDUCTOR_AC: 0.4, TEXT_LABEL: 0, PHOTO: 0, GROUP_BOX: 0.3,
};

function pts(points: Point[]): string {
  return points.map(p => `${p.x},${p.y}`).join(' ');
}

const DASH = '2,1.4'; // padrão de tracejado (mm) — igual no SVG e no PDF (setLineDashPattern)

export function primitiveToSvg(p: Primitive, color: string, strokeWidth: number): string {
  switch (p.kind) {
    case 'line':
      return `<line x1="${p.a.x}" y1="${p.a.y}" x2="${p.b.x}" y2="${p.b.y}" stroke="${color}" stroke-width="${strokeWidth}"${p.dashed ? ` stroke-dasharray="${DASH}"` : ''} />`;
    case 'polyline':
      return `<polyline points="${pts(p.points)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`;
    case 'rect':
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"${p.dashed ? ` stroke-dasharray="${DASH}"` : ''} />`;
    case 'circle':
      return `<circle cx="${p.center.x}" cy="${p.center.y}" r="${p.radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`;
    case 'text': {
      const weight = p.weight === 'bold' ? 'bold' : 'normal';
      return `<text x="${p.at.x}" y="${p.at.y}" font-size="${p.size}" text-anchor="${p.anchor}" font-weight="${weight}" font-family="Arial, sans-serif" fill="${color}">${escapeXml(p.value)}</text>`;
    }
    case 'image':
      return `<image x="${p.at.x}" y="${p.at.y}" width="${p.w}" height="${p.h}" href="${p.href}" preserveAspectRatio="none" />`;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * String de `transform` de um bloco: posiciona, gira e escala — nessa ordem
 * de efeito visual (escala em torno do centro, depois giro em torno do mesmo
 * centro, depois posiciona na página). Exportado para o canvas interativo
 * (`UnifilarTab.tsx`) usar exatamente a mesma matemática ao vivo.
 */
export function blockTransform(block: Pick<BlockInstance, 'at' | 'rotation' | 'scale'>): string {
  const cx = SYMBOL_BBOX.w / 2, cy = SYMBOL_BBOX.h / 2;
  const scale = block.scale ?? 1;
  const parts = [`translate(${block.at.x},${block.at.y})`];
  if (block.rotation) parts.push(`rotate(${block.rotation},${cx},${cy})`);
  if (scale !== 1) parts.push(`translate(${cx},${cy})`, `scale(${scale})`, `translate(${-cx},${-cy})`);
  return parts.join(' ');
}

/** Conteúdo interno (sem a tag <svg> em volta) — reaproveitado pelo canvas interativo. */
export function sceneToSvgInner(scene: Scene): string {
  const parts: string[] = [];
  for (const shape of scene.shapes) {
    parts.push(primitiveToSvg(shape.geometry, LAYER_COLOR[shape.layer], LAYER_WIDTH[shape.layer]));
  }
  for (const block of scene.blocks) {
    const defs = scene.blockDefs[block.blockRef] ?? [];
    const color = LAYER_COLOR[block.layer];
    const width = LAYER_WIDTH[block.layer];
    const inner = defs.map(p => primitiveToSvg(p, color, width)).join('');
    parts.push(`<g transform="${blockTransform(block)}">${inner}</g>`);
  }
  return parts.join('');
}

export function sceneToSvg(scene: Scene): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.paper.widthMm} ${scene.paper.heightMm}" width="${scene.paper.widthMm}mm" height="${scene.paper.heightMm}mm" style="background:#fff">${sceneToSvgInner(scene)}</svg>`;
}

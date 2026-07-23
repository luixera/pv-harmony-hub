import { Scene, TechnicalJsonMvp } from './types';
import { SYMBOL_BBOX, SYMBOL_DEFS } from './symbols';
import { CENTER_Y, drawFrameAndHeader, drawTitleBlock, LEGEND_LINE_H, PITCH_X, START_X } from './paper';

/**
 * TechnicalJsonMvp → Scene, com layout FIXO: componentes em fileira única,
 * espaçamento constante, sem grafo/roteador. É a base inicial antes de o
 * usuário arrastar/girar/religar manualmente (ver editableLayout.ts).
 */
export function buildUnifilarScene(json: TechnicalJsonMvp): Scene {
  const scene: Scene = { paper: { widthMm: 297, heightMm: 210 }, shapes: [], blocks: [], blockDefs: SYMBOL_DEFS };

  drawFrameAndHeader(scene, json);

  const positions = json.components.map((_, i) => ({ x: START_X + i * PITCH_X, y: CENTER_Y - SYMBOL_BBOX.h / 2 }));

  for (const conn of json.connections) {
    const iFrom = json.components.findIndex(c => c.id === conn.from);
    const iTo = json.components.findIndex(c => c.id === conn.to);
    if (iFrom < 0 || iTo < 0) continue;
    const a = positions[iFrom], b = positions[iTo];
    const yMid = a.y + SYMBOL_BBOX.h / 2;
    scene.shapes.push({
      layer: 'CONDUCTOR_AC',
      geometry: { kind: 'line', a: { x: a.x + SYMBOL_BBOX.w, y: yMid }, b: { x: b.x, y: yMid } },
    });
  }

  json.components.forEach((comp, i) => {
    const pos = positions[i];
    scene.blocks.push({ layer: 'SYMBOLS', blockRef: comp.kind, at: pos });

    const legendX = pos.x + SYMBOL_BBOX.w / 2;
    let legendY = pos.y + SYMBOL_BBOX.h + 5;
    scene.shapes.push({
      layer: 'TEXT_LABEL',
      geometry: { kind: 'text', at: { x: legendX, y: legendY }, value: comp.label, size: 2.6, anchor: 'middle', weight: 'bold' },
    });
    for (const line of comp.legend) {
      legendY += LEGEND_LINE_H;
      scene.shapes.push({
        layer: 'TEXT_LABEL',
        geometry: { kind: 'text', at: { x: legendX, y: legendY }, value: line, size: 2.4, anchor: 'middle' },
      });
    }
  });

  drawTitleBlock(scene, json);
  return scene;
}

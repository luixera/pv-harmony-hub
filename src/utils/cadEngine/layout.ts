import { Scene, TechnicalJsonMvp } from './types';
import { SYMBOL_BBOX, SYMBOL_DEFS } from './symbols';

/**
 * TechnicalJsonMvp → Scene, com layout FIXO: componentes em fileira única,
 * espaçamento constante, sem grafo/roteador. É a simplificação deliberada
 * desta fatia vertical (ver DIAGRAMA UNIFILAR/cad-engine-arquitetura.md §7
 * para o motor de layout automático completo, ainda não construído).
 */

const PAPER = { widthMm: 297, heightMm: 210 }; // A4 paisagem
const MARGIN = 12;
const TITLE_BLOCK_H = 26;
const PITCH_X = SYMBOL_BBOX.w + 22;
const LEGEND_LINE_H = 3.6;

export function buildUnifilarScene(json: TechnicalJsonMvp): Scene {
  const scene: Scene = {
    paper: PAPER,
    shapes: [],
    blocks: [],
    blockDefs: SYMBOL_DEFS,
  };

  // Moldura (frame) — simplificada, sem canhoto ABNT nesta fase.
  scene.shapes.push({
    layer: 'FRAME',
    geometry: { kind: 'rect', x: MARGIN, y: MARGIN, w: PAPER.widthMm - MARGIN * 2, h: PAPER.heightMm - MARGIN * 2 },
  });

  // Cabeçalho.
  scene.shapes.push({
    layer: 'TEXT_LABEL',
    geometry: { kind: 'text', at: { x: MARGIN + 5, y: MARGIN + 9 }, value: 'DIAGRAMA UNIFILAR (alpha)', size: 5, anchor: 'start', weight: 'bold' },
  });
  scene.shapes.push({
    layer: 'TEXT_LABEL',
    geometry: { kind: 'text', at: { x: MARGIN + 5, y: MARGIN + 15 }, value: `${json.title.projectCode} · ${json.title.holderName}`, size: 3.2, anchor: 'start' },
  });

  // Área de desenho: entre o cabeçalho e o quadro de legendas no rodapé.
  const drawTop = MARGIN + 22;
  const drawBottom = PAPER.heightMm - MARGIN - TITLE_BLOCK_H - 6;
  const centerY = drawTop + (drawBottom - drawTop) / 2 - SYMBOL_BBOX.h / 2;

  const startX = MARGIN + 14;
  const positions = json.components.map((_, i) => ({ x: startX + i * PITCH_X, y: centerY }));

  // Condutores: linha reta entre o centro-direita de um bloco e o centro-esquerda do próximo.
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

  // Símbolos + legendas.
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

  // Quadro de legenda / carimbo (rodapé) — campos essenciais do projeto.
  const tbY = PAPER.heightMm - MARGIN - TITLE_BLOCK_H;
  const tbX = MARGIN;
  const tbW = PAPER.widthMm - MARGIN * 2;
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'rect', x: tbX, y: tbY, w: tbW, h: TITLE_BLOCK_H } });
  const fields: [string, string][] = [
    ['CLIENTE', json.title.holderName],
    ['CONCESSIONÁRIA', json.title.concessionaire],
    ['POTÊNCIA INSTALADA', json.title.installedPower],
    ['DATA', json.title.date],
  ];
  const colW = tbW / fields.length;
  fields.forEach(([label, value], i) => {
    const cx = tbX + i * colW;
    if (i > 0) scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: cx, y: tbY }, b: { x: cx, y: tbY + TITLE_BLOCK_H } } });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: cx + 3, y: tbY + 9 }, value: label, size: 2.4, anchor: 'start' } });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: cx + 3, y: tbY + 17 }, value: value, size: 3.4, anchor: 'start', weight: 'bold' } });
  });

  return scene;
}

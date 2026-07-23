import { Scene, TechnicalJsonMvp } from './types';

/** Constantes de papel/margem compartilhadas entre o layout fixo e o editável. */
export const PAPER = { widthMm: 297, heightMm: 210 }; // A4 paisagem
export const MARGIN = 12;
export const TITLE_BLOCK_H = 26;
export const PITCH_X = 46; // largura do símbolo (24) + espaçamento (22)
export const LEGEND_LINE_H = 3.6;
export const DRAW_TOP = MARGIN + 22;
export const DRAW_BOTTOM = PAPER.heightMm - MARGIN - TITLE_BLOCK_H - 6;
export const CENTER_Y = DRAW_TOP + (DRAW_BOTTOM - DRAW_TOP) / 2;
export const START_X = MARGIN + 14;

/** Moldura + cabeçalho — igual no layout fixo e no editável. */
export function drawFrameAndHeader(scene: Scene, json: TechnicalJsonMvp) {
  scene.shapes.push({
    layer: 'FRAME',
    geometry: { kind: 'rect', x: MARGIN, y: MARGIN, w: PAPER.widthMm - MARGIN * 2, h: PAPER.heightMm - MARGIN * 2 },
  });
  scene.shapes.push({
    layer: 'TEXT_LABEL',
    geometry: { kind: 'text', at: { x: MARGIN + 5, y: MARGIN + 9 }, value: 'DIAGRAMA UNIFILAR (alpha)', size: 5, anchor: 'start', weight: 'bold' },
  });
  scene.shapes.push({
    layer: 'TEXT_LABEL',
    geometry: { kind: 'text', at: { x: MARGIN + 5, y: MARGIN + 15 }, value: `${json.title.projectCode} · ${json.title.holderName}`, size: 3.2, anchor: 'start' },
  });
}

/** Quadro de legenda / carimbo no rodapé — igual no layout fixo e no editável. */
export function drawTitleBlock(scene: Scene, json: TechnicalJsonMvp) {
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
}

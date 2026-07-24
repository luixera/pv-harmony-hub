import { ComponentKind, Scene, TechnicalJsonMvp } from './types';
import { KIND_LEGEND } from './symbols';

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

/** Coluna reservada da tabela de LEGENDA (lado direito da folha). O
 *  desenho "útil" vai de START_X até LEGEND_X0 — `layoutFromRecognition`
 *  comprime o espaçamento pra caber nessa faixa. */
export const LEGEND_W = 50;
export const LEGEND_X0 = PAPER.widthMm - MARGIN - LEGEND_W; // 235

/** Campos editáveis da folha (carimbo/legenda) — persistidos no
 *  `DiagramSceneState.sheet`. Todos aceitam tags `{chave}` do projeto. */
export interface SheetOptions {
  respTecnico?: string;
  art?: string;
  revisao?: string;
  /** Tabela de legenda automática no lado direito (default: ligada). */
  showLegend?: boolean;
}

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

/**
 * Carimbo no rodapé — 2 linhas × 4 colunas, no padrão dos carimbos de
 * unifilares reais: identificação do titular/instalação em cima,
 * responsabilidade técnica embaixo. `sheet` (resp. técnico/ART/revisão) é
 * editável por diagrama; valores já chegam com as tags resolvidas.
 */
export function drawTitleBlock(scene: Scene, json: TechnicalJsonMvp, sheet?: SheetOptions) {
  const tbY = PAPER.heightMm - MARGIN - TITLE_BLOCK_H;
  const tbX = MARGIN;
  const tbW = PAPER.widthMm - MARGIN * 2;
  const rowH = TITLE_BLOCK_H / 2;
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'rect', x: tbX, y: tbY, w: tbW, h: TITLE_BLOCK_H } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: tbX, y: tbY + rowH }, b: { x: tbX + tbW, y: tbY + rowH } } });

  // [rótulo, valor, fração da largura] — larguras diferentes por linha (endereço precisa de mais).
  const rows: [string, string, number][][] = [
    [
      ['TITULAR', json.title.holderName, 0.24],
      ['ENDEREÇO', json.title.address || '—', 0.36],
      ['CONCESSIONÁRIA', json.title.concessionaire, 0.22],
      ['POTÊNCIA INSTALADA', json.title.installedPower, 0.18],
    ],
    [
      ['RESP. TÉCNICO', sheet?.respTecnico || '—', 0.36],
      ['ART', sheet?.art || '—', 0.24],
      ['DATA', json.title.date, 0.22],
      ['REVISÃO', sheet?.revisao || '00', 0.18],
    ],
  ];

  rows.forEach((fields, r) => {
    const y = tbY + r * rowH;
    let x = tbX;
    fields.forEach(([label, value, frac], i) => {
      const w = tbW * frac;
      if (i > 0) scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x, y }, b: { x, y: y + rowH } } });
      scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x + 2.5, y: y + 4.6 }, value: label, size: 2, anchor: 'start' } });
      // valor truncado se estourar a célula (~0.52mm por caractere no tamanho 3)
      const maxChars = Math.floor((w - 5) / 1.56);
      const shown = value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1))}…` : value;
      scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x + 2.5, y: y + 10 }, value: shown, size: 3, anchor: 'start', weight: 'bold' } });
      x += w;
    });
  });
}

/**
 * Tabela de LEGENDA automática (lado direito da folha): um mini-símbolo +
 * descrição por tipo de componente efetivamente usado no diagrama — mesma
 * estrutura da legenda dos unifilares reais usados como referência. Gerada
 * do próprio conteúdo, nunca precisa ser mantida à mão.
 */
export function drawLegendTable(scene: Scene, usedKinds: ComponentKind[]) {
  if (usedKinds.length === 0) return;
  const x0 = LEGEND_X0;
  const y0 = MARGIN + 18;
  const headerH = 5.5, colHeaderH = 4.5, rowH = 8;
  const symbolColW = 11;
  const totalH = headerH + colHeaderH + usedKinds.length * rowH;

  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'rect', x: x0, y: y0, w: LEGEND_W, h: totalH } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + LEGEND_W / 2, y: y0 + 4 }, value: 'LEGENDA', size: 3, anchor: 'middle', weight: 'bold' } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: y0 + headerH }, b: { x: x0 + LEGEND_W, y: y0 + headerH } } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + symbolColW / 2, y: y0 + headerH + 3.3 }, value: 'SÍMBOLO', size: 1.8, anchor: 'middle' } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + symbolColW + 2, y: y0 + headerH + 3.3 }, value: 'DESCRIÇÃO', size: 1.8, anchor: 'start' } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: y0 + headerH + colHeaderH }, b: { x: x0 + LEGEND_W, y: y0 + headerH + colHeaderH } } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0 + symbolColW, y: y0 + headerH }, b: { x: x0 + symbolColW, y: y0 + totalH } } });

  const SYMBOL_SCALE = 0.3; // 24×20mm → 7.2×6mm, cabe na célula de 11×8
  usedKinds.forEach((kind, i) => {
    const rowY = y0 + headerH + colHeaderH + i * rowH;
    if (i > 0) scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: rowY }, b: { x: x0 + LEGEND_W, y: rowY } } });
    // bloco escalado: `at` é o canto sup-esq; a escala é em torno do centro do
    // bloco (ver blockTransform), então compensa pra centralizar na célula
    const cx = x0 + symbolColW / 2, cy = rowY + rowH / 2;
    scene.blocks.push({
      layer: 'SYMBOLS', blockRef: kind,
      at: { x: cx - 12, y: cy - 10 }, // 12/10 = metade do bbox 24×20 (centro do bloco na célula)
      rotation: 0, scale: SYMBOL_SCALE,
    });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + symbolColW + 2, y: rowY + rowH / 2 + 0.8 }, value: KIND_LEGEND[kind], size: 1.7, anchor: 'start' } });
  });
}

import { ComponentKind, Scene, TechnicalJsonMvp } from './types';
import { KIND_LEGEND } from './symbols';

/**
 * Formatos de prancha. O tamanho **se adapta ao projeto** (pedido do usuário):
 * A4 para o projeto comum e A3 só quando o desenho realmente precisa — muitos
 * arranjos, ou a seguimentação de microinversores com mais de um ramal. Quem
 * decide é `pickPaper()` no builder; o tamanho escolhido viaja na cena
 * (`Scene.paper`) e no estado do diagrama (`sheet.paper`), então editor e
 * exportadores usam sempre a folha certa.
 */
export interface PaperMm { widthMm: number; heightMm: number }
export const PAPERS: Record<"A4" | "A3", PaperMm> = {
  A4: { widthMm: 297, heightMm: 210 },
  A3: { widthMm: 420, heightMm: 297 },
};
export type PaperSize = keyof typeof PAPERS;

/** Folha padrão (A4) — usada quando o diagrama não diz qual é a dele. */
export const PAPER = PAPERS.A4;

export const paperOf = (size?: PaperSize | null) => PAPERS[size ?? 'A4'] ?? PAPERS.A4;
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
export const LEGEND_W = 52;
export const LEGEND_X0 = PAPER.widthMm - MARGIN - LEGEND_W; // 233 em A4 (padrão)
/** Início da coluna da legenda na folha informada. */
export const legendX0Of = (size?: PaperSize | null) => paperOf(size).widthMm - MARGIN - LEGEND_W;

/** Campos editáveis da folha (carimbo/legenda) — persistidos no
 *  `DiagramSceneState.sheet`. Todos aceitam tags `{chave}` do projeto. */
export interface SheetOptions {
  /** Folha do diagrama — A4 (padrão) ou A3 quando o desenho precisa. */
  paper?: PaperSize;
  respTecnico?: string;
  art?: string;
  revisao?: string;
  /** Tabela de legenda automática no lado direito (default: ligada). */
  showLegend?: boolean;

  // ── Carimbo completo (ago/2026) ──────────────────────────────────────────
  // A prancha que a concessionária recebe é conferida por um analista: ele
  // procura UC, ART/TRT, escala, revisão e folha em campos próprios. Sem eles
  // o desenho parece rascunho, por mais correto que o traço esteja.
  /** Empresa/profissional responsável (topo esquerdo do carimbo). */
  empresa?: string;
  /** Título do desenho — default "DIAGRAMA UNIFILAR — SISTEMA FOTOVOLTAICO". */
  tituloDesenho?: string;
  /** Unidade consumidora. */
  uc?: string;
  /** Código do desenho (ex.: FV-001). */
  numeroDesenho?: string;
  /** Escala — em unifilar é sempre "SEM ESCALA". */
  escala?: string;
  /** Unidade das cotas (mm). */
  unidade?: string;
  /** Folha, no formato "1/1". */
  folha?: string;

  // ── Tabelas da coluna direita ────────────────────────────────────────────
  /** DADOS TÉCNICOS: pares [rótulo, valor]. */
  dadosTecnicos?: [string, string][];
  /** MEMÓRIA DE CÁLCULO: pares [rótulo, valor] — vêm do Motor de Engenharia. */
  memoriaCalculo?: [string, string][];
  /** ARRANJO FOTOVOLTAICO: uma linha por string (MPPT · string → módulos). */
  arranjoStrings?: [string, string][];
  /** Liga/desliga as duas tabelas (default: ligadas quando há dados). */
  showTables?: boolean;

  // ── Notas do rodapé ──────────────────────────────────────────────────────
  /** NOTAS/OBSERVAÇÕES numeradas — cada uma citando a norma quando cabe. */
  notas?: string[];
  /** Liga/desliga o quadro de notas (default: ligado quando há notas). */
  showNotes?: boolean;
}

/** Largura do carimbo dentro da faixa do rodapé (o resto vira quadro de notas). */
const TITLE_BLOCK_W_FRAC = 0.55;

/** Quebra `texto` em linhas de no máximo `maxChars`, sem cortar palavra. */
function wrapText(texto: string, maxChars: number): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = '';
  for (const p of palavras) {
    const candidata = atual ? `${atual} ${p}` : p;
    if (candidata.length <= maxChars) { atual = candidata; continue; }
    if (atual) linhas.push(atual);
    atual = p;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Moldura + cabeçalho — igual no layout fixo e no editável. */
export function drawFrameAndHeader(scene: Scene, json: TechnicalJsonMvp) {
  scene.shapes.push({
    layer: 'FRAME',
    geometry: { kind: 'rect', x: MARGIN, y: MARGIN, w: scene.paper.widthMm - MARGIN * 2, h: scene.paper.heightMm - MARGIN * 2 },
  });
  scene.shapes.push({
    layer: 'TEXT_LABEL',
    // sem "(alpha)": esta folha é entregue à concessionária, o título é do documento
    geometry: { kind: 'text', at: { x: MARGIN + 5, y: MARGIN + 9 }, value: 'DIAGRAMA UNIFILAR', size: 5, anchor: 'start', weight: 'bold' },
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
  const faixaY = scene.paper.heightMm - MARGIN - TITLE_BLOCK_H;
  const faixaX = MARGIN;
  const faixaW = scene.paper.widthMm - MARGIN * 2;

  // O rodapé é uma FAIXA dividida: notas à esquerda, carimbo à direita — é o
  // arranjo dos unifilares aprovados que usamos de referência. Sem notas, o
  // carimbo ocupa a faixa inteira (nada de espaço morto na folha).
  const notas = (sheet?.showNotes !== false ? sheet?.notas : undefined) ?? [];
  const temNotas = notas.length > 0;
  const tbW = temNotas ? faixaW * TITLE_BLOCK_W_FRAC : faixaW;
  const tbX = faixaX + (faixaW - tbW);

  if (temNotas) drawNotesBox(scene, faixaX, faixaY, faixaW - tbW - 2, TITLE_BLOCK_H, notas);

  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'rect', x: tbX, y: faixaY, w: tbW, h: TITLE_BLOCK_H } });

  // 4 linhas: identificação (2), responsabilidade técnica (1), controle (1).
  // O analista da concessionária procura UC, ART/TRT, revisão e folha em
  // campos próprios — sem eles a prancha passa impressão de rascunho.
  const rows: [string, string, number][][] = [
    [
      ['EMPRESA / PROFISSIONAL', sheet?.empresa || '—', 0.55],
      ['CLIENTE / PROPRIETÁRIO', json.title.holderName, 0.45],
    ],
    [
      ['TÍTULO DO DESENHO', sheet?.tituloDesenho || 'DIAGRAMA UNIFILAR — SISTEMA FOTOVOLTAICO', 0.55],
      ['LOCAL', json.title.address || '—', 0.45],
    ],
    [
      ['RESP. TÉCNICO / ASSINATURA', sheet?.respTecnico || '—', 0.34],
      ['ART / TRT', sheet?.art || '—', 0.22],
      ['UC', sheet?.uc || '—', 0.20],
      ['DISTRIBUIDORA', json.title.concessionaire, 0.24],
    ],
    [
      ['ESCALA', sheet?.escala || 'SEM ESCALA', 0.22],
      ['DATA', json.title.date, 0.20],
      ['UNID.', sheet?.unidade || 'mm', 0.10],
      ['Nº DO DESENHO', sheet?.numeroDesenho || 'FV-001', 0.24],
      ['REV.', sheet?.revisao || '00', 0.10],
      ['FOLHA', sheet?.folha || '1/1', 0.14],
    ],
  ];

  const rowH = TITLE_BLOCK_H / rows.length;
  rows.forEach((fields, r) => {
    const y = faixaY + r * rowH;
    if (r > 0) scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: tbX, y }, b: { x: tbX + tbW, y } } });
    let x = tbX;
    fields.forEach(([label, value, frac], i) => {
      const w = tbW * frac;
      if (i > 0) scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x, y }, b: { x, y: y + rowH } } });
      scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x + 1.6, y: y + 2.4 }, value: label, size: 1.6, anchor: 'start' } });
      // valor truncado se estourar a célula (~1.35mm por caractere no tamanho 2.6)
      const maxChars = Math.max(1, Math.floor((w - 3.2) / 1.35));
      const shown = value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1))}…` : value;
      scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x + 1.6, y: y + rowH - 1.6 }, value: shown, size: 2.6, anchor: 'start', weight: 'bold' } });
      x += w;
    });
  });
}

/**
 * NOTAS / OBSERVAÇÕES — o quadro numerado do rodapé.
 *
 * É o que transforma o desenho em documento defensável: cada nota carrega a
 * norma que a sustenta (NBR 5410, NBR 16690, PRODIST, INMETRO), e é o primeiro
 * lugar onde o analista da concessionária procura a justificativa de uma
 * escolha. Cabe o que couber na faixa; o que sobrar é cortado com reticências
 * em vez de invadir o desenho.
 */
function drawNotesBox(scene: Scene, x: number, y: number, w: number, h: number, notas: string[]) {
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'rect', x, y, w, h } });
  const headerH = 4;
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x + w / 2, y: y + 2.9 }, value: 'NOTAS / OBSERVAÇÕES', size: 2.2, anchor: 'middle', weight: 'bold' } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x, y: y + headerH }, b: { x: x + w, y: y + headerH } } });

  const lineH = 2.1;
  const maxLinhas = Math.floor((h - headerH - 1.5) / lineH);
  const maxChars = Math.max(20, Math.floor((w - 5) / 0.82)); // ~0.82mm por caractere no tamanho 1.6
  const linhas: string[] = [];
  notas.forEach((nota, i) => {
    const prefixo = `${i + 1}. `;
    wrapText(nota, maxChars - prefixo.length).forEach((linha, k) => {
      linhas.push(k === 0 ? prefixo + linha : `   ${linha}`);
    });
  });
  const mostradas = linhas.slice(0, maxLinhas);
  if (linhas.length > maxLinhas && mostradas.length > 0) {
    mostradas[mostradas.length - 1] = `${mostradas[mostradas.length - 1].slice(0, Math.max(0, maxChars - 4))} (…)`;
  }
  mostradas.forEach((linha, i) => {
    scene.shapes.push({
      layer: 'TITLE_BLOCK',
      geometry: { kind: 'text', at: { x: x + 2, y: y + headerH + 2 + i * lineH }, value: linha, size: 1.6, anchor: 'start' },
    });
  });
}

/**
 * DADOS TÉCNICOS + MEMÓRIA DE CÁLCULO — as duas tabelas da coluna direita.
 *
 * A memória de cálculo na própria prancha é o que separa um desenho bonito de
 * um documento de engenharia: mostra COMO se chegou na bitola e no disjuntor,
 * ali, sem abrir o memorial. Todos esses números já saem do Motor de
 * Engenharia; aqui eles só são desenhados.
 *
 * Devolve o Y onde a legenda deve começar (abaixo da última tabela).
 */
export function drawInfoTables(scene: Scene, sheet?: SheetOptions): number {
  const y0 = MARGIN + 18;
  if (sheet?.showTables === false) return y0;
  const blocos: [string, [string, string][]][] = [
    ['DADOS TÉCNICOS', sheet?.dadosTecnicos ?? []],
    // logo abaixo dos dados: é a informação que o analista cruza com o desenho
    ['ARRANJO FOTOVOLTAICO', sheet?.arranjoStrings ?? []],
    ['MEMÓRIA DE CÁLCULO', sheet?.memoriaCalculo ?? []],
  ];
  const x0 = scene.paper.widthMm - MARGIN - LEGEND_W;
  const headerH = 4.4, rowH = 3.6, labelW = LEGEND_W * 0.52;
  // teto: as tabelas não podem empurrar a legenda para dentro do carimbo
  const limiteY = scene.paper.heightMm - MARGIN - TITLE_BLOCK_H - 26;

  let y = y0;
  for (const [titulo, linhas] of blocos) {
    if (linhas.length === 0) continue;
    const cabem = Math.max(0, Math.min(linhas.length, Math.floor((limiteY - y - headerH) / rowH)));
    if (cabem === 0) break;
    const usadas = linhas.slice(0, cabem);
    const alturaTotal = headerH + usadas.length * rowH;

    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'rect', x: x0, y, w: LEGEND_W, h: alturaTotal } });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + LEGEND_W / 2, y: y + 3.1 }, value: titulo, size: 2.4, anchor: 'middle', weight: 'bold' } });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: y + headerH }, b: { x: x0 + LEGEND_W, y: y + headerH } } });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0 + labelW, y: y + headerH }, b: { x: x0 + labelW, y: y + alturaTotal } } });

    usadas.forEach(([rotulo, valor], i) => {
      const linhaY = y + headerH + i * rowH;
      if (i > 0) scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: linhaY }, b: { x: x0 + LEGEND_W, y: linhaY } } });
      const corta = (s: string, larguraMm: number) => {
        const max = Math.max(1, Math.floor((larguraMm - 2.4) / 0.95));
        return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
      };
      scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + 1.2, y: linhaY + rowH - 1.1 }, value: corta(rotulo, labelW), size: 1.8, anchor: 'start' } });
      scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + labelW + 1.2, y: linhaY + rowH - 1.1 }, value: corta(valor, LEGEND_W - labelW), size: 1.8, anchor: 'start', weight: 'bold' } });
    });

    y += alturaTotal + 2.5;
  }
  return y;
}

/**
 * Tabela de LEGENDA automática (lado direito da folha): um mini-símbolo +
 * descrição por tipo de componente efetivamente usado no diagrama — mesma
 * estrutura da legenda dos unifilares reais usados como referência. Gerada
 * do próprio conteúdo, nunca precisa ser mantida à mão.
 */
export function drawLegendTable(
  scene: Scene,
  usedKinds: ComponentKind[],
  usedConductors: ('ac' | 'dc' | 'ground')[] = [],
  y0Param?: number,
) {
  // condutores CA-únicos não precisam de linha na legenda (é o padrão do desenho inteiro)
  const conductorRows = usedConductors.length > 1 ? usedConductors : [];
  if (usedKinds.length === 0 && conductorRows.length === 0) return;
  // a coluna acompanha a folha da CENA (A4 ou A3)
  const x0 = scene.paper.widthMm - MARGIN - LEGEND_W;
  const y0 = y0Param ?? (MARGIN + 18);

  // Com as tabelas de dados acima, a legenda em coluna única não caberia até o
  // carimbo. Nesse caso ela vira DUAS colunas de símbolo+descrição — que é,
  // aliás, como as pranchas de referência resolvem o mesmo aperto.
  const alturaDisponivel = scene.paper.heightMm - MARGIN - TITLE_BLOCK_H - 3 - y0;
  const alturaSimples = 5.5 + 4.5 + usedKinds.length * 8 + conductorRows.length * 5;
  if (alturaSimples > alturaDisponivel && usedKinds.length > 2) {
    drawLegendTableDuasColunas(scene, usedKinds, conductorRows, x0, y0, alturaDisponivel);
    return;
  }

  const headerH = 5.5, colHeaderH = 4.5, rowH = 8;
  const conductorRowH = 5;
  const symbolColW = 11;
  const totalH = headerH + colHeaderH + usedKinds.length * rowH + conductorRows.length * conductorRowH;

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

  // linhas dos tipos de condutor usados: amostra do traço na cor/estilo da
  // camada correspondente + descrição (só quando há mais de um tipo em uso)
  const CONDUCTOR_ROWS: Record<'ac' | 'dc' | 'ground', { layer: 'CONDUCTOR_AC' | 'CONDUCTOR_DC' | 'CONDUCTOR_GROUND'; label: string; dashed?: boolean }> = {
    ac: { layer: 'CONDUCTOR_AC', label: 'CONDUTOR CA' },
    dc: { layer: 'CONDUCTOR_DC', label: 'CONDUTOR CC' },
    ground: { layer: 'CONDUCTOR_GROUND', label: 'CONDUTOR DE ATERRAMENTO', dashed: true },
  };
  conductorRows.forEach((type, i) => {
    const def = CONDUCTOR_ROWS[type];
    const rowY = y0 + headerH + colHeaderH + usedKinds.length * rowH + i * conductorRowH;
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: rowY }, b: { x: x0 + LEGEND_W, y: rowY } } });
    const midY = rowY + conductorRowH / 2;
    scene.shapes.push({ layer: def.layer, geometry: { kind: 'line', a: { x: x0 + 1.5, y: midY }, b: { x: x0 + symbolColW - 1.5, y: midY }, dashed: def.dashed } });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + symbolColW + 2, y: midY + 0.8 }, value: def.label, size: 1.7, anchor: 'start' } });
  });
}

/**
 * Legenda em DUAS colunas — usada quando as tabelas de dados ocupam a parte de
 * cima da faixa e a legenda de coluna única não caberia até o carimbo.
 * Mesmo conteúdo, metade da altura.
 */
function drawLegendTableDuasColunas(
  scene: Scene,
  usedKinds: ComponentKind[],
  conductorRows: ('ac' | 'dc' | 'ground')[],
  x0: number,
  y0: number,
  alturaDisponivel: number,
) {
  const headerH = 4.4, rowH = 6, colW = LEGEND_W / 2, symbolW = 7;
  const maxLinhas = Math.max(1, Math.floor((alturaDisponivel - headerH - conductorRows.length * 4.2) / rowH));
  const linhas = Math.min(Math.ceil(usedKinds.length / 2), maxLinhas);
  const mostrados = usedKinds.slice(0, linhas * 2);
  const alturaTotal = headerH + linhas * rowH + conductorRows.length * 4.2;

  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'rect', x: x0, y: y0, w: LEGEND_W, h: alturaTotal } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + LEGEND_W / 2, y: y0 + 3.1 }, value: 'LEGENDA', size: 2.4, anchor: 'middle', weight: 'bold' } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: y0 + headerH }, b: { x: x0 + LEGEND_W, y: y0 + headerH } } });
  scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0 + colW, y: y0 + headerH }, b: { x: x0 + colW, y: y0 + headerH + linhas * rowH } } });

  const SYMBOL_SCALE = 0.22; // 24×20mm → 5.3×4.4mm, cabe na célula de 7×6
  mostrados.forEach((kind, i) => {
    const col = i % 2, lin = Math.floor(i / 2);
    const cellX = x0 + col * colW;
    const cellY = y0 + headerH + lin * rowH;
    if (col === 0 && lin > 0) {
      scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: cellY }, b: { x: x0 + LEGEND_W, y: cellY } } });
    }
    // o bloco escala em torno do CENTRO do bbox 24×20 → compensa pra centralizar
    scene.blocks.push({
      layer: 'SYMBOLS', blockRef: kind,
      at: { x: cellX + symbolW / 2 - 12, y: cellY + rowH / 2 - 10 },
      rotation: 0, scale: SYMBOL_SCALE,
    });
    const rotulo = KIND_LEGEND[kind];
    const max = Math.floor((colW - symbolW - 1.6) / 0.85);
    scene.shapes.push({
      layer: 'TITLE_BLOCK',
      geometry: {
        kind: 'text', at: { x: cellX + symbolW, y: cellY + rowH / 2 + 0.6 },
        value: rotulo.length > max ? `${rotulo.slice(0, Math.max(0, max - 1))}…` : rotulo,
        size: 1.6, anchor: 'start',
      },
    });
  });

  const CONDUTOR: Record<'ac' | 'dc' | 'ground', { layer: 'CONDUCTOR_AC' | 'CONDUCTOR_DC' | 'CONDUCTOR_GROUND'; label: string; dashed?: boolean }> = {
    ac: { layer: 'CONDUCTOR_AC', label: 'CONDUTOR CA' },
    dc: { layer: 'CONDUCTOR_DC', label: 'CONDUTOR CC' },
    ground: { layer: 'CONDUCTOR_GROUND', label: 'ATERRAMENTO', dashed: true },
  };
  conductorRows.forEach((tipo, i) => {
    const def = CONDUTOR[tipo];
    const linhaY = y0 + headerH + linhas * rowH + i * 4.2;
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'line', a: { x: x0, y: linhaY }, b: { x: x0 + LEGEND_W, y: linhaY } } });
    const midY = linhaY + 2.1;
    scene.shapes.push({ layer: def.layer, geometry: { kind: 'line', a: { x: x0 + 1.5, y: midY }, b: { x: x0 + symbolW - 0.5, y: midY }, dashed: def.dashed } });
    scene.shapes.push({ layer: 'TITLE_BLOCK', geometry: { kind: 'text', at: { x: x0 + symbolW, y: midY + 0.6 }, value: def.label, size: 1.6, anchor: 'start' } });
  });
}

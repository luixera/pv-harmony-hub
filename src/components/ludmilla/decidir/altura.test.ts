import { describe, expect, it } from 'vitest';
import { ALTURA_MINIMA_DA_CAIXA, FOLGA_EMBAIXO_DA_CAIXA, alturaDaCaixa } from './altura';

/**
 * A altura da lista e do detalhe lado a lado (revisão da Task 6, item 14 do plano). O
 * `calc(100vh-16rem)` fixo tinha sido medido sem o topo da página; com o código da imagem,
 * os alertas e a faixa de saúde por cima, os botões fixos do detalhe caíam para fora da tela
 * em 1280 × 800. A caixa vai até o fim da janela, medida de onde ela começa.
 */
describe('alturaDaCaixa', () => {
  it('vai de onde a caixa começa até o fim da janela, menos a folga de baixo', () => {
    expect(alturaDaCaixa(800, 400)).toBe(800 - 400 - FOLGA_EMBAIXO_DA_CAIXA);
    expect(alturaDaCaixa(900, 300)).toBe(900 - 300 - FOLGA_EMBAIXO_DA_CAIXA);
  });

  it('topo alto (código da imagem + alertas): não encolhe abaixo do mínimo — a página rola um pouco', () => {
    expect(alturaDaCaixa(800, 700)).toBe(ALTURA_MINIMA_DA_CAIXA);
    expect(alturaDaCaixa(800, 2000)).toBe(ALTURA_MINIMA_DA_CAIXA);
  });

  it('número inteiro (o topo medido vem com fração)', () => {
    expect(Number.isInteger(alturaDaCaixa(800, 333.6))).toBe(true);
    expect(alturaDaCaixa(800, 333.6)).toBeLessThanOrEqual(800 - 333.6 - FOLGA_EMBAIXO_DA_CAIXA);
  });

  it('medida sem sentido (janela 0, NaN): o mínimo, nunca NaN', () => {
    expect(alturaDaCaixa(0, 0)).toBe(ALTURA_MINIMA_DA_CAIXA);
    expect(alturaDaCaixa(Number.NaN, 100)).toBe(ALTURA_MINIMA_DA_CAIXA);
  });
});

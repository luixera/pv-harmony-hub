import { describe, it, expect } from 'vitest';
import { LARGURA_MOBILE, colunasPorLargura, gradeColapsavel } from './breakpoints';

describe('colunasPorLargura', () => {
  it('no celular tudo vira uma coluna', () => {
    expect(colunasPorLargura(390, 4)).toBe(1);
    expect(colunasPorLargura(639, 3)).toBe(1);
  });

  it('no tablet corta pela metade, no mínimo duas', () => {
    expect(colunasPorLargura(800, 4)).toBe(2);
    expect(colunasPorLargura(800, 3)).toBe(2);
  });

  it('no tablet nunca entrega mais colunas do que a tela pediu', () => {
    expect(colunasPorLargura(800, 1)).toBe(1);
    expect(colunasPorLargura(800, 2)).toBe(2);
  });

  it('a fronteira do tablet é 1024: 1023 ainda é tablet, 1024 já é desktop', () => {
    expect(colunasPorLargura(1023, 4)).toBe(2);
    expect(colunasPorLargura(1024, 4)).toBe(4);
  });

  it('no desktop respeita o que a tela pediu', () => {
    expect(colunasPorLargura(1280, 4)).toBe(4);
  });

  it('nunca devolve menos de uma coluna', () => {
    expect(colunasPorLargura(1280, 0)).toBe(1);
    expect(colunasPorLargura(390, -2)).toBe(1);
  });

  it('o limite do celular é 640 e ele NÃO conta como celular', () => {
    expect(LARGURA_MOBILE).toBe(640);
    expect(colunasPorLargura(640, 2)).toBe(2);
  });
});

describe('gradeColapsavel', () => {
  it('devolve o valor de gridTemplateColumns pronto', () => {
    expect(gradeColapsavel(390, 3)).toBe('1fr');
    expect(gradeColapsavel(1280, 3)).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('no tablet devolve a grade cortada pela metade', () => {
    expect(gradeColapsavel(800, 4)).toBe('repeat(2, minmax(0, 1fr))');
  });
});

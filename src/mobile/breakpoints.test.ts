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
});

import { describe, expect, it } from 'vitest';
import { LARGURA_DUAS_COLUNAS, LARGURA_TRES_COLUNAS, modoDaPagina } from './modo';

describe('modoDaPagina (decisão 14)', () => {
  it('uma coluna no celular e no tablet estreito, duas a partir de 960, três a partir de 1280', () => {
    expect(modoDaPagina(390)).toBe('uma');
    expect(modoDaPagina(639)).toBe('uma');
    // de 640 a 959 o menu do GD (256 px) já aparece: a lista não caberia ao lado da coluna da esquerda
    expect(modoDaPagina(640)).toBe('uma');
    expect(modoDaPagina(959)).toBe('uma');
    expect(modoDaPagina(960)).toBe('duas');
    expect(LARGURA_DUAS_COLUNAS).toBe(960);
    expect(modoDaPagina(LARGURA_TRES_COLUNAS - 1)).toBe('duas');
    expect(modoDaPagina(1280)).toBe('tres');
    expect(modoDaPagina(1440)).toBe('tres');
  });
});

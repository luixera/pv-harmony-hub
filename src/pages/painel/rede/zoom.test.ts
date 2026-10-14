import { describe, it, expect } from 'vitest';
import { nivelPorZoom, caixaDeConsulta, contemCaixa, chaveDaCaixa, ZOOM_PONTOS } from './zoom';

describe('zoom', () => {
  it('espelha rede_nivel_celula do banco', () => {
    expect(nivelPorZoom(5)).toBe(1); expect(nivelPorZoom(8)).toBe(1);
    expect(nivelPorZoom(9)).toBe(2); expect(nivelPorZoom(10)).toBe(2);
    expect(nivelPorZoom(11)).toBe(3); expect(nivelPorZoom(12)).toBe(3);
    expect(nivelPorZoom(13)).toBe(4);
    expect(nivelPorZoom(14)).toBeNull(); expect(ZOOM_PONTOS).toBe(14);
  });
  it('a caixa de consulta é 20% maior que a vista em cada lado', () => {
    const c = caixaDeConsulta({ oeste: -47.1, sul: -23.0, leste: -47.0, norte: -22.9 });
    expect(c.oeste).toBeCloseTo(-47.12); expect(c.leste).toBeCloseTo(-46.98);
    expect(c.sul).toBeCloseTo(-23.02); expect(c.norte).toBeCloseTo(-22.88);
  });
  it('só reconsulta quando a vista sai da caixa já carregada', () => {
    const carregada = { oeste: -47.12, sul: -23.02, leste: -46.98, norte: -22.88 };
    expect(contemCaixa(carregada, { oeste: -47.11, sul: -23.01, leste: -46.99, norte: -22.89 })).toBe(true);
    expect(contemCaixa(carregada, { oeste: -47.13, sul: -23.01, leste: -47.0, norte: -22.89 })).toBe(false);
  });
  it('a chave arredonda a 4 casas', () => {
    expect(chaveDaCaixa({ oeste: -47.123456, sul: -23, leste: -46.9, norte: -22.8 })).toBe('-47.1235,-23.0000,-46.9000,-22.8000');
  });
});

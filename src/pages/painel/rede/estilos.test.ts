import { describe, it, expect } from 'vitest';
import { simboloPonto, estiloCelula, estiloAlimentador, estiloContornoAlimentador, simboloSubestacao, descricaoDe, CORES } from './estilos';
import type { Risco } from './tipos';

describe('estilos — cor nunca sozinha', () => {
  it('cada estado tem uma forma própria', () => {
    const f = (['folga', 'atencao', 'risco', 'sem_dado'] as Risco[]).map(r => simboloPonto(r, false).path);
    expect(new Set(f).size).toBe(3);                // círculo (folga e atenção), triângulo, quadrado
    expect(simboloPonto('atencao', false).fillOpacity).toBe(0);   // anel vazado no mapa liso
    expect(simboloPonto('atencao', true).fillOpacity).toBeGreaterThan(0.8); // miolo opaco no satélite
  });
  it('sobre satélite o contorno é escuro e a marca maior', () => {
    expect(simboloPonto('folga', true).strokeColor).toBe('#07070B');
    expect(simboloPonto('folga', true).scale).toBeGreaterThan(simboloPonto('folga', false).scale);
  });
  it('destaque engrossa e sobe', () => {
    expect(simboloPonto('risco', false, true).strokeWeight).toBeGreaterThan(simboloPonto('risco', false).strokeWeight);
    expect(estiloAlimentador('risco', 14, false, true).zIndex).toBeGreaterThan(estiloAlimentador('risco', 14, false).zIndex);
  });
  it('alimentador: traço por estado além da cor, e mais grosso ao aproximar', () => {
    const r = estiloAlimentador('risco', 14, false), f = estiloAlimentador('folga', 14, false);
    expect(r.strokeWeight).toBeGreaterThan(f.strokeWeight);
    expect(r.strokeOpacity).toBeGreaterThan(f.strokeOpacity);
    expect(estiloAlimentador('risco', 8, false).strokeWeight).toBeLessThan(r.strokeWeight);
    expect(estiloContornoAlimentador(14).strokeWeight).toBeGreaterThan(r.strokeWeight);
    expect(estiloContornoAlimentador(14).clickable).toBe(false);
  });
  it('célula: miolo mais fraco e borda mais forte sobre satélite', () => {
    expect(estiloCelula('risco', 3, true).fillOpacity).toBeLessThan(estiloCelula('risco', 3, false).fillOpacity);
    expect(estiloCelula('risco', 3, true).strokeWeight).toBeGreaterThan(estiloCelula('risco', 3, false).strokeWeight);
    expect(estiloCelula('risco', 3, false).fillColor).toBe(CORES.risco);
  });
  it('subestação é losango, cor fora do semáforo', () => {
    expect(simboloSubestacao(false).path).toMatch(/^M 0 -8 L 8 0/);
    expect(Object.values(CORES)).not.toContain(simboloSubestacao(false).fillColor);
  });
  it('a legenda usa os limiares reais', () => {
    expect(descricaoDe('atencao', { fator: 0.8, atencao: 60, risco: 100 })).toBe('entre 60% e 100% da margem');
    expect(descricaoDe('folga', { fator: 0.8, atencao: 60, risco: 100 })).toBe('abaixo de 60% da margem');
  });
});

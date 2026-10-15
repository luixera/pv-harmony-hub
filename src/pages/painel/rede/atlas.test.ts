import { describe, it, expect } from 'vitest';
import { nomeIcone, mapeamentoAtlas, TAM_ICONE } from './atlas';

describe('atlas de ícones — um nome por (estado, fundo, destaque)', () => {
  it('o nome é determinístico e distinto por combinação', () => {
    const nomes = new Set<string>();
    for (const r of ['folga', 'atencao', 'risco', 'sem_dado', 'subestacao'] as const)
      for (const sat of [false, true]) for (const d of [false, true]) nomes.add(nomeIcone(r, sat, d));
    expect(nomes.size).toBe(20);
    expect(nomeIcone('risco', true, false)).toBe('risco-sat');
    expect(nomeIcone('risco', false, true)).toBe('risco-liso-destaque');
  });
  it('o mapeamento cobre os 20 ícones, lado a lado, sem sobrepor', () => {
    const m = mapeamentoAtlas();
    const entradas = Object.values(m);
    expect(entradas).toHaveLength(20);
    const xs = entradas.map(e => e.x).sort((a, b) => a - b);
    xs.forEach((x, i) => expect(x).toBe(i * TAM_ICONE));
    entradas.forEach(e => { expect(e.width).toBe(TAM_ICONE); expect(e.height).toBe(TAM_ICONE); expect(e.y).toBe(0); expect(e.mask).toBe(false); });
  });
});

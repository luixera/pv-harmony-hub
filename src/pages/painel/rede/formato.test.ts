import { describe, it, expect } from 'vitest';
import { kw, kva, pct, inteiro, mesesDesde, rotuloIdade, percentualDe } from './formato';

describe('formato', () => {
  it('kW com 1 casa abaixo de 100 e inteiro acima', () => {
    expect(kw(28)).toBe('28,0 kW'); expect(kw(1234.5)).toBe('1.235 kW'); expect(kw(null)).toBe('—');
  });
  it('kVA e % inteiros; % sem dado em texto', () => {
    expect(kva(75)).toBe('75 kVA'); expect(pct(187.4)).toBe('187%'); expect(pct(null)).toBe('sem dado');
    expect(inteiro(242226)).toBe('242.226');
  });
  it('idade do dado em meses, com rótulo humano', () => {
    const agora = Date.UTC(2026, 9, 13);
    expect(mesesDesde('2025-12-31', agora)).toBe(9);
    expect(rotuloIdade(0)).toBe('deste mês'); expect(rotuloIdade(1)).toBe('1 mês atrás');
    expect(rotuloIdade(9)).toBe('9 meses atrás'); expect(rotuloIdade(26)).toBe('2 anos atrás');
  });
  it('percentual arredondado e seguro com total zero', () => {
    expect(percentualDe(37, 212)).toBe(17); expect(percentualDe(1, 0)).toBe(0);
  });
});

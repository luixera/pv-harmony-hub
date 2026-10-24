import { describe, expect, it } from 'vitest';
import {
  formatarPercentual, formatarUcCpfl, lerPercentual, mesmoTitular, normalizarUc, resumirRateio, validarUc,
} from './beneficiarias';

/**
 * As regras daqui são as do portal da CPFL (telas de 21/10/2026). Errar
 * qualquer uma faz a Ludmilla chegar ao portal com dado que ele recusa.
 */

describe('UC', () => {
  it('normaliza para só dígitos', () => {
    expect(normalizarUc('1.260.283.036-50')).toBe('126028303650');
    expect(normalizarUc(' 755 045 036 12 ')).toBe('75504503612');
    expect(normalizarUc(null)).toBe('');
  });

  it('formata a UC da CPFL como o portal imprime', () => {
    expect(formatarUcCpfl('126028303650')).toBe('1.260.283.036-50');
    // fora do tamanho, não inventa pontos
    expect(formatarUcCpfl('12345')).toBe('12345');
  });

  it('CPFL exige 12 dígitos', () => {
    expect(validarUc('1.260.283.036-50', 'CPFL Paulista').ok).toBe(true);
    const r = validarUc('936.358.036-32', 'CPFL Piratininga');
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/12 dígitos — este tem 11/);
  });

  // regra da spec §7: outras concessionárias ficam em "só dígitos" até o
  // formato ser confirmado — travar um tamanho inventado barraria a COPEL
  it('outras concessionárias aceitam qualquer quantidade de dígitos', () => {
    expect(validarUc('12345', 'COPEL').ok).toBe(true);
    expect(validarUc('1234567890123456', 'ELEKTRO').ok).toBe(true);
    expect(validarUc('987', null).ok).toBe(true);
  });

  it('UC vazia é inválida em qualquer concessionária', () => {
    expect(validarUc('', 'CPFL').ok).toBe(false);
    expect(validarUc('abc', 'COPEL').ok).toBe(false);
  });
});

describe('percentual', () => {
  it('lê à brasileira e à americana, com até 4 casas', () => {
    expect(lerPercentual('30')).toBe(30);
    expect(lerPercentual('30,5')).toBe(30.5);
    expect(lerPercentual('30,0000%')).toBe(30);
    expect(lerPercentual('70.0000 %')).toBe(70);
    expect(lerPercentual('12,34567')).toBe(12.3457);
    expect(lerPercentual(45.5)).toBe(45.5);
  });

  it('recusa zero, negativo, acima de 100 e lixo', () => {
    expect(lerPercentual('0')).toBeNull();
    expect(lerPercentual('-5')).toBeNull();
    expect(lerPercentual('100,0001')).toBeNull();
    expect(lerPercentual('abc')).toBeNull();
    expect(lerPercentual('')).toBeNull();
    expect(lerPercentual(null)).toBeNull();
  });

  it('formata com 4 casas como o portal', () => {
    expect(formatarPercentual(30)).toBe('30,0000%');
    expect(formatarPercentual(12.3457)).toBe('12,3457%');
    expect(formatarPercentual(null)).toBe('—');
  });
});

describe('rateio', () => {
  it('a geradora fica com o resto', () => {
    expect(resumirRateio([30, 50])).toEqual({ soma: 80, geradora: 20, estourou: false });
  });

  it('soma exatamente 100 deixa a geradora com zero (e não é erro)', () => {
    expect(resumirRateio([70, 30])).toEqual({ soma: 100, geradora: 0, estourou: false });
  });

  it('passar de 100 é erro e a geradora nunca fica negativa', () => {
    expect(resumirRateio([70, 40])).toEqual({ soma: 110, geradora: 0, estourou: true });
  });

  it('ignora linhas sem percentual e arredonda em 4 casas', () => {
    expect(resumirRateio([33.3333, null, 33.3333])).toEqual({ soma: 66.6666, geradora: 33.3334, estourou: false });
    // 0,1 + 0,2 em ponto flutuante não pode virar 0,30000000000000004
    expect(resumirRateio([0.1, 0.2]).soma).toBe(0.3);
  });
});

describe('mesmo titular', () => {
  it('compara pelo documento, só dígitos', () => {
    expect(mesmoTitular('119.390.938-48', '11939093848')).toBe(true);
    expect(mesmoTitular('119.390.938-48', '000.000.000-00')).toBe(false);
  });

  it('sem um dos documentos não dá para saber (null, não false)', () => {
    expect(mesmoTitular('119.390.938-48', null)).toBeNull();
    expect(mesmoTitular('', '11939093848')).toBeNull();
  });
});

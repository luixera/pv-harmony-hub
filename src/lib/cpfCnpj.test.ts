import { describe, expect, it } from 'vitest';
import { documentoValido } from './cpfCnpj';

describe('documentoValido (CPF/CNPJ com dígito verificador)', () => {
  it('aceita CPF válido, com ou sem máscara', () => {
    expect(documentoValido('119.390.938-48')).toBe(true);
    expect(documentoValido('52998224725')).toBe(true);
  });

  it('aceita CNPJ válido, com ou sem máscara', () => {
    expect(documentoValido('11.222.333/0001-81')).toBe(true);
    expect(documentoValido('11222333000181')).toBe(true);
  });

  it('recusa dígito verificador errado', () => {
    expect(documentoValido('119.390.938-49')).toBe(false);
    expect(documentoValido('11.222.333/0001-82')).toBe(false);
  });

  it('recusa sequência repetida, que passa na conta mas não é documento', () => {
    expect(documentoValido('000.000.000-00')).toBe(false);
    expect(documentoValido('11111111111')).toBe(false);
    expect(documentoValido('00000000000000')).toBe(false);
  });

  it('recusa o que não tem 11 nem 14 dígitos — uma UC da CPFL tem 12', () => {
    expect(documentoValido('2.194.799.036-53')).toBe(false);
    expect(documentoValido('219479903653')).toBe(false);
    expect(documentoValido('')).toBe(false);
    expect(documentoValido(null)).toBe(false);
    expect(documentoValido('***.456.789-**')).toBe(false);
  });
});

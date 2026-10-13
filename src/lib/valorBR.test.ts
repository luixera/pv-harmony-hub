import { describe, expect, it } from 'vitest';
import { valorBR } from './valorBR';

describe('valorBR', () => {
  it('lê o formato brasileiro', () => {
    expect(valorBR('5.000,00')).toBe(5000);
    expect(valorBR('1.234,56')).toBe(1234.56);
    expect(valorBR('0,50')).toBe(0.5);
    expect(valorBR('12.345.678,90')).toBe(12345678.9);
  });

  it('lê o formato americano, que vem de planilha', () => {
    expect(valorBR('5000.00')).toBe(5000);
    expect(valorBR('1234.56')).toBe(1234.56);
    expect(valorBR('5000')).toBe(5000);
  });

  // o erro que custa dinheiro: 5.000 virar 5
  it('não transforma milhar em unidade', () => {
    expect(valorBR('5.000')).toBe(5000);
    expect(valorBR('1.234.567')).toBe(1234567);
  });

  // é o número de casas que distingue milhar de decimal, porque dinheiro
  // não tem mais de 2 casas
  it('decide milhar x decimal pelo número de casas', () => {
    expect(valorBR('5.000')).toBe(5000);   // 3 casas → milhar
    expect(valorBR('5.00')).toBe(5);       // 2 casas → decimal
    expect(valorBR('5.0')).toBe(5);        // 1 casa  → decimal
    expect(valorBR('5.5')).toBe(5.5);
    // troca aceita e documentada: "0.500" à americana é lido como 500
    expect(valorBR('0.500')).toBe(500);
  });

  it('ignora R$, espaço e espaço não separável', () => {
    expect(valorBR('R$ 5.000,00')).toBe(5000);
    expect(valorBR(' 1234,50 ')).toBe(1234.5);
    expect(valorBR('R$ 1.000,00')).toBe(1000);
  });

  it('arredonda para centavos', () => {
    expect(valorBR('10,999')).toBe(11);
    expect(valorBR('10,994')).toBe(10.99);
  });

  // tudo o que não dá para ler vira 0, e a tela não deixa confirmar com 0
  it('devolve 0 para o que não é valor', () => {
    expect(valorBR('')).toBe(0);
    expect(valorBR('   ')).toBe(0);
    expect(valorBR('abc')).toBe(0);
    expect(valorBR('12abc')).toBe(0);
    expect(valorBR('--5')).toBe(0);
    expect(valorBR(null as unknown as string)).toBe(0);
    expect(valorBR(undefined as unknown as string)).toBe(0);
  });

  it('devolve 0 para zero e negativo (não há recebimento de zero)', () => {
    expect(valorBR('0')).toBe(0);
    expect(valorBR('0,00')).toBe(0);
    expect(valorBR('-100')).toBe(0);
    expect(valorBR('-1.000,00')).toBe(0);
  });
});

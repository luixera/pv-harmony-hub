import { describe, expect, it } from 'vitest';
import { calcularCortesDePagina } from './pdfPaginacao';

/**
 * O extrato financeiro vira PDF por foto (html2canvas) fatiada em páginas A4.
 * A fatia cega a cada `alturaPagina` partia linhas da tabela ao meio; agora o
 * corte cai no último limite de linha que cabe na página.
 */
describe('calcularCortesDePagina', () => {
  it('conteúdo que cabe numa página: uma página só, sem corte', () => {
    expect(calcularCortesDePagina([10, 20, 30], 50, 100)).toEqual([0]);
  });

  it('corta no último limite de linha que cabe na página, não na altura cega', () => {
    // linhas de 30 em 30, página de 100: cabe até 90, próxima página começa em 90
    expect(calcularCortesDePagina([30, 60, 90, 120, 150], 160, 100)).toEqual([0, 90]);
  });

  it('encadeia várias páginas a partir do corte anterior', () => {
    const limites = [30, 60, 90, 120, 150, 180, 210, 240, 270];
    // 0–90 | 90–180 | 180–270 | 270–290 (de 180 a 290 são 110: não cabe, corta em 270)
    expect(calcularCortesDePagina(limites, 290, 100)).toEqual([0, 90, 180, 270]);
    // já de 180 a 280 cabe inteiro numa página: sem quarta página
    expect(calcularCortesDePagina(limites, 280, 100)).toEqual([0, 90, 180]);
  });

  it('sem limite de linha que caiba na página, cai no corte cego para não travar', () => {
    // uma "linha" de 250 de altura numa página de 100
    expect(calcularCortesDePagina([250], 260, 100)).toEqual([0, 100, 200]);
  });

  it('ignora limites fora de ordem ou repetidos', () => {
    expect(calcularCortesDePagina([90, 30, 60, 60], 160, 100)).toEqual([0, 90]);
  });

  it('altura zero ou negativa: só a primeira página', () => {
    expect(calcularCortesDePagina([], 0, 100)).toEqual([0]);
    expect(calcularCortesDePagina([], -5, 100)).toEqual([0]);
  });

  it('um corte exatamente na altura total não gera página vazia', () => {
    expect(calcularCortesDePagina([50, 100], 100, 100)).toEqual([0]);
  });
});

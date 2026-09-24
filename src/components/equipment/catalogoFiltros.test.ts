import { describe, expect, it } from 'vitest';
import { filtrarMarcas, marcasDoCatalogo, modelosDaMarca } from './catalogoFiltros';

/** Catálogo de mentira, com as sujeiras que aparecem no real: caixa e espaço. */
const CATALOGO = [
  { brand: 'Growatt', model: 'MIN 6000TL-X' },
  { brand: 'growatt ', model: 'NEO 2500M-X2' },
  { brand: 'Sungrow', model: 'SG5.0RS' },
  { brand: 'Sungrow', model: 'SG10RT' },
  { brand: 'Sungrow', model: 'HMS-2250DW-4T' },
  { brand: '  ', model: 'sem marca' },
];

describe('marcasDoCatalogo', () => {
  it('junta a mesma marca escrita de jeitos diferentes e conta os modelos', () => {
    expect(marcasDoCatalogo(CATALOGO)).toEqual([
      { nome: 'Growatt', modelos: 2 },
      { nome: 'Sungrow', modelos: 3 },
    ]);
  });

  it('ignora marca vazia e devolve em ordem alfabética (pt-BR)', () => {
    const m = marcasDoCatalogo([{ brand: 'ZTROON' }, { brand: '' }, { brand: 'Ácme' }, { brand: 'BYD' }]);
    expect(m.map(x => x.nome)).toEqual(['Ácme', 'BYD', 'ZTROON']);
  });

  it('catálogo vazio não quebra', () => {
    expect(marcasDoCatalogo([])).toEqual([]);
  });
});

describe('filtrarMarcas', () => {
  const marcas = marcasDoCatalogo(CATALOGO);
  it('filtra pelo trecho digitado, sem diferenciar maiúsculas', () => {
    expect(filtrarMarcas(marcas, 'sun').map(m => m.nome)).toEqual(['Sungrow']);
    expect(filtrarMarcas(marcas, 'GROW').map(m => m.nome)).toEqual(['Growatt', 'Sungrow']);
  });
  it('sem texto, mostra todas', () => {
    expect(filtrarMarcas(marcas, '   ')).toHaveLength(2);
  });
});

describe('modelosDaMarca — a lista condicional', () => {
  it('escolhida a marca, só os modelos dela', () => {
    const r = modelosDaMarca(CATALOGO, 'Sungrow');
    expect(r.lista.map(i => i.model)).toEqual(['SG5.0RS', 'SG10RT', 'HMS-2250DW-4T']);
    expect(r.filtradoPorMarca).toBe(true);
  });

  it('casa mesmo com caixa/espaço diferentes do cadastro', () => {
    expect(modelosDaMarca(CATALOGO, '  growatt ').lista.map(i => i.model))
      .toEqual(['MIN 6000TL-X', 'NEO 2500M-X2']);
  });

  it('sem marca escolhida, lista tudo', () => {
    expect(modelosDaMarca(CATALOGO, '').lista).toHaveLength(CATALOGO.length);
    expect(modelosDaMarca(CATALOGO, undefined).filtradoPorMarca).toBe(false);
  });

  it('marca que não está no catálogo: volta a listar tudo em vez de lista vazia', () => {
    const r = modelosDaMarca(CATALOGO, 'GOKIN');
    expect(r.lista).toHaveLength(CATALOGO.length);
    expect(r.filtradoPorMarca).toBe(false);
  });
});

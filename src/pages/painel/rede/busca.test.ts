import { describe, it, expect } from 'vitest';
import { prepararTermo, sugestoesDaRede, mesclarSugestoes, type SugestaoLugar } from './busca';
import type { ResultadoBusca } from './tipos';

const sub: ResultadoBusca = { tipo: 'subestacao', id: 1, codigo: 'SE1', nome: 'CAMPINAS CENTRO', risco: null, lng: -47, lat: -22, oeste: null, sul: null, leste: null, norte: null };
const alim: ResultadoBusca = { tipo: 'alimentador', id: 2, codigo: 'TAQ06', nome: 'TAQUARAL', risco: 'risco', lng: null, lat: null, oeste: -47.1, sul: -23, leste: -47, norte: -22.9 };
const trafo: ResultadoBusca = { tipo: 'trafo', id: 3, codigo: '34104122', nome: 'TAQ06', risco: 'folga', lng: -47, lat: -22, oeste: null, sul: null, leste: null, norte: null };

describe('busca', () => {
  it('termo: apara, exige 2 caracteres, corta em 60', () => {
    expect(prepararTermo('  ca ')).toBe('ca'); expect(prepararTermo(' c ')).toBeNull();
    expect(prepararTermo('x'.repeat(80))?.length).toBe(60);
  });
  it('sugestões da rede ganham título e subtítulo legíveis', () => {
    const s = sugestoesDaRede([sub, alim, trafo]);
    expect(s[0]).toMatchObject({ tipo: 'subestacao', titulo: 'SE Campinas Centro', subtitulo: 'Subestação · SE1' });
    expect(s[1]).toMatchObject({ tipo: 'alimentador', titulo: 'Alimentador TAQ06', subtitulo: 'SE Taquaral · Risco' });
    expect(s[2]).toMatchObject({ tipo: 'trafo', titulo: 'Trafo 34104122', subtitulo: 'Alimentador TAQ06 · Sem risco aparente' });
  });
  it('com dígito no termo a rede vem antes; sem dígito, os lugares', () => {
    const lugar: SugestaoLugar = { tipo: 'lugar', id: 'p1', titulo: 'Campinas', subtitulo: 'SP, Brasil' };
    const rede = sugestoesDaRede([trafo]);
    expect(mesclarSugestoes('341', rede, [lugar])[0].tipo).toBe('trafo');
    expect(mesclarSugestoes('camp', rede, [lugar])[0].tipo).toBe('lugar');
  });
  it('no máximo 8, sem derrubar um tipo inteiro', () => {
    const muitos = sugestoesDaRede(Array.from({ length: 12 }, (_, i) => ({ ...trafo, id: i, codigo: String(i) })));
    const lugares: SugestaoLugar[] = Array.from({ length: 6 }, (_, i) => ({ tipo: 'lugar', id: `p${i}`, titulo: `L${i}`, subtitulo: '' }));
    const m = mesclarSugestoes('1', muitos, lugares);
    expect(m.length).toBe(8);
    expect(m.filter(x => x.tipo === 'lugar').length).toBeGreaterThanOrEqual(2);
  });
});

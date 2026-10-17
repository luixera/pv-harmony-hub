import { describe, expect, it } from 'vitest';
import {
  atrasada, csvDoResumo, faixa, filtrar, fmt, hojeBrasilia, menosDias, ordenar, pct, perfilMedio, relativo,
} from './calculo';
import type { Local, Resumo } from './tipos';

/**
 * Lógica pura da tela de eletropostos, portada do JS do painel local
 * (web/index.html). O que muda de lugar precisa continuar dando o mesmo
 * número — por isso cada função tem o seu caso aqui.
 */

const local = (p: Partial<Local>): Local => ({
  id: 'x', nome: 'Local', operadora: null, cidade: null, endereco: null, lat: null, lng: null, tipo: 'DC',
  potencia_kw: null, conectores: 1, preco_kwh: null, custo_energia_kwh: null, fonte_status: null, observacoes: null, ativo: true, fonte_principal: null,
  preco_efetivo: 2.12, custo_efetivo: 0.9, preco_estimado: true, custo_estimado: true, monitorado: false,
  conectores_monitorados: 0, horas_ocupado: 0, horas_ocupado_dia: 0, ocupacao: null, cobertura: null, sessoes: 0,
  kwh_min: 0, kwh_max: 0, receita_min: 0, receita_max: 0, custo_min: 0, custo_max: 0, margem_min: 0, margem_max: 0, agora: {},
  ...p,
});

describe('formatação', () => {
  it('fmt usa vírgula decimal e traço para vazio', () => {
    expect(fmt(1234.56, 1)).toBe('1.234,6');
    expect(fmt(null)).toBe('—');
    expect(fmt(NaN)).toBe('—');
  });
  it('pct converte fração em porcentagem com uma casa', () => {
    expect(pct(0.545)).toBe('54,5%');
    expect(pct(0.7826)).toBe('78,3%');
    expect(pct(null)).toBe('—');
  });
  it('faixa colapsa quando min e max arredondam igual', () => {
    const f = (v: number) => fmt(v, 0);
    expect(faixa(108, 144, f)).toBe('108–144');
    expect(faixa(10.2, 10.4, f)).toBe('10');
    expect(faixa(null, 5, f)).toBe('—');
  });
});

describe('perfil médio por hora', () => {
  it('faz a média das 7 linhas ignorando null', () => {
    const perfil: (number | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
    perfil[0][10] = 0.5; perfil[3][10] = 1.0;   // segunda e quinta às 10h
    const m = perfilMedio(perfil);
    expect(m).toHaveLength(24);
    expect(m[10]).toBeCloseTo(0.75);
    expect(m[11]).toBeNull();
  });
});

describe('tempo relativo e atraso da coleta', () => {
  const agora = new Date('2026-10-15T20:30:00Z').getTime();
  it('relativo fala em minutos, horas e dias', () => {
    expect(relativo(null, agora)).toBe('nunca');
    expect(relativo('2026-10-15T20:29:40Z', agora)).toBe('agora');
    expect(relativo('2026-10-15T20:18:00Z', agora)).toBe('há 12 min');
    expect(relativo('2026-10-15T17:30:00Z', agora)).toBe('há 3 h');
    expect(relativo('2026-10-13T20:30:00Z', agora)).toBe('há 2 d');
  });
  it('fonte está atrasada depois de 15 min sem leitura', () => {
    expect(atrasada('2026-10-15T20:20:00Z', agora)).toBe(false);
    expect(atrasada('2026-10-15T20:10:00Z', agora)).toBe(true);
    expect(atrasada(null, agora)).toBe(true);
  });
});

describe('tabela de carregadores', () => {
  const a = local({ id: 'a', nome: 'Alfa', cidade: 'Mirassol', operadora: 'Tupi', tipo: 'DC', ocupacao: 0.2, monitorado: true, agora: { ocupado: 1 } });
  const b = local({ id: 'b', nome: 'Beta', cidade: 'Rio Preto', operadora: 'ATM EVS', tipo: 'DC', ocupacao: 0.7, monitorado: true, agora: { livre: 2 } });
  const c = local({ id: 'c', nome: 'Gama', cidade: 'Rio Preto', operadora: null, tipo: 'AC', ocupacao: null, endereco: 'Rua das Flores' });
  it('ordena com null sempre no fim, nas duas direções', () => {
    expect(ordenar([a, b, c], { col: 'ocupacao', dir: -1 }).map(l => l.id)).toEqual(['b', 'a', 'c']);
    expect(ordenar([a, b, c], { col: 'ocupacao', dir: 1 }).map(l => l.id)).toEqual(['a', 'b', 'c']);
  });
  it('coluna "agora" ordena pelo número de conectores carregando', () => {
    expect(ordenar([a, b, c], { col: 'agora', dir: -1 }).map(l => l.id)[0]).toBe('a');
  });
  it('filtra por busca (nome ou endereço), cidade, operadora, tipo e monitoramento', () => {
    const vazio = { q: '', cidade: '', operadora: '', tipo: '' as const, mon: '' as const };
    expect(filtrar([a, b, c], { ...vazio, q: 'flores' }).map(l => l.id)).toEqual(['c']);
    expect(filtrar([a, b, c], { ...vazio, cidade: 'Rio Preto' })).toHaveLength(2);
    expect(filtrar([a, b, c], { ...vazio, operadora: 'Tupi' }).map(l => l.id)).toEqual(['a']);
    expect(filtrar([a, b, c], { ...vazio, tipo: 'AC' }).map(l => l.id)).toEqual(['c']);
    expect(filtrar([a, b, c], { ...vazio, mon: '0' }).map(l => l.id)).toEqual(['c']);
    expect(filtrar([a, b, c], { ...vazio, mon: '1' })).toHaveLength(2);
  });
});

describe('período em Brasília', () => {
  it('hoje é a data civil de Brasília (UTC-3), não a do navegador', () => {
    expect(hojeBrasilia(new Date('2026-10-16T01:30:00Z').getTime())).toBe('2026-10-15');
    expect(hojeBrasilia(new Date('2026-10-16T03:30:00Z').getTime())).toBe('2026-10-16');
  });
  it('menosDias anda em dias civis', () => {
    expect(menosDias('2026-10-15', 6)).toBe('2026-10-09');
    expect(menosDias('2026-03-01', 1)).toBe('2026-02-28');
  });
});

describe('exportação CSV', () => {
  it('escreve o período, o cabeçalho e uma linha por local com ponto e vírgula', () => {
    const r = { periodo: { de: '2026-10-09', ate: '2026-10-15' }, locais: [local({ nome: 'Posto; X', ocupacao: 0.5 })] } as unknown as Resumo;
    const csv = csvDoResumo(r);
    const linhas = csv.split('\n');
    expect(linhas[0]).toBe('periodo;2026-10-09;2026-10-15');
    expect(linhas[1].startsWith('id;nome;operadora;cidade')).toBe(true);
    expect(linhas[2]).toContain('"Posto; X"');
    expect(linhas[2]).toContain(';0.5;');
  });
});

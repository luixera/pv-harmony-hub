import type { ResultadoBusca, Risco } from './tipos';
import { ROTULOS } from './estilos';

export const TERMO_MINIMO = 2;
export interface SugestaoLugar { tipo: 'lugar'; id: string; titulo: string; subtitulo: string }
export interface SugestaoRede {
  tipo: 'subestacao' | 'alimentador' | 'trafo'; id: number;
  titulo: string; subtitulo: string; risco: Risco | null; item: ResultadoBusca;
}
export type Sugestao = SugestaoLugar | SugestaoRede;

export function prepararTermo(t: string): string | null {
  const limpo = t.replace(/\s+/g, ' ').trim().slice(0, 60);
  return limpo.length >= TERMO_MINIMO ? limpo : null;
}

const capitalizar = (s: string) =>
  s.toLowerCase().replace(/(^|\s|-)\S/g, m => m.toUpperCase());

export function sugestoesDaRede(itens: ResultadoBusca[]): SugestaoRede[] {
  return itens.map(i => {
    const risco = i.risco ? ` · ${ROTULOS[i.risco]}` : '';
    if (i.tipo === 'subestacao') {
      return { tipo: i.tipo, id: i.id, risco: i.risco, item: i,
               titulo: `SE ${capitalizar(i.nome ?? i.codigo)}`, subtitulo: `Subestação · ${i.codigo}` };
    }
    if (i.tipo === 'alimentador') {
      return { tipo: i.tipo, id: i.id, risco: i.risco, item: i, titulo: `Alimentador ${i.codigo}`,
               subtitulo: `${i.nome ? `SE ${capitalizar(i.nome)}` : 'sem subestação'}${risco}` };
    }
    return { tipo: i.tipo, id: i.id, risco: i.risco, item: i, titulo: `Trafo ${i.codigo}`,
             subtitulo: `${i.nome ? `Alimentador ${i.nome}` : 'sem alimentador'}${risco}` };
  });
}

/**
 * Uma lista só. Código tem dígito; nome de cidade não — é o que decide quem
 * vem primeiro. Nenhum tipo é derrubado inteiro: cada um garante ao menos 2.
 */
export function mesclarSugestoes(termo: string, rede: SugestaoRede[], lugares: SugestaoLugar[], maximo = 8): Sugestao[] {
  const redePrimeiro = /\d/.test(termo);
  const [a, b]: [Sugestao[], Sugestao[]] = redePrimeiro ? [rede, lugares] : [lugares, rede];
  const minB = Math.min(2, b.length);
  const deA = a.slice(0, Math.max(0, maximo - minB));
  return [...deA, ...b.slice(0, maximo - deA.length)];
}

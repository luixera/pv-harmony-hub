import type { ResultadoBusca, Risco } from './tipos';
import { ROTULOS } from './estilos';

export const TERMO_MINIMO = 2;
export interface SugestaoLugar { tipo: 'lugar'; id: string; titulo: string; subtitulo: string }
export interface SugestaoRede {
  tipo: 'subestacao' | 'alimentador' | 'trafo'; id: number;
  titulo: string; subtitulo: string; risco: Risco | null; item: ResultadoBusca;
}
export interface SugestaoCoordenada { tipo: 'coordenada'; id: string; titulo: string; subtitulo: string; coordenada: { lat: number; lng: number } }
export type Sugestao = SugestaoLugar | SugestaoRede | SugestaoCoordenada;

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

/**
 * Coordenada digitada na busca. O orçamento de conexão da CPFL traz a UC em
 * DMS (`20°47'20.1"S 49°21'57.5"W`); o Google e o WhatsApp mandam decimal
 * (`-20.78898, -49.36583`). O número do posto da distribuidora e o código do
 * trafo são inteiros soltos e NÃO são coordenada: exige duas partes com sinal
 * ou hemisfério e latitude/longitude dentro do mapa.
 */
export interface Coordenada { lat: number; lng: number }
const DMS = /(\d{1,3})[°º]\s*(\d{1,2})['′]\s*(\d{1,2}(?:[.,]\d+)?)["″]?\s*([NSEWOLnsewol])/g;

export function coordenadaDe(texto: string): Coordenada | null {
  const t = texto.trim();
  const dms = [...t.matchAll(DMS)];
  if (dms.length === 2) {
    const grau = (m: RegExpMatchArray) => {
      const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3].replace(',', '.')) / 3600;
      const h = m[4].toUpperCase();
      return { v: /[SWO]/.test(h) ? -v : v, lat: /[NS]/.test(h) };
    };
    const a = grau(dms[0]), b = grau(dms[1]);
    if (a.lat === b.lat) return null;
    return valida(a.lat ? { lat: a.v, lng: b.v } : { lat: b.v, lng: a.v });
  }
  const dec = /^\s*(-?\d{1,2}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)\s*$/.exec(t);
  if (!dec) return null;
  return valida({ lat: Number(dec[1].replace(',', '.')), lng: Number(dec[2].replace(',', '.')) });
}

const valida = (c: Coordenada): Coordenada | null =>
  Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180 ? c : null;

import type { Risco, Regras } from './tipos';

/**
 * Cores validadas contra daltonismo (ΔE 12,6 em protanopia) — NÃO mudam entre
 * camadas nem entre mapa liso e satélite. O que muda é miolo, contorno e
 * tamanho. Cor nunca sozinha: forma por estado nos pontos, traço nas linhas.
 *
 * Puro de propósito: nada de `google.*` em tempo de módulo (os caminhos SVG
 * substituem `SymbolPath.CIRCULO`), para rodar no vitest sem o Maps.
 */
export const CORES: Record<Risco, string> = {
  folga: '#1F7A3D', atencao: '#F5A800', risco: '#F0523F', sem_dado: '#8A8A96',
};
export const ROTULOS: Record<Risco, string> = {
  folga: 'Sem risco aparente', atencao: 'Atenção', risco: 'Risco', sem_dado: 'Sem dado',
};
export const ORDEM: Risco[] = ['risco', 'atencao', 'folga', 'sem_dado'];
export const COR_SUBESTACAO = '#8A8AF0';
const CONTORNO_ESCURO = '#07070B';
const MIOLO_ESCURO = '#0E0E14';

export function descricaoDe(risco: Risco, r: Regras): string {
  if (risco === 'folga') return `abaixo de ${r.atencao}% da margem`;
  if (risco === 'atencao') return `entre ${r.atencao}% e ${r.risco}% da margem`;
  if (risco === 'risco') return `margem esgotada (${r.risco}% ou mais)`;
  return 'sem carga ou geração na base';
}

/** Mesmo formato de `google.maps.Symbol`, sem depender do namespace carregado. */
export interface Simbolo {
  path: string; fillColor: string; fillOpacity: number;
  strokeColor: string; strokeWeight: number; scale: number;
}

// caminhos centrados em (0,0), em px no scale 1
const CIRCULO = 'M 0 -6 A 6 6 0 1 1 0 6 A 6 6 0 1 1 0 -6 Z';
const TRIANGULO = 'M 0 -8 L 7 6 L -7 6 Z';
const QUADRADO = 'M -5.5 -5.5 L 5.5 -5.5 L 5.5 5.5 L -5.5 5.5 Z';
const LOSANGO = 'M 0 -8 L 8 0 L 0 8 L -8 0 Z';

/**
 * Sobre satélite todo marcador ganha miolo opaco e contorno escuro: é o
 * contorno que separa a marca da foto (15,9:1 em telhado claro, 9,8:1 em
 * concreto; fraco só em vegetação e asfalto — medido em 13/10/2026).
 */
export function simboloPonto(risco: Risco, satelite: boolean, destaque = false): Simbolo {
  const cor = CORES[risco] ?? CORES.sem_dado;
  const s = (satelite ? 1.25 : 1) * (destaque ? 1.35 : 1);
  const contorno = satelite ? CONTORNO_ESCURO : 'rgba(255,255,255,0.45)';
  const peso = (satelite ? 2.2 : 1.6) + (destaque ? 1.4 : 0);
  if (risco === 'risco') {
    return { path: TRIANGULO, fillColor: cor, fillOpacity: 1,
             strokeColor: satelite ? CONTORNO_ESCURO : MIOLO_ESCURO,
             strokeWeight: (satelite ? 2 : 1.5) + (destaque ? 1.4 : 0), scale: s };
  }
  if (risco === 'atencao') {
    // anel: vazado no mapa liso, miolo escuro opaco sobre imagem
    return { path: CIRCULO, fillColor: MIOLO_ESCURO, fillOpacity: satelite ? 0.92 : 0,
             strokeColor: cor, strokeWeight: 4 + (destaque ? 1.4 : 0), scale: s };
  }
  if (risco === 'sem_dado') {
    // quadrado, não anel fino: espessura não se lê sobre imagem
    return { path: QUADRADO, fillColor: satelite ? cor : MIOLO_ESCURO,
             fillOpacity: satelite ? 0.85 : 0, strokeColor: satelite ? CONTORNO_ESCURO : cor,
             strokeWeight: 2 + (destaque ? 1.4 : 0), scale: s };
  }
  return { path: CIRCULO, fillColor: cor, fillOpacity: 1,
           strokeColor: contorno, strokeWeight: peso, scale: s };
}

export function estiloPonto(risco: Risco, satelite: boolean, destaque = false) {
  const z = { risco: 4, atencao: 3, sem_dado: 2, folga: 1 }[risco] ?? 1;
  return { icon: simboloPonto(risco, satelite, destaque), zIndex: destaque ? 100 : z, cursor: 'pointer' };
}

/** Sobre imagem, 0,3 de cor saturada vira barro: miolo mais fraco, borda forte. */
export function estiloCelula(risco: Risco, nivel: number, satelite: boolean) {
  const cor = risco === 'sem_dado' && !satelite ? '#3A3A48' : (CORES[risco] ?? CORES.sem_dado);
  return {
    fillColor: cor, fillOpacity: satelite ? 0.22 : (nivel >= 3 ? 0.26 : 0.3),
    strokeColor: cor, strokeOpacity: satelite ? 1 : 0.6, strokeWeight: satelite ? 2 : 1,
    clickable: true, cursor: 'zoom-in', zIndex: risco === 'risco' ? 3 : risco === 'atencao' ? 2 : 1,
  };
}

/** Traço por estado além da cor: risco grosso e contínuo, folga fino e tênue. */
export function estiloAlimentador(risco: Risco, zoom: number, satelite: boolean, destaque = false) {
  const base = zoom < 11 ? 1.5 : zoom < 14 ? 2.5 : 3.5;
  const fator = { risco: 1.3, atencao: 1.0, folga: 0.7, sem_dado: 0.6 }[risco] ?? 0.6;
  const opac  = { risco: 0.95, atencao: 0.9, folga: 0.7, sem_dado: 0.65 }[risco] ?? 0.65;
  return {
    strokeColor: CORES[risco] ?? CORES.sem_dado,
    strokeOpacity: destaque ? 1 : opac,
    strokeWeight: base * fator + (satelite ? 0.5 : 0) + (destaque ? 2.5 : 0),
    zIndex: destaque ? 90 : ({ risco: 13, atencao: 12, folga: 11, sem_dado: 10 }[risco] ?? 10),
    cursor: 'pointer',
  };
}

/** Segunda camada com as MESMAS linhas, por baixo: o contorno que as separa da foto. */
export function estiloContornoAlimentador(zoom: number) {
  const base = zoom < 11 ? 1.5 : zoom < 14 ? 2.5 : 3.5;
  return { strokeColor: CONTORNO_ESCURO, strokeOpacity: 0.85, strokeWeight: base * 1.3 + 3, zIndex: 1, clickable: false };
}

export function simboloSubestacao(satelite: boolean, destaque = false): Simbolo {
  return { path: LOSANGO, fillColor: COR_SUBESTACAO, fillOpacity: 0.95,
           strokeColor: satelite ? CONTORNO_ESCURO : MIOLO_ESCURO,
           strokeWeight: destaque ? 3.5 : 2, scale: (satelite ? 1.2 : 1) * (destaque ? 1.3 : 1) };
}
export function estiloSubestacao(satelite: boolean, destaque = false) {
  return { icon: simboloSubestacao(satelite, destaque), zIndex: destaque ? 100 : 20, cursor: 'pointer' };
}

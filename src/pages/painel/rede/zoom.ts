/**
 * Espelho de `rede_nivel_celula()` do banco. Quem decide a camada é a RPC;
 * a tela só precisa saber ANTES da resposta se vai mostrar células ou pontos
 * (para o rótulo da lista e para escolher o que destacar).
 */
export const ZOOM_PONTOS = 14;

export function nivelPorZoom(zoom: number): 1 | 2 | 3 | 4 | null {
  if (zoom < 9) return 1;
  if (zoom < 11) return 2;
  if (zoom < 13) return 3;
  if (zoom < ZOOM_PONTOS) return 4;
  return null;
}

export interface Caixa { oeste: number; sul: number; leste: number; norte: number }

/**
 * Consulta uma caixa 20% maior que a vista em cada lado e só volta ao servidor
 * quando a vista SAI dela (ou o zoom muda). A v1 arredondava a caixa a 2 casas
 * na chave do cache: arrastar 500 m reaproveitava dado que não cobria a área.
 */
export function caixaDeConsulta(vista: Caixa, folga = 0.2): Caixa {
  const dx = (vista.leste - vista.oeste) * folga;
  const dy = (vista.norte - vista.sul) * folga;
  return {
    oeste: Math.max(-180, vista.oeste - dx), sul: Math.max(-90, vista.sul - dy),
    leste: Math.min(180, vista.leste + dx),  norte: Math.min(90, vista.norte + dy),
  };
}

export const contemCaixa = (externa: Caixa, interna: Caixa) =>
  interna.oeste >= externa.oeste && interna.leste <= externa.leste &&
  interna.sul >= externa.sul && interna.norte <= externa.norte;

export const chaveDaCaixa = (c: Caixa) =>
  [c.oeste, c.sul, c.leste, c.norte].map(v => v.toFixed(4)).join(',');

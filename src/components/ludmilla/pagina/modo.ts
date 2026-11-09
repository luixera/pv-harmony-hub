/**
 * A partir daqui as três colunas cabem ao lado do menu do GD (256 px): 1280 − 256 = 1024 px para
 * 260 (esquerda) + lista + 360 (detalhe). Abaixo, a coluna da esquerda e a lista, com o detalhe numa
 * folha; no celular, uma coluna por vez (spec §5). Decisão 14 do plano.
 */
export const LARGURA_TRES_COLUNAS = 1280;

/**
 * O menu do GD (256 px) aparece a partir de 640 px (`LARGURA_MOBILE`); a esquerda + lista só cabem
 * com folga daqui para cima: 960 − 256 − 48 (respiro do MainLayout) − 260 (esquerda) ≈ 396 px de lista.
 * Abaixo, a mesma tela de uma coluna do celular.
 */
export const LARGURA_DUAS_COLUNAS = 960;

export type ModoDaPagina = 'tres' | 'duas' | 'uma';

export function modoDaPagina(largura: number): ModoDaPagina {
  if (largura < LARGURA_DUAS_COLUNAS) return 'uma';
  return largura < LARGURA_TRES_COLUNAS ? 'duas' : 'tres';
}

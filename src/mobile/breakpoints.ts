/**
 * Os limites de tela do GD Manager, num lugar só.
 *
 * `useWindowSize` já definia 640/1024; estes valores são os mesmos, exportados
 * para quem precisa decidir layout sem ser componente. Antes disto cada tela
 * escolhia seu número de colunas na mão, e seis grades de 3–4 colunas sequer
 * olhavam o tamanho da tela (ProjectModal, TaskDialog, NewRevisionDialog,
 * Reports) — no celular viravam colunas de ~90 px.
 */
export const LARGURA_MOBILE = 640;
export const LARGURA_TABLET = 1024;

/** Quantas colunas cabem de verdade nesta largura. */
export function colunasPorLargura(largura: number, desejadas: number): number {
  const pedido = Math.max(1, Math.floor(desejadas) || 1);
  if (largura < LARGURA_MOBILE) return 1;
  if (largura < LARGURA_TABLET) return Math.max(2, Math.ceil(pedido / 2));
  return pedido;
}

/** O mesmo, já no formato que o `gridTemplateColumns` espera. */
export function gradeColapsavel(largura: number, desejadas: number): string {
  const n = colunasPorLargura(largura, desejadas);
  return n === 1 ? '1fr' : `repeat(${n}, minmax(0, 1fr))`;
}

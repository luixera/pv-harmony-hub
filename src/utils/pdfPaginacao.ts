/**
 * Paginação de um relatório fotografado (html2canvas → jsPDF).
 *
 * A foto é uma imagem alta que precisa ser fatiada em páginas A4. Cortar
 * cegamente a cada `alturaPagina` parte uma linha da tabela ao meio (metade
 * no rodapé de uma página, metade no topo da seguinte). Aqui o corte cai no
 * ÚLTIMO limite de linha que cabe na página; quando nenhum cabe (linha mais
 * alta que a página), volta ao corte cego para não travar.
 *
 * Tudo na mesma unidade (mm ou px, tanto faz — o chamador converte).
 *
 * @param limitesDeLinha  posição do fim de cada linha, medida do topo da foto
 * @param alturaTotal     altura da foto
 * @param alturaPagina    altura útil de uma página
 * @returns posição do topo de cada página, sempre começando em 0
 */
export function calcularCortesDePagina(
  limitesDeLinha: number[],
  alturaTotal: number,
  alturaPagina: number,
): number[] {
  const cortes = [0];
  if (!(alturaTotal > 0) || !(alturaPagina > 0)) return cortes;

  const limites = Array.from(new Set(limitesDeLinha))
    .filter(l => l > 0 && l < alturaTotal)
    .sort((a, b) => a - b);

  let topo = 0;
  while (topo + alturaPagina < alturaTotal) {
    const fimDaPagina = topo + alturaPagina;
    // maior limite de linha dentro da página atual (estritamente depois do topo)
    let proximo = -1;
    for (const l of limites) {
      if (l <= topo) continue;
      if (l > fimDaPagina) break;
      proximo = l;
    }
    topo = proximo > topo ? proximo : fimDaPagina;
    cortes.push(topo);
  }
  return cortes;
}

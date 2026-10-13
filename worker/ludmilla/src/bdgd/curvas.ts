/**
 * O fator de forma da curva de carga, e o `CASE` que ele gera.
 *
 * POR QUE EXISTE: a BDGD liga cada unidade consumidora a uma das 68 tipologias
 * de `CRVCRG`, que traz 96 valores de quarto de hora por tipo de dia. O jeito
 * óbvio de usar isso seria `JOIN UCBT_tab × CRVCRG` no dialeto SQLite do
 * ogr2ogr — e ele é inviável: laço aninhado de 2 milhões × 68 com 120 colunas
 * de aritmética por linha, abortado depois de 11 minutos sem uma linha de
 * saída. Pré-calcular os 68 fatores aqui e gerar um `CASE` dá o MESMO
 * resultado em 12,5 s (medido em 13/10/2026, CPFL Piratininga).
 *
 * POR QUE A *FORMA* E NÃO O VALOR: devolvemos `mínimo na janela ÷ média
 * diária`, não o mínimo em si. Assim o resultado não depende de como a ANEEL
 * normaliza `POT_xx` — a razão é adimensional.
 */

export interface Curva {
  codId: string;
  tipDia: string;
  pot: number[];
}

/**
 * `null` quando a curva não serve (tamanho errado, ou soma não positiva).
 * `0` é resposta legítima: iluminação pública é zero ao meio-dia de verdade.
 * A janela é `[horaInicio, horaFim)` — 15h fica FORA, porque POT_01 cobre
 * 00:00-00:15 e a hora `h` começa no índice `h * 4`.
 */
export function fatorDeForma(pot: number[], horaInicio: number, horaFim: number): number | null {
  if (pot.length !== 96 || pot.some(v => !Number.isFinite(v))) return null;
  const soma = pot.reduce((a, b) => a + b, 0);
  if (soma <= 0) return null;
  const janela = pot.slice(horaInicio * 4, horaFim * 4);
  if (janela.length === 0) return null;
  return Math.min(...janela) / (soma / 96);
}

/** Dia útil é o que interessa: é o pior caso de carga baixa com sol. */
export function gerarCaseSql(curvas: Curva[], horaInicio: number, horaFim: number): string {
  const ramos: string[] = [];
  for (const c of curvas) {
    if (c.tipDia !== 'DU') continue;
    const f = fatorDeForma(c.pot, horaInicio, horaFim);
    if (f === null) continue;
    ramos.push(`WHEN '${c.codId.replace(/'/g, "''")}' THEN ${f.toFixed(6)}`);
  }
  return `CASE u.TIP_CC ${ramos.join(' ')} ELSE NULL END`;
}

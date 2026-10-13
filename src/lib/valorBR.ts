/**
 * Lê um valor em dinheiro digitado por gente.
 *
 * O financeiro é digitado por quem está acostumado ao formato brasileiro
 * ("5.000,00"), mas colar de planilha ou de extrato traz o americano
 * ("5000.00"). As duas formas têm de funcionar, porque errar aqui lança
 * pagamento errado — e 5.000 virar 5 é o tipo de erro que só se descobre
 * depois de a empresa reclamar.
 *
 * Regras, nesta ordem:
 *
 * 1. **Há vírgula** → ela é o decimal e o ponto é milhar: "5.000,00" = 5000.
 * 2. **Sem vírgula, mais de um ponto** → todos são milhar: "1.234.567".
 * 3. **Sem vírgula, um ponto só** → o número de casas decide, porque dinheiro
 *    não tem mais de 2 casas: `.000` (3 dígitos) é milhar e vale 5000;
 *    `.00` ou `.0` é decimal e vale 5. Sem essa regra, "5.000" digitado por
 *    um brasileiro viraria R$ 5,00 — o erro que mais custa aqui.
 *
 * Caso aceito em troca: "0.500" (meio, à americana) é lido como 500. É raro,
 * e o diálogo mostra o valor lido antes de confirmar, então um engano aparece.
 *
 * Devolve 0 para o que não dá para ler — a tela trata 0 como "não informado"
 * e não deixa confirmar.
 */
export function valorBR(texto: string): number {
  if (typeof texto !== 'string') return 0;
  const limpo = texto.replace(/\s|R\$| /g, '');
  if (limpo === '') return 0;
  // só dígitos, ponto, vírgula e um sinal no começo
  if (!/^-?[\d.,]+$/.test(limpo)) return 0;

  let final: string;
  if (limpo.includes(',')) {
    final = limpo.replace(/\./g, '').replace(',', '.');
  } else {
    const pontos = (limpo.match(/\./g) ?? []).length;
    const tresCasas = /\.\d{3}$/.test(limpo);
    final = (pontos > 1 || tresCasas) ? limpo.replace(/\./g, '') : limpo;
  }

  const n = Number(final);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

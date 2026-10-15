/**
 * Os campos de apoio que cabem num cartão de celular.
 *
 * Um cartão mostra titular, selo de etapa e no MÁXIMO três campos — quem
 * precisa do resto abre o item. Campo sem valor é pulado: rótulo solto com
 * espaço em branco ao lado é o que faz a lista parecer quebrada.
 */
export interface CampoDeCartao {
  rotulo: string;
  valor: string | null | undefined;
}

export function resumoDeCartao(
  campos: CampoDeCartao[],
  max = 3,
): { rotulo: string; valor: string }[] {
  // `!(max > 0)` e não `max <= 0`: com NaN toda comparação é falsa e o teto sumiria.
  if (!(max > 0)) return [];
  const cheios: { rotulo: string; valor: string }[] = [];
  for (const c of campos) {
    const valor = String(c.valor ?? '').replace(/\s+/g, ' ').trim();
    if (!valor) continue;
    cheios.push({ rotulo: c.rotulo, valor });
    if (cheios.length >= max) break;
  }
  return cheios;
}

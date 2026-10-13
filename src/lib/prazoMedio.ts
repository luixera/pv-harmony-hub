/**
 * Prazo médio de pagamento do tenant inteiro, a partir das linhas por empresa.
 *
 * É média **ponderada** pela quantidade de pagamentos, o que a torna idêntica à
 * média real de todos os pagamentos — sem uma segunda consulta ao banco. A
 * média simples dos prazos daria o mesmo peso a uma empresa com 1 pagamento e
 * a outra com 60, e o número do topo da tela sairia errado.
 *
 * Empresa que nunca pagou não entra: prazo nulo não é prazo zero. Quando
 * ninguém pagou nada, devolve `null` e a tela mostra "—".
 *
 * Mora em `lib` (e não no hook) porque é conta pura e precisa de teste — o
 * módulo do hook importa o client do Supabase, que não roda fora do navegador.
 */
export interface LinhaDePrazo {
  pagamentos: number;
  prazo_medio_dias: number | null;
}

export function prazoMedioGlobal(linhas: LinhaDePrazo[]): number | null {
  let pagamentos = 0;
  let soma = 0;
  for (const l of linhas) {
    if (l.prazo_medio_dias === null || l.pagamentos <= 0) continue;
    pagamentos += l.pagamentos;
    soma += l.prazo_medio_dias * l.pagamentos;
  }
  return pagamentos > 0 ? Math.round(soma / pagamentos) : null;
}

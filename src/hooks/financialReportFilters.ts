/**
 * Os recortes do extrato financeiro, sem nada do React e sem o Supabase.
 *
 * Mora fora do `useFinancialReport.ts` por um motivo prático: aquele arquivo
 * importa o `useFinancialDashboard`, que importa o cliente do Supabase, que lê
 * `localStorage` já no carregamento do módulo. O vitest da casa roda com
 * `environment: 'node'`, sem DOM, então qualquer teste que tocasse naquele
 * arquivo quebrava antes de rodar. As funções diziam no comentário que eram
 * "puras e exportadas pra ser testável fora do React" e, na prática, não eram.
 * Aqui são — ver `financialReportFilters.test.ts`.
 *
 * Os tipos de entrada são declarados de forma estrutural, e não importados do
 * dashboard, justamente para este módulo não voltar a arrastar o Supabase.
 */

export interface FinancialReportFilters {
  companyId?: string;
  /** Etapas do projeto a incluir. Vazio/ausente = todas. É lista porque um
   *  extrato costuma juntar etapas diferentes (aprovado + vistoria
   *  solicitada + concluído que ainda não foi pago) — pedido do usuário. */
  statuses?: string[];
  /** Situações de pagamento a incluir. Vazio/ausente = todas. É lista pelo
   *  mesmo motivo das etapas: as situações se excluem entre si — quem está
   *  `pending` não recebeu nada e quem está `partial` recebeu parte —, e o
   *  extrato de cobrança precisa justamente das duas juntas, que é tudo que
   *  ainda deve algo. Pedido do usuário, out/2026. */
  paymentStatuses?: string[];
  dateFrom?: string;
  dateTo?: string;
  /**
   * Esconde o consumo da franquia ("7/10 projetos") na linha de mensalidade.
   * Pedido do usuario (set/2026): esse numero atrapalha a leitura do extrato,
   * que e sobre DINHEIRO. Ele continua no financeiro da empresa, onde explica
   * por que um projeto do mes veio mais caro. Ligado por padrao.
   */
  hideFranchiseUsage?: boolean;
}

/** O que o filtro precisa saber de um projeto. */
export interface ProjetoFiltravel {
  companyId: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
}

/** O que o filtro precisa saber de uma mensalidade. */
export interface MensalidadeFiltravel {
  companyId: string;
  status: string;
  /** 1º dia do mês cobrado (YYYY-MM-DD). */
  competence: string;
}

/** Um projeto entra no extrato?
 *  Filtro ausente (ou lista vazia) = não restringe nada. */
export function matchesReportFilters(p: ProjetoFiltravel, filters: FinancialReportFilters): boolean {
  if (filters.companyId && p.companyId !== filters.companyId) return false;
  if (filters.statuses?.length && !filters.statuses.includes(p.status)) return false;
  if (filters.paymentStatuses?.length && !filters.paymentStatuses.includes(p.paymentStatus)) return false;
  if (filters.dateFrom && p.createdAt < filters.dateFrom) return false;
  if (filters.dateTo && p.createdAt.slice(0, 10) > filters.dateTo) return false;
  return true;
}

/** Uma MENSALIDADE entra no extrato?
 *  O filtro de ETAPA não se aplica (mensalidade não tem etapa de projeto);
 *  empresa, situação de pagamento e período valem. O período considera o mês
 *  inteiro da competência: uma mensalidade de julho entra num extrato que
 *  pegue qualquer dia de julho. */
export function matchesSubscriptionFilters(a: MensalidadeFiltravel, filters: FinancialReportFilters): boolean {
  if (filters.companyId && a.companyId !== filters.companyId) return false;
  if (filters.paymentStatuses?.length && !filters.paymentStatuses.includes(a.status)) return false;
  const [y, m] = a.competence.split('-').map(Number);
  const fimMes = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (filters.dateFrom && fimMes < filters.dateFrom) return false;
  if (filters.dateTo && a.competence > filters.dateTo) return false;
  return true;
}

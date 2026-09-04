import { useMemo } from 'react';
import { useFinancialDashboard, FinancialProjectRow, SubscriptionChargeRow } from './useFinancialDashboard';

export interface FinancialReportFilters {
  companyId?: string;
  /** Etapas do projeto a incluir. Vazio/ausente = todas. É lista porque um
   *  extrato costuma juntar etapas diferentes (aprovado + vistoria
   *  solicitada + concluído que ainda não foi pago) — pedido do usuário. */
  statuses?: string[];
  paymentStatus?: string;
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

export interface FinancialReportRow {
  id: string;
  code: string;
  holderName: string;
  companyName: string;
  concessionaireName: string;
  status: string;
  projectValue: number;
  paidValue: number;
  balance: number;
  paymentStatus: string;
  createdAt: string;
  /** 'project' (padrão) ou 'subscription' — a mensalidade da assinatura entra
   *  no extrato como uma linha própria, uma por mês. */
  kind?: 'project' | 'subscription';
}

export interface FinancialReportSummary {
  totalProjects: number;
  totalValue: number;
  totalPaid: number;
  totalBalance: number;
}

/** Um projeto entra no extrato? Pura e exportada pra ser testável fora do React.
 *  Filtro ausente (ou lista de etapas vazia) = não restringe nada. */
export function matchesReportFilters(
  p: Pick<FinancialProjectRow, 'companyId' | 'status' | 'paymentStatus' | 'createdAt'>,
  filters: FinancialReportFilters,
): boolean {
  if (filters.companyId && p.companyId !== filters.companyId) return false;
  if (filters.statuses?.length && !filters.statuses.includes(p.status)) return false;
  if (filters.paymentStatus && p.paymentStatus !== filters.paymentStatus) return false;
  if (filters.dateFrom && p.createdAt < filters.dateFrom) return false;
  if (filters.dateTo && p.createdAt.slice(0, 10) > filters.dateTo) return false;
  return true;
}

/** Uma MENSALIDADE entra no extrato? Pura e exportada pra ser testável.
 *  O filtro de ETAPA não se aplica (mensalidade não tem etapa de projeto);
 *  empresa, status de pagamento e período valem. O período considera o mês
 *  inteiro da competência: uma mensalidade de julho entra num extrato que
 *  pegue qualquer dia de julho. */
export function matchesSubscriptionFilters(
  a: Pick<SubscriptionChargeRow, 'companyId' | 'status' | 'competence'>,
  filters: FinancialReportFilters,
): boolean {
  if (filters.companyId && a.companyId !== filters.companyId) return false;
  if (filters.paymentStatus && a.status !== filters.paymentStatus) return false;
  const [y, m] = a.competence.split('-').map(Number);
  const fimMes = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (filters.dateFrom && fimMes < filters.dateFrom) return false;
  if (filters.dateTo && a.competence > filters.dateTo) return false;
  return true;
}

export function useFinancialReport(filters: FinancialReportFilters) {
  const { data, isLoading } = useFinancialDashboard();

  const { rows, summary } = useMemo(() => {
    const projetos: FinancialProjectRow[] = data?.projetos || [];

    const filtered = projetos.filter(p => matchesReportFilters(p, filters));

    const rows: FinancialReportRow[] = filtered.map(p => ({
      id: p.id,
      code: p.code,
      holderName: p.holderName,
      companyName: p.companyName,
      concessionaireName: p.concessionaireName,
      status: p.status,
      projectValue: p.projectValue,
      paidValue: p.paidValue,
      balance: p.balance,
      paymentStatus: p.paymentStatus,
      createdAt: p.createdAt,
      kind: 'project' as const,
    }));

    // MENSALIDADES: uma linha por mês de cada empresa com assinatura. Entram
    // no mesmo extrato dos projetos (pedido do usuário: "a assinatura uma vez
    // por mês, mais o valor das RTs dos projetos"). Filtro de etapa não se
    // aplica — mensalidade não tem etapa de projeto; empresa, período e status
    // de pagamento valem normalmente.
    const assinaturas = (data?.assinaturas || []).filter(a => matchesSubscriptionFilters(a, filters));
    const subscriptionRows: FinancialReportRow[] = assinaturas.map(a => ({
      id: a.id,
      code: 'ASSINATURA',
      holderName: `Mensalidade — ${a.competenceLabel}`,
      companyName: a.companyName,
      concessionaireName: filters.hideFranchiseUsage === false && a.projectsIncluded != null
        ? `${a.projectsInMonth}/${a.projectsIncluded} projetos`
        : '—',
      status: 'subscription',
      projectValue: a.amount,
      paidValue: a.paidValue,
      balance: a.balance,
      paymentStatus: a.status,
      createdAt: a.competence,
      kind: 'subscription' as const,
    }));

    const all = [...subscriptionRows, ...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const summary: FinancialReportSummary = {
      totalProjects: rows.length,
      totalValue: all.reduce((s, r) => s + r.projectValue, 0),
      totalPaid: all.reduce((s, r) => s + r.paidValue, 0),
      totalBalance: all.reduce((s, r) => s + r.balance, 0),
    };

    return { rows: all, summary };
  }, [data, filters]);

  return { rows, summary, isLoading };
}

import { useMemo } from 'react';
import { useFinancialDashboard, FinancialProjectRow } from './useFinancialDashboard';

export interface FinancialReportFilters {
  companyId?: string;
  /** Etapas do projeto a incluir. Vazio/ausente = todas. É lista porque um
   *  extrato costuma juntar etapas diferentes (aprovado + vistoria
   *  solicitada + concluído que ainda não foi pago) — pedido do usuário. */
  statuses?: string[];
  paymentStatus?: string;
  dateFrom?: string;
  dateTo?: string;
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
    }));

    const summary: FinancialReportSummary = {
      totalProjects: rows.length,
      totalValue: rows.reduce((s, r) => s + r.projectValue, 0),
      totalPaid: rows.reduce((s, r) => s + r.paidValue, 0),
      totalBalance: rows.reduce((s, r) => s + r.balance, 0),
    };

    return { rows, summary };
  }, [data, filters]);

  return { rows, summary, isLoading };
}

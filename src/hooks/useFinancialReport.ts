import { useMemo } from 'react';
import { useFinancialDashboard, FinancialProjectRow, SubscriptionChargeRow } from './useFinancialDashboard';
// Os recortes moram em `financialReportFilters.ts`, sem React e sem Supabase,
// para poderem ser testados (este arquivo puxa o cliente, que le localStorage
// no carregamento e derruba o vitest, que roda sem DOM). Reexportados aqui
// para quem ja importava daqui nao precisar mudar.
import { matchesReportFilters, matchesSubscriptionFilters, type FinancialReportFilters } from './financialReportFilters';
export { matchesReportFilters, matchesSubscriptionFilters } from './financialReportFilters';
export type { FinancialReportFilters } from './financialReportFilters';

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

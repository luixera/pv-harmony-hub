import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface FinancialProjectRow {
  id: string;
  code: string;
  holderName: string;
  companyId: string;
  companyName: string;
  concessionaireName: string;
  status: string;
  projectValue: number;
  paidValue: number;
  balance: number;
  paymentStatus: string;
  dueDate: string | null;
  createdAt: string;
}

/** Cobrança da ASSINATURA MENSAL de uma empresa (uma por mês) — anda junto dos
 *  projetos no financeiro: na empresa com assinatura, o projeto cobra só a RT e
 *  a mensalidade é este lançamento. */
export interface SubscriptionChargeRow {
  id: string;
  companyId: string;
  companyName: string;
  /** 1º dia do mês cobrado (YYYY-MM-DD). */
  competence: string;
  /** "julho de 2026" — pronto pra tela. */
  competenceLabel: string;
  amount: number;
  paidValue: number;
  balance: number;
  status: string;
  dueDate: string | null;
  /** Franquia de projetos do mês e quantos entraram (pra conferir excedente). */
  projectsIncluded: number | null;
  projectsInMonth: number;
}

export interface FinancialKPIs {
  totalFaturado: number;
  totalRecebido: number;
  totalAberto: number;
  totalVencido: number;
}

export interface ByCompanyEntry {
  companyId: string;
  companyName: string;
  balance: number;
}

export interface ByStatusEntry {
  status: string;
  label: string;
  balance: number;
  color: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguard.',
  analysis: 'Análise',
  documentation: 'Doc.',
  approval: 'Aprova.',
  approved: 'Aprovado',
  completed: 'Concluído',
};
const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  analysis: '#378ADD',
  documentation: '#F5A800',
  approval: '#D85A30',
  approved: '#2D6A4F',
  completed: '#1A1A1A',
};

const QUERY_KEY = ['financial-dashboard'] as const;

export function useFinancialDashboard() {
  const queryClient = useQueryClient();

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Any INSERT / UPDATE / DELETE on project_financials or payment_history
  // immediately invalidates the dashboard cache so the page refreshes.
  useEffect(() => {
    const channel = supabase
      .channel('financial-dashboard-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_financials' },
        () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payment_history' },
        () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'company_subscription_charges' },
        () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY }); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // ── Query ─────────────────────────────────────────────────────────────────
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<{
      kpis: FinancialKPIs;
      porEmpresa: ByCompanyEntry[];
      porStatus: ByStatusEntry[];
      projetos: FinancialProjectRow[];
      assinaturas: SubscriptionChargeRow[];
    }> => {
      // Assinaturas mensais (uma cobrança por empresa/mês) — entram no
      // financeiro junto dos projetos: são recebíveis de verdade.
      const chargesRes = await supabase
        .from('company_subscription_charges' as never)
        .select('id, company_id, competence, amount, amount_paid, status, due_date, projects_included, companies:company_id (name)')
        .order('competence', { ascending: false });
      const chargeRows = (chargesRes.data ?? []) as unknown as {
        id: string; company_id: string; competence: string; amount: number; amount_paid: number;
        status: string; due_date: string | null; projects_included: number | null;
        companies: { name: string } | null;
      }[];

      const { data: projects, error: projErr } = await supabase
        .from('projects')
        .select(`
          id, code, status, created_at,
          company_id,
          companies:company_id (name),
          energy_concessionaires:concessionaire_id (name)
        `)
        .eq('is_deleted', false);
      if (projErr) throw projErr;

      const projectIds = (projects || []).map(p => p.id);

      // projetos por empresa/mês — mostra na assinatura quanto da franquia foi usado
      const monthKey = (iso: string) => iso.slice(0, 7);
      const porEmpresaMes = new Map<string, number>();
      for (const p of projects || []) {
        const k = `${p.company_id}|${monthKey(p.created_at)}`;
        porEmpresaMes.set(k, (porEmpresaMes.get(k) ?? 0) + 1);
      }
      const mesLabel = (competence: string) => {
        const [y, m] = competence.split('-');
        return `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(m) - 1] ?? m}/${y}`;
      };
      const assinaturas: SubscriptionChargeRow[] = chargeRows.map(c => {
        const amount = Number(c.amount ?? 0);
        const paidValue = Number(c.amount_paid ?? 0);
        return {
          id: c.id,
          companyId: c.company_id,
          companyName: c.companies?.name || '—',
          competence: c.competence,
          competenceLabel: mesLabel(c.competence),
          amount,
          paidValue,
          balance: Math.max(0, amount - paidValue),
          status: c.status || 'pending',
          dueDate: c.due_date,
          projectsIncluded: c.projects_included,
          projectsInMonth: porEmpresaMes.get(`${c.company_id}|${monthKey(c.competence)}`) ?? 0,
        };
      });

      if (projectIds.length === 0) {
        const abertoAssin = assinaturas.reduce((s, a) => s + a.balance, 0);
        return {
          kpis: {
            totalFaturado: assinaturas.reduce((s, a) => s + a.amount, 0),
            totalRecebido: assinaturas.reduce((s, a) => s + a.paidValue, 0),
            totalAberto: abertoAssin,
            totalVencido: 0,
          },
          porEmpresa: [],
          porStatus: [],
          projetos: [],
          assinaturas,
        };
      }

      const [gdRes, finRes] = await Promise.all([
        supabase
          .from('project_general_data')
          .select('project_id, holder_name')
          .in('project_id', projectIds),
        supabase
          .from('project_financials')
          .select('project_id, project_value, paid_value, payment_status, due_date')
          .in('project_id', projectIds),
      ]);

      const gdMap  = new Map((gdRes.data  || []).map(d => [d.project_id, d]));
      const finMap = new Map((finRes.data || []).map(f => [f.project_id, f]));
      const today  = new Date().toISOString().split('T')[0];

      const projetos: FinancialProjectRow[] = (projects || []).map(p => {
        const fin          = finMap.get(p.id);
        const gd           = gdMap.get(p.id);
        const projectValue = Number(fin?.project_value ?? 0);
        const paidValue    = Number(fin?.paid_value    ?? 0);
        return {
          id:                 p.id,
          code:               p.code,
          holderName:         gd?.holder_name || '—',
          companyId:          p.company_id,
          companyName:        (p.companies as { name: string } | null)?.name || '—',
          concessionaireName: (p.energy_concessionaires as { name: string } | null)?.name || '—',
          status:             p.status,
          projectValue,
          paidValue,
          balance:            Math.max(0, projectValue - paidValue),
          paymentStatus:      fin?.payment_status || 'pending',
          dueDate:            fin?.due_date || null,
          createdAt:          p.created_at,
        };
      });

      // ── KPIs (projetos + assinaturas) ───────────────────────────────────────
      const totalFaturado = projetos.reduce((s, p) => s + p.projectValue, 0)
        + assinaturas.reduce((s, a) => s + a.amount, 0);
      const totalRecebido = projetos.reduce((s, p) => s + p.paidValue, 0)
        + assinaturas.reduce((s, a) => s + a.paidValue, 0);
      const totalAberto   = projetos.reduce((s, p) => s + p.balance, 0)
        + assinaturas.reduce((s, a) => s + a.balance, 0);
      const totalVencido  = projetos
        .filter(p => p.paymentStatus !== 'paid' && p.dueDate && p.dueDate < today)
        .reduce((s, p) => s + p.balance, 0)
        + assinaturas
          .filter(a => a.status !== 'paid' && a.dueDate && a.dueDate < today)
          .reduce((s, a) => s + a.balance, 0);

      // ── Por empresa (projetos + assinaturas com saldo em aberto) ────────────
      const empresaMap = new Map<string, ByCompanyEntry>();
      const somaEmpresa = (companyId: string, companyName: string, balance: number) => {
        if (balance <= 0) return;
        const existing = empresaMap.get(companyId);
        if (existing) existing.balance += balance;
        else empresaMap.set(companyId, { companyId, companyName, balance });
      };
      for (const p of projetos) somaEmpresa(p.companyId, p.companyName, p.balance);
      for (const a of assinaturas) somaEmpresa(a.companyId, a.companyName, a.balance);
      const porEmpresa = Array.from(empresaMap.values())
        .sort((a, b) => b.balance - a.balance);

      // ── Por status ──────────────────────────────────────────────────────────
      const statusMap = new Map<string, number>();
      for (const p of projetos) {
        if (p.balance > 0) {
          statusMap.set(p.status, (statusMap.get(p.status) || 0) + p.balance);
        }
      }
      const porStatus: ByStatusEntry[] = Array.from(statusMap.entries()).map(
        ([status, balance]) => ({
          status,
          label:  STATUS_LABELS[status] || status,
          balance,
          color:  STATUS_COLORS[status]  || '#888',
        })
      );

      return { kpis: { totalFaturado, totalRecebido, totalAberto, totalVencido }, porEmpresa, porStatus, projetos, assinaturas };
    },
  });
}

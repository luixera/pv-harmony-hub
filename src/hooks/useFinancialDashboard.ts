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
    }> => {
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

      if (projectIds.length === 0) {
        return {
          kpis: { totalFaturado: 0, totalRecebido: 0, totalAberto: 0, totalVencido: 0 },
          porEmpresa: [],
          porStatus: [],
          projetos: [],
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

      // ── KPIs ────────────────────────────────────────────────────────────────
      const totalFaturado = projetos.reduce((s, p) => s + p.projectValue, 0);
      const totalRecebido = projetos.reduce((s, p) => s + p.paidValue,    0);
      const totalAberto   = projetos.reduce((s, p) => s + p.balance,      0);
      const totalVencido  = projetos
        .filter(p => p.paymentStatus !== 'paid' && p.dueDate && p.dueDate < today)
        .reduce((s, p) => s + p.balance, 0);

      // ── Por empresa (apenas projetos com saldo em aberto) ───────────────────
      const empresaMap = new Map<string, ByCompanyEntry>();
      for (const p of projetos) {
        if (p.balance <= 0) continue;
        const existing = empresaMap.get(p.companyId);
        if (existing) existing.balance += p.balance;
        else empresaMap.set(p.companyId, {
          companyId:   p.companyId,
          companyName: p.companyName,
          balance:     p.balance,
        });
      }
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

      return { kpis: { totalFaturado, totalRecebido, totalAberto, totalVencido }, porEmpresa, porStatus, projetos };
    },
  });
}

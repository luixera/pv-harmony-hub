import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Financial {
  id: string;
  project_id: string;
  company_id: string;
  project_value: number;
  paid_value: number;
  payment_status: 'pending' | 'partial' | 'paid';
  due_date: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  project?: {
    code: string;
    holder_name: string;
  };
  company?: {
    name: string;
  };
}

export interface FinancialPayment {
  id: string;
  project_id: string;
  payment_date: string;
  amount: number;
  notes: string | null;
  created_at: string;
}

export interface FinancialSummary {
  totalBilled: number;
  totalReceived: number;
  totalPending: number;
  totalOverdue: number;
  pendingProjectsCount: number;
}

// Fetch all financials (admin) — reads from project_financials (canonical table)
export function useFinancials() {
  return useQuery({
    queryKey: ['financials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_financials')
        .select('*')
        .order('due_date', { ascending: true });

      if (error) throw error;

      const projectIds = [...new Set((data || []).map(f => f.project_id))];

      const [projectsRes, generalDataRes, companiesRes] = await Promise.all([
        supabase.from('projects').select('id, code').in('id', projectIds),
        supabase.from('project_general_data').select('project_id, holder_name').in('project_id', projectIds),
        supabase.from('companies').select('id, name'),
      ]);

      const projectsMap = new Map((projectsRes.data || []).map(p => [p.id, p]));
      const generalDataMap = new Map((generalDataRes.data || []).map(g => [g.project_id, g]));
      const companiesMap = new Map((companiesRes.data || []).map(c => [c.id, c]));

      return (data || []).map(item => ({
        ...item,
        project_value: Number(item.project_value),
        paid_value: Number(item.paid_value),
        project: {
          code: projectsMap.get(item.project_id)?.code || '',
          holder_name: generalDataMap.get(item.project_id)?.holder_name || '',
        },
        company: item.company_id ? { name: companiesMap.get(item.company_id)?.name || '' } : null,
      })) as Financial[];
    },
  });
}

// Fetch financials by company — reads from project_financials (canonical table)
export function useFinancialsByCompany(companyId: string | undefined) {
  return useQuery({
    queryKey: ['financials', 'company', companyId],
    queryFn: async () => {
      if (!companyId) return [];

      const { data, error } = await supabase
        .from('project_financials')
        .select('*')
        .eq('company_id', companyId)
        .order('due_date', { ascending: true });

      if (error) throw error;

      const projectIds = [...new Set((data || []).map(f => f.project_id))];

      const [projectsRes, generalDataRes, companiesRes] = await Promise.all([
        supabase.from('projects').select('id, code').in('id', projectIds),
        supabase.from('project_general_data').select('project_id, holder_name').in('project_id', projectIds),
        supabase.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
      ]);

      const projectsMap = new Map((projectsRes.data || []).map(p => [p.id, p]));
      const generalDataMap = new Map((generalDataRes.data || []).map(g => [g.project_id, g]));

      return (data || []).map(item => ({
        ...item,
        project_value: Number(item.project_value),
        paid_value: Number(item.paid_value),
        project: {
          code: projectsMap.get(item.project_id)?.code || '',
          holder_name: generalDataMap.get(item.project_id)?.holder_name || '',
        },
        company: companiesRes.data ? { name: companiesRes.data.name } : null,
      })) as Financial[];
    },
    enabled: !!companyId,
  });
}

// Fetch financial by project — reads from project_financials (canonical table)
export function useFinancialByProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['financial', 'project', projectId],
    queryFn: async () => {
      if (!projectId) return null;

      const { data, error } = await supabase
        .from('project_financials')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        ...data,
        project_value: Number(data.project_value),
        paid_value: Number(data.paid_value),
      } as Financial;
    },
    enabled: !!projectId,
  });
}

// Fetch payments by project — reads from payment_history (canonical table)
export function useFinancialPayments(projectId: string | undefined) {
  return useQuery({
    queryKey: ['payment-history', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from('payment_history')
        .select('*')
        .eq('project_id', projectId)
        .order('payment_date', { ascending: false });

      if (error) throw error;

      return (data || []).map(item => ({
        ...item,
        amount: Number(item.amount),
      })) as FinancialPayment[];
    },
    enabled: !!projectId,
  });
}

// Calculate financial summary
export function useFinancialSummary() {
  const { data: financials } = useFinancials();
  
  const today = new Date().toISOString().split('T')[0];
  
  const summary: FinancialSummary = {
    totalBilled: 0,
    totalReceived: 0,
    totalPending: 0,
    totalOverdue: 0,
    pendingProjectsCount: 0
  };
  
  if (financials) {
    financials.forEach(f => {
      summary.totalBilled += f.project_value;
      summary.totalReceived += f.paid_value;

      const pending = f.project_value - f.paid_value;
      summary.totalPending += pending;

      if (f.payment_status !== 'paid') {
        summary.pendingProjectsCount++;

        if (f.due_date && f.due_date < today) {
          summary.totalOverdue += pending;
        }
      }
    });
  }
  
  return summary;
}

// Create or update financial for project — writes to project_financials (canonical table)
export function useUpsertFinancial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      companyId: string;
      projectValue: number;
      dueDate?: string | null;
    }) => {
      const { error } = await supabase
        .from('project_financials')
        .upsert(
          {
            project_id: data.projectId,
            company_id: data.companyId,
            project_value: data.projectValue,
            due_date: data.dueDate ?? null,
          },
          { onConflict: 'project_id' }
        );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financials'] });
      queryClient.invalidateQueries({ queryKey: ['financial'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.refetchQueries({ queryKey: ['projects'] });
      queryClient.refetchQueries({ queryKey: ['project'] });
    },
  });
}

// Add payment — writes to payment_history (canonical table)
export function useAddPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      paymentDate: string;
      amount: number;
      notes?: string;
    }) => {
      // Insert into payment_history
      const { error: phErr } = await supabase
        .from('payment_history')
        .insert({
          project_id: data.projectId,
          payment_date: data.paymentDate,
          amount: data.amount,
          notes: data.notes ?? null,
        });

      if (phErr) throw phErr;

      // Update paid_value + payment_status on project_financials
      const { data: fin } = await supabase
        .from('project_financials')
        .select('project_value, paid_value')
        .eq('project_id', data.projectId)
        .maybeSingle();

      if (fin) {
        const newPaid = Number(fin.paid_value) + data.amount;
        const newStatus = newPaid >= Number(fin.project_value) ? 'paid'
          : newPaid > 0 ? 'partial' : 'pending';

        await supabase
          .from('project_financials')
          .update({ paid_value: newPaid, payment_status: newStatus })
          .eq('project_id', data.projectId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financials'] });
      queryClient.invalidateQueries({ queryKey: ['financial'] });
      queryClient.invalidateQueries({ queryKey: ['financial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['payment-history'] });
    },
  });
}

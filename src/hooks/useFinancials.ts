import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Financial {
  id: string;
  project_id: string;
  company_id: string;
  project_value: number;
  amount_paid: number;
  status: 'pending' | 'partial' | 'paid';
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
  financial_id: string;
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

// Fetch all financials (admin)
export function useFinancials() {
  return useQuery({
    queryKey: ['financials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financials')
        .select(`
          *,
          companies:company_id(name)
        `)
        .order('due_date', { ascending: true });

      if (error) throw error;
      
      // Fetch project data separately
      const projectIds = [...new Set((data || []).map(f => f.project_id))];
      
      const { data: projects } = await supabase
        .from('projects')
        .select('id, code')
        .in('id', projectIds);
      
      const { data: generalData } = await supabase
        .from('project_general_data')
        .select('project_id, holder_name')
        .in('project_id', projectIds);
      
      const projectsMap = new Map((projects || []).map(p => [p.id, p]));
      const generalDataMap = new Map((generalData || []).map(g => [g.project_id, g]));
      
      return (data || []).map(item => ({
        ...item,
        project_value: Number(item.project_value),
        amount_paid: Number(item.amount_paid),
        project: {
          code: projectsMap.get(item.project_id)?.code || '',
          holder_name: generalDataMap.get(item.project_id)?.holder_name || ''
        },
        company: item.companies
      })) as Financial[];
    }
  });
}

// Fetch financials by company
export function useFinancialsByCompany(companyId: string | undefined) {
  return useQuery({
    queryKey: ['financials', 'company', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      
      const { data, error } = await supabase
        .from('financials')
        .select(`
          *,
          companies:company_id(name)
        `)
        .eq('company_id', companyId)
        .order('due_date', { ascending: true });

      if (error) throw error;
      
      // Fetch project data separately
      const projectIds = [...new Set((data || []).map(f => f.project_id))];
      
      const { data: projects } = await supabase
        .from('projects')
        .select('id, code')
        .in('id', projectIds);
      
      const { data: generalData } = await supabase
        .from('project_general_data')
        .select('project_id, holder_name')
        .in('project_id', projectIds);
      
      const projectsMap = new Map((projects || []).map(p => [p.id, p]));
      const generalDataMap = new Map((generalData || []).map(g => [g.project_id, g]));
      
      return (data || []).map(item => ({
        ...item,
        project_value: Number(item.project_value),
        amount_paid: Number(item.amount_paid),
        project: {
          code: projectsMap.get(item.project_id)?.code || '',
          holder_name: generalDataMap.get(item.project_id)?.holder_name || ''
        },
        company: item.companies
      })) as Financial[];
    },
    enabled: !!companyId
  });
}

// Fetch financial by project
export function useFinancialByProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['financial', 'project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      
      const { data, error } = await supabase
        .from('financials')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (error) throw error;
      
      if (!data) return null;
      
      return {
        ...data,
        project_value: Number(data.project_value),
        amount_paid: Number(data.amount_paid)
      } as Financial;
    },
    enabled: !!projectId
  });
}

// Fetch payments by financial
export function useFinancialPayments(financialId: string | undefined) {
  return useQuery({
    queryKey: ['financial-payments', financialId],
    queryFn: async () => {
      if (!financialId) return [];
      
      const { data, error } = await supabase
        .from('financial_payments')
        .select('*')
        .eq('financial_id', financialId)
        .order('payment_date', { ascending: false });

      if (error) throw error;
      
      return (data || []).map(item => ({
        ...item,
        amount: Number(item.amount)
      })) as FinancialPayment[];
    },
    enabled: !!financialId
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
      summary.totalReceived += f.amount_paid;
      
      const pending = f.project_value - f.amount_paid;
      summary.totalPending += pending;
      
      if (f.status !== 'paid') {
        summary.pendingProjectsCount++;
        
        if (f.due_date && f.due_date < today) {
          summary.totalOverdue += pending;
        }
      }
    });
  }
  
  return summary;
}

// Create or update financial for project
export function useUpsertFinancial() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      companyId: string;
      projectValue: number;
      dueDate?: string | null;
    }) => {
      // Check if financial exists
      const { data: existing } = await supabase
        .from('financials')
        .select('id')
        .eq('project_id', data.projectId)
        .maybeSingle();
      
      if (existing) {
        // Update
        const { error } = await supabase
          .from('financials')
          .update({
            project_value: data.projectValue,
            due_date: data.dueDate
          })
          .eq('id', existing.id);
        
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('financials')
          .insert({
            project_id: data.projectId,
            company_id: data.companyId,
            project_value: data.projectValue,
            due_date: data.dueDate
          });
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financials'] });
      queryClient.invalidateQueries({ queryKey: ['financial'] });
      queryClient.refetchQueries({ queryKey: ['projects'] });
      queryClient.refetchQueries({ queryKey: ['project'] });
    }
  });
}

// Add payment
export function useAddPayment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: {
      financialId: string;
      paymentDate: string;
      amount: number;
      notes?: string;
    }) => {
      const { error } = await supabase
        .from('financial_payments')
        .insert({
          financial_id: data.financialId,
          payment_date: data.paymentDate,
          amount: data.amount,
          notes: data.notes
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['financials'] });
      queryClient.invalidateQueries({ queryKey: ['financial'] });
      queryClient.invalidateQueries({ queryKey: ['financial-payments'] });
    }
  });
}

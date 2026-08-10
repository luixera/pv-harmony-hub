import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type Company = Database['public']['Tables']['companies']['Row'];
type CompanyInsert = Database['public']['Tables']['companies']['Insert'];

export function useCompanies() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  // Projetista restrito enxerga só as empresas ligadas a ele. É o que também
  // limita PRA QUAIS empresas ele consegue criar projeto, já que criar passa
  // por "ver como empresa" na tela de Empresas (ago/2026).
  const staffRestrito = user?.role === 'staff' && user?.staffAccessMode === 'assigned_only';

  return useQuery({
    queryKey: ['companies', tenantId, staffRestrito ? user?.id : 'todas'],
    queryFn: async (): Promise<Company[]> => {
      let permitidas: string[] | null = null;
      if (staffRestrito && user?.id) {
        const { data: vinculos, error: erroVinculos } = await supabase
          .from('staff_companies' as never)
          .select('company_id')
          .eq('staff_user_id', user.id);
        if (erroVinculos) console.warn('staff_companies indisponível:', erroVinculos.message);
        permitidas = ((vinculos ?? []) as unknown as { company_id: string }[]).map(v => v.company_id);
      }

      let query = supabase
        .from('companies')
        .select('*')
        .order('name');

      // Painel normal = apenas o próprio tenant (o master veria todos via RLS).
      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (permitidas !== null) {
        if (permitidas.length === 0) return [];
        query = query.in('id', permitidas);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['company', id],
    queryFn: async (): Promise<Company | null> => {
      if (!id) return null;

      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCompanyByToken(token: string | undefined) {
  return useQuery({
    queryKey: ['company-by-token', token],
    queryFn: async () => {
      if (!token) return null;

      const { data, error } = await supabase
        .rpc('get_company_by_public_token', { _token: token });

      if (error) throw error;
      
      if (!data || data.length === 0) {
        return null;
      }

      return data[0];
    },
    enabled: !!token,
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (company: Omit<CompanyInsert, 'id' | 'created_at' | 'updated_at' | 'public_form_token'>) => {
      const { data, error } = await supabase
        .from('companies')
        .insert(company)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Empresa criada com sucesso');
    },
    onError: (error) => {
      console.error('Error creating company:', error);
      toast.error('Erro ao criar empresa');
    },
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      id, 
      ...updates 
    }: Partial<Company> & { id: string }) => {
      const { data, error } = await supabase
        .from('companies')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Empresa atualizada');
    },
    onError: (error) => {
      console.error('Error updating company:', error);
      toast.error('Erro ao atualizar empresa');
    },
  });
}

export function useRegenerateCompanyToken() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (companyId: string) => {
      const newToken = crypto.randomUUID();
      
      const { data, error } = await supabase
        .from('companies')
        .update({ public_form_token: newToken })
        .eq('id', companyId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Token regenerado');
    },
    onError: (error) => {
      console.error('Error regenerating token:', error);
      toast.error('Erro ao regenerar token');
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface EnergyConcessionaire {
  id: string;
  name: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useEnergyConcessionaires(includeInactive = false) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;

  return useQuery({
    queryKey: ['energy-concessionaires', includeInactive, tenantId],
    queryFn: async (): Promise<EnergyConcessionaire[]> => {
      let query = supabase
        .from('energy_concessionaires')
        .select('*')
        .order('name', { ascending: true });

      // O painel normal mostra APENAS o próprio tenant. Sem este filtro, o
      // master (is_master) veria as concessionárias de todos os tenants pelo
      // RLS — o que aparecia como "duplicatas" (as cópias de cada tenant).
      // A visão cross-tenant é exclusiva do console /painel.
      if (tenantId) query = query.eq('tenant_id', tenantId);

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
    // NÃO desabilitar sem tenant: o formulário público (anônimo) também usa este
    // hook e depende do RLS. O filtro por tenant acima só se aplica a quem está
    // logado — é isso que corrige as "duplicatas" para o master no painel.
  });
}

/**
 * Concessionárias para o formulário PÚBLICO (anônimo), escopadas ao tenant dono
 * do link (via token da empresa). Usa um RPC SECURITY DEFINER para não expor as
 * concessionárias de outros tenants no dropdown público.
 */
export function usePublicConcessionaires(token: string | undefined) {
  return useQuery({
    queryKey: ['public-concessionaires', token],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      if (!token) return [];
      const { data, error } = await supabase.rpc('get_concessionaires_for_token', { _token: token } as never);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!token,
  });
}

export function useConcessionaire(id: string | undefined) {
  return useQuery({
    queryKey: ['energy-concessionaire', id],
    queryFn: async (): Promise<EnergyConcessionaire | null> => {
      if (!id) return null;
      
      const { data, error } = await supabase
        .from('energy_concessionaires')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateConcessionaire() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (name: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('energy_concessionaires')
        .insert({
          name: name.trim(),
          created_by: user?.id,
        })
        .select()
        .single();
      
      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe uma concessionária com este nome');
        }
        throw error;
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['energy-concessionaires'] });
      toast.success('Concessionária cadastrada com sucesso');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao cadastrar concessionária');
    },
  });
}

export function useUpdateConcessionaire() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from('energy_concessionaires')
        .update({ name: name.trim() })
        .eq('id', id)
        .select()
        .single();
      
      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe uma concessionária com este nome');
        }
        throw error;
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['energy-concessionaires'] });
      toast.success('Concessionária atualizada com sucesso');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao atualizar concessionária');
    },
  });
}

export function useToggleConcessionaireStatus() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { data, error } = await supabase
        .from('energy_concessionaires')
        .update({ is_active: isActive })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['energy-concessionaires'] });
      toast.success(data.is_active ? 'Concessionária ativada' : 'Concessionária desativada');
    },
    onError: () => {
      toast.error('Erro ao alterar status da concessionária');
    },
  });
}

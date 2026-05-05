import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';

type StaffAccessMode = Database['public']['Enums']['staff_access_mode'];

export interface StaffSettings {
  id: string;
  name: string;
  email: string;
  staff_access_mode: StaffAccessMode | null;
  hide_company_name: boolean | null;
  active: boolean;
}

export function useStaffUsers() {
  return useQuery({
    queryKey: ['staff-users'],
    queryFn: async (): Promise<StaffSettings[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, staff_access_mode, hide_company_name, active')
        .eq('role', 'staff')
        .order('name');

      if (error) throw error;
      return data as StaffSettings[];
    },
  });
}

export function useUpdateStaffSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      staffAccessMode,
      hideCompanyName,
    }: {
      userId: string;
      staffAccessMode: StaffAccessMode;
      hideCompanyName: boolean;
    }) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          staff_access_mode: staffAccessMode,
          hide_company_name: hideCompanyName,
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-users'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Configurações do staff atualizadas');
    },
    onError: (error) => {
      console.error('Error updating staff settings:', error);
      toast.error('Erro ao atualizar configurações');
    },
  });
}

export function useCurrentUserStaffSettings() {
  return useQuery({
    queryKey: ['current-user-staff-settings'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('staff_access_mode, hide_company_name')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      return data;
    },
  });
}

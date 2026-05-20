import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';

type Profile = Database['public']['Tables']['profiles']['Row'];
type UserRole = Database['public']['Enums']['user_role'];
type StaffAccessMode = Database['public']['Enums']['staff_access_mode'];

export interface UserWithCompany extends Profile {
  companyName?: string;
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async (): Promise<UserWithCompany[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          *,
          companies:company_id (name)
        `)
        .order('name');

      if (error) throw error;
      
      return data.map(u => ({
        ...u,
        companyName: (u.companies as { name: string } | null)?.name,
      }));
    },
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async (): Promise<Profile | null> => {
      if (!id) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Profile> & { id: string }) => {
      // Mutations sensíveis (role, company_id, active) são tratadas pela Edge Function
      // que valida no servidor que o solicitante é admin antes de aplicar.
      const { data, error } = await supabase.functions.invoke('update-user', {
        body: { userId: id, updates },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data.user as Profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário atualizado');
    },
    onError: (error: Error) => {
      console.error('Error updating user:', error);
      toast.error(error.message || 'Erro ao atualizar usuário');
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { userId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário excluído com sucesso');
    },
    onError: (error: Error) => {
      console.error('Error deleting user:', error);
      toast.error(error.message || 'Erro ao excluir usuário');
    },
  });
}

interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  companyId?: string;
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (userData: CreateUserData) => {
      // Use edge function to create user in Supabase Auth
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: userData.email,
          password: userData.password,
          name: userData.name,
          role: userData.role,
          companyId: userData.companyId,
          active: true,
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      return data.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuário criado com sucesso!');
    },
    onError: (error: Error) => {
      console.error('Error creating user:', error);
      if (error.message.includes('já está cadastrado') || error.message.includes('already registered')) {
        toast.error('Este email já está cadastrado');
      } else {
        toast.error(error.message || 'Erro ao criar usuário');
      }
    },
  });
}

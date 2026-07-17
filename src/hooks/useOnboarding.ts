import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Estado do tour de boas-vindas do usuário logado.
 * `pending` = ainda não concluiu/pulou (mostra automaticamente no 1º acesso).
 */
export function useOnboarding() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ['onboarding', userId],
    queryFn: async (): Promise<{ pending: boolean }> => {
      if (!userId) return { pending: false };
      const { data, error } = await supabase
        .from('profiles')
        .select('onboarding_completed_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return { pending: !((data as { onboarding_completed_at?: string } | null)?.onboarding_completed_at) };
    },
    enabled: !!userId,
    staleTime: Infinity,
  });

  const complete = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase
        .from('profiles')
        .update({ onboarding_completed_at: new Date().toISOString() } as never)
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', userId] }),
  });

  return {
    pending: query.data?.pending ?? false,
    isLoading: query.isLoading,
    complete: () => complete.mutate(),
  };
}

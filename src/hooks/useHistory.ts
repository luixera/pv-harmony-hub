import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type ProjectHistory = Database['public']['Tables']['project_history']['Row'];

export function useProjectHistory(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-history', projectId],
    queryFn: async (): Promise<ProjectHistory[]> => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from('project_history')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });
}

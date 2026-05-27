import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
// Re-export para preservar callers que importam de '@/hooks/useStageChecklists'
export { documentTypeLabels } from '@/lib/statusMapping';

export interface StageChecklist {
  id: string;
  from_status: string;
  to_status: string;
  required_documents: string[];
  custom_items: string[];
  enabled: boolean;
  created_at: string;
}

export function useStageChecklists() {
  return useQuery({
    queryKey: ['stage-checklists'],
    queryFn: async (): Promise<StageChecklist[]> => {
      const { data, error } = await supabase
        .from('stage_checklists')
        .select('*')
        .order('created_at');
      if (error) throw error;
      return data as StageChecklist[];
    },
  });
}

export function useChecklist(fromStatus: string, toStatus: string) {
  const { data: all = [] } = useStageChecklists();
  return all.find(c => c.from_status === fromStatus && c.to_status === toStatus) ?? null;
}

export function useUpdateChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<StageChecklist> & { id: string }) => {
      const { error } = await supabase
        .from('stage_checklists')
        .update(data)
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stage-checklists'] });
    },
  });
}

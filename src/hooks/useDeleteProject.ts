import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useDeleteProject() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ projectId, reason }: { projectId: string; reason: string }) => {
      const { data, error } = await supabase
        .rpc('soft_delete_project', {
          _project_id: projectId,
          _reason: reason,
        });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      toast.success('Projeto excluído com sucesso');
    },
    onError: (error: Error) => {
      console.error('Error deleting project:', error);
      toast.error(error.message || 'Erro ao excluir projeto');
    },
  });
}

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
      toast.success('Projeto excluído com sucesso');
      // A lista só é recarregada DEPOIS que o diálogo teve chance de fechar.
      // Invalidando aqui, o projeto some de `useProjects` (que filtra
      // is_deleted=false), o card do Kanban desmonta e leva junto o
      // AlertDialog ABERTO que ele renderiza. O Radix trava o body em
      // `pointer-events: none` enquanto o modal está aberto e só libera no
      // fechamento controlado — desmontado no meio, a tela inteira fica sem
      // receber clique: era o "sistema travado" ao excluir (jul/2026).
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['project'] });
      }, 0);
    },
    onError: (error: Error) => {
      console.error('Error deleting project:', error);
      toast.error(error.message || 'Erro ao excluir projeto');
    },
  });
}

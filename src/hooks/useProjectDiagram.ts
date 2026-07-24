import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DiagramSceneState } from '@/utils/cadEngine/editableLayout';

/**
 * Diagrama unifilar editado de um projeto — persistido em `project_diagrams`
 * (banco), substituindo o `localStorage` por navegador: o que o projetista
 * edita no escritório aparece igual em casa e pra equipe toda do tenant.
 * O salvamento é um upsert silencioso e debounced (ver `UnifilarTab`).
 */
export function useProjectDiagram(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-diagram', projectId],
    queryFn: async (): Promise<DiagramSceneState | null> => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('project_diagrams' as never)
        .select('scene_data')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw error;
      return (data as { scene_data?: DiagramSceneState } | null)?.scene_data ?? null;
    },
    enabled: !!projectId,
  });
}

export function useSaveProjectDiagram() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, sceneData }: { projectId: string; sceneData: DiagramSceneState }) => {
      const { error } = await supabase
        .from('project_diagrams' as never)
        .upsert({
          project_id: projectId,
          tenant_id: user?.tenantId,
          scene_data: sceneData,
          updated_by: user?.id,
        } as never, { onConflict: 'project_id' });
      if (error) throw error;
    },
    onSuccess: (_, { projectId }) => {
      // sem toast: é autosave em segundo plano (mesmo padrão do motor de templates)
      queryClient.invalidateQueries({ queryKey: ['project-diagram', projectId] });
    },
    onError: (e) => console.error('useSaveProjectDiagram', e),
  });
}

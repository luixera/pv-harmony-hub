import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DiagramSceneState } from '@/utils/cadEngine/editableLayout';

/**
 * Versões salvas do diagrama unifilar (`project_diagram_versions`).
 *
 * `project_diagrams` guarda o diagrama VIGENTE — um por projeto, sobrescrito
 * pelo autosave e por qualquer regeração do motor. Isto aqui é o histórico ao
 * lado: instantâneos nomeados, para restaurar. Nasceu de um clique errado em
 * "é microinversor" que apagou um unifilar já pronto (ago/2026).
 *
 * `tenant_id` e `created_by` são preenchidos por gatilho no banco — o cliente
 * não escolhe de qual tenant é a versão.
 */

export interface DiagramVersion {
  id: string;
  project_id: string;
  name: string;
  /** 'manual' = o usuário salvou · 'auto' = guardado antes de uma regeração. */
  origin: string;
  created_at: string;
  created_by: string | null;
  scene_data: DiagramSceneState;
}

/** Lista (sem o `scene_data`, que é pesado) — o conteúdo só é lido ao restaurar. */
export function useDiagramVersions(projectId: string | undefined) {
  return useQuery({
    queryKey: ['diagram-versions', projectId],
    queryFn: async (): Promise<Omit<DiagramVersion, 'scene_data'>[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_diagram_versions' as never)
        .select('id, project_id, name, origin, created_at, created_by')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('project_diagram_versions indisponível:', error.message);
        return [];
      }
      return (data ?? []) as unknown as Omit<DiagramVersion, 'scene_data'>[];
    },
    enabled: !!projectId,
  });
}

export function useSaveDiagramVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, name, sceneData, origin = 'manual' }: {
      projectId: string;
      name: string;
      sceneData: DiagramSceneState;
      origin?: 'manual' | 'auto';
    }) => {
      const { error } = await supabase
        .from('project_diagram_versions' as never)
        .insert({ project_id: projectId, name: name.slice(0, 120), origin, scene_data: sceneData } as never);
      if (error) throw error;
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['diagram-versions', projectId] });
    },
  });
}

/** Lê o conteúdo de uma versão (só na hora de restaurar). */
export async function fetchDiagramVersionScene(id: string): Promise<DiagramSceneState | null> {
  const { data, error } = await supabase
    .from('project_diagram_versions' as never)
    .select('scene_data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as { scene_data?: DiagramSceneState } | null)?.scene_data ?? null;
}

export function useDeleteDiagramVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; projectId: string }) => {
      const { error } = await supabase.from('project_diagram_versions' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['diagram-versions', projectId] });
    },
  });
}

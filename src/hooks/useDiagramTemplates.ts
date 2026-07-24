import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { DiagramSceneState } from '@/utils/cadEngine/editableLayout';

export interface DiagramTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  concessionaire_id: string | null;
  scene_data: DiagramSceneState;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_SCENE: DiagramSceneState = { placements: [], connections: [], photos: [], texts: [] };

/** Modelos de diagrama unifilar do próprio tenant — motor de templates (ver useDiagramEngineAccess). */
export function useDiagramTemplates() {
  return useQuery({
    queryKey: ['diagram-templates'],
    queryFn: async (): Promise<DiagramTemplate[]> => {
      const { data, error } = await supabase
        .from('diagram_templates' as never)
        .select('*')
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as DiagramTemplate[];
    },
  });
}

export function useDiagramTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ['diagram-template', id],
    queryFn: async (): Promise<DiagramTemplate | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('diagram_templates' as never)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DiagramTemplate | null;
    },
    enabled: !!id,
  });
}

export function useCreateDiagramTemplate() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; concessionaireId?: string }) => {
      const { data, error } = await supabase
        .from('diagram_templates' as never)
        .insert({
          tenant_id: user?.tenantId,
          name: input.name,
          description: input.description || null,
          concessionaire_id: input.concessionaireId || null,
          scene_data: EMPTY_SCENE,
          created_by: user?.id,
        } as never)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as DiagramTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagram-templates'] });
      toast.success('Modelo criado');
    },
    onError: () => toast.error('Erro ao criar o modelo'),
  });
}

interface UpdateDiagramTemplateInput {
  id: string;
  name?: string;
  description?: string | null;
  concessionaireId?: string | null;
  sceneData?: DiagramSceneState;
  /** Não mostra toast — usado no autosave do editor, que já roda em segundo plano. */
  silent?: boolean;
}

export function useUpdateDiagramTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, silent, ...patch }: UpdateDiagramTemplateInput) => {
      const payload: Record<string, unknown> = {};
      if (patch.name !== undefined) payload.name = patch.name;
      if (patch.description !== undefined) payload.description = patch.description;
      if (patch.concessionaireId !== undefined) payload.concessionaire_id = patch.concessionaireId;
      if (patch.sceneData !== undefined) payload.scene_data = patch.sceneData;
      const { error } = await supabase.from('diagram_templates' as never).update(payload as never).eq('id', id);
      if (error) throw error;
      return { silent };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['diagram-templates'] });
      queryClient.invalidateQueries({ queryKey: ['diagram-template', variables.id] });
      if (!result.silent) toast.success('Modelo salvo');
    },
    onError: () => toast.error('Erro ao salvar o modelo'),
  });
}

export function useDeleteDiagramTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('diagram_templates' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagram-templates'] });
      toast.success('Modelo excluído');
    },
    onError: () => toast.error('Erro ao excluir o modelo'),
  });
}

export function useDuplicateDiagramTemplate() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: DiagramTemplate) => {
      const { data, error } = await supabase
        .from('diagram_templates' as never)
        .insert({
          tenant_id: user?.tenantId,
          name: `${template.name} (cópia)`,
          description: template.description,
          concessionaire_id: template.concessionaire_id,
          scene_data: template.scene_data,
          created_by: user?.id,
        } as never)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as DiagramTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagram-templates'] });
      toast.success('Modelo duplicado');
    },
    onError: () => toast.error('Erro ao duplicar o modelo'),
  });
}

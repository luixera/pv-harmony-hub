import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface KanbanColumn {
  id: string;
  kanban_model_id: string;
  status_key: string;
  status_label: string;
  color: string;
  order_index: number;
  is_initial: boolean;
  is_final: boolean;
  is_rejection_stage: boolean;
  triggers_revision: boolean;
  requires_protocol: boolean;
  stale_days: number | null;
  created_at: string;
}

export interface KanbanModel {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  columns?: KanbanColumn[];
}

export interface CompanyKanbanModel {
  id: string;
  company_id: string;
  kanban_model_id: string;
  assigned_at: string;
  assigned_by: string | null;
}

// Fetch all kanban models (for admin)
export function useKanbanModels() {
  return useQuery({
    queryKey: ['kanban-models'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kanban_models')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as KanbanModel[];
    }
  });
}

// Fetch a specific kanban model with columns
export function useKanbanModelDetails(modelId: string | null) {
  return useQuery({
    queryKey: ['kanban-model', modelId],
    queryFn: async () => {
      if (!modelId) return null;

      const { data: model, error: modelError } = await supabase
        .from('kanban_models')
        .select('*')
        .eq('id', modelId)
        .single();

      if (modelError) throw modelError;

      const { data: columns, error: columnsError } = await supabase
        .from('kanban_columns')
        .select('*')
        .eq('kanban_model_id', modelId)
        .order('order_index', { ascending: true });

      if (columnsError) throw columnsError;

      return {
        ...model,
        columns: columns || []
      } as KanbanModel;
    },
    enabled: !!modelId
  });
}

// Fetch company kanban model assignments
export function useCompanyKanbanModels() {
  return useQuery({
    queryKey: ['company-kanban-models'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_kanban_model')
        .select(`
          *,
          companies:company_id (name),
          kanban_models:kanban_model_id (name)
        `);

      if (error) throw error;
      return data;
    }
  });
}

// Create a new kanban model
export function useCreateKanbanModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const { data: model, error } = await supabase
        .from('kanban_models')
        .insert({
          name: data.name,
          description: data.description || null,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;
      return model as KanbanModel;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-models'] });
      toast({
        title: 'Modelo criado',
        description: 'O novo modelo de Kanban foi criado com sucesso.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao criar modelo',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Update kanban model
export function useUpdateKanbanModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<KanbanModel> & { id: string }) => {
      const { error } = await supabase
        .from('kanban_models')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-models'] });
      queryClient.invalidateQueries({ queryKey: ['kanban-model'] });
    }
  });
}

// Create a kanban column
export function useCreateKanbanColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      kanban_model_id: string;
      status_key: string;
      status_label: string;
      color?: string;
      order_index: number;
      is_initial?: boolean;
      is_final?: boolean;
      is_rejection_stage?: boolean;
      triggers_revision?: boolean;
      requires_protocol?: boolean;
      stale_days?: number | null;
    }) => {
      const { data: column, error } = await supabase
        .from('kanban_columns')
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return column as KanbanColumn;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-model'] });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao criar coluna',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Update kanban column
export function useUpdateKanbanColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<KanbanColumn> & { id: string }) => {
      const { error } = await supabase
        .from('kanban_columns')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-model'] });
      toast({
        title: 'Coluna salva',
        description: 'As configurações da coluna foram salvas com sucesso.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao salvar coluna',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Delete kanban column
export function useDeleteKanbanColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (columnId: string) => {
      const { error } = await supabase
        .from('kanban_columns')
        .delete()
        .eq('id', columnId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-model'] });
      toast({
        title: 'Coluna removida',
        description: 'A coluna foi removida com sucesso.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao remover coluna',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Batch update column order
export function useUpdateColumnOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (columns: { id: string; order_index: number }[]) => {
      for (const column of columns) {
        const { error } = await supabase
          .from('kanban_columns')
          .update({ order_index: column.order_index })
          .eq('id', column.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-model'] });
    }
  });
}

// Duplicate a kanban model
export function useDuplicateKanbanModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sourceModelId: string) => {
      // Get source model
      const { data: sourceModel, error: modelError } = await supabase
        .from('kanban_models')
        .select('*')
        .eq('id', sourceModelId)
        .single();

      if (modelError) throw modelError;

      // Create new model
      const { data: newModel, error: newModelError } = await supabase
        .from('kanban_models')
        .insert({
          name: `${sourceModel.name} (Cópia)`,
          description: sourceModel.description,
          is_active: true
        })
        .select()
        .single();

      if (newModelError) throw newModelError;

      // Get source columns
      const { data: sourceColumns, error: columnsError } = await supabase
        .from('kanban_columns')
        .select('*')
        .eq('kanban_model_id', sourceModelId)
        .order('order_index', { ascending: true });

      if (columnsError) throw columnsError;

      // Copy columns
      if (sourceColumns && sourceColumns.length > 0) {
        const newColumns = sourceColumns.map(col => ({
          kanban_model_id: newModel.id,
          status_key: col.status_key,
          status_label: col.status_label,
          color: col.color,
          order_index: col.order_index,
          is_initial: col.is_initial,
          is_final: col.is_final
        }));

        const { error: insertError } = await supabase
          .from('kanban_columns')
          .insert(newColumns);

        if (insertError) throw insertError;
      }

      return newModel;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-models'] });
      toast({
        title: 'Modelo duplicado',
        description: 'O modelo foi duplicado com sucesso.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao duplicar modelo',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Assign kanban model to company
export function useAssignKanbanModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ companyId, modelId }: { companyId: string; modelId: string }) => {
      // Upsert - update if exists, insert if not
      const { error } = await supabase
        .from('company_kanban_model')
        .upsert({
          company_id: companyId,
          kanban_model_id: modelId,
          assigned_at: new Date().toISOString()
        }, { onConflict: 'company_id' });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-kanban-models'] });
      toast({
        title: 'Modelo atribuído',
        description: 'O modelo de Kanban foi atribuído à empresa com sucesso.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Erro ao atribuir modelo',
        description: error.message,
        variant: 'destructive'
      });
    }
  });
}

// Remove company kanban model assignment
export function useRemoveCompanyKanbanModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (companyId: string) => {
      const { error } = await supabase
        .from('company_kanban_model')
        .delete()
        .eq('company_id', companyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-kanban-models'] });
    }
  });
}

// Get the column marked as rejection stage (is_rejection_stage = true)
export function useRejectionColumn() {
  return useQuery({
    queryKey: ['rejection-column'],
    queryFn: async () => {
      const { data } = await supabase
        .from('kanban_columns')
        .select('id, status_key, status_label, kanban_model_id')
        .eq('is_rejection_stage', true)
        .limit(1)
        .maybeSingle();
      return data as Pick<KanbanColumn, 'id' | 'status_key' | 'status_label' | 'kanban_model_id'> | null;
    },
    staleTime: 60_000,
  });
}

// Update whether a column is the rejection stage, enforcing uniqueness per model
export function useUpdateColumnRejectionStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      columnId,
      modelId,
      isRejectionStage,
    }: {
      columnId: string;
      modelId: string;
      isRejectionStage: boolean;
    }) => {
      if (isRejectionStage) {
        // Desmarcar todas as outras colunas do mesmo modelo
        await supabase
          .from('kanban_columns')
          .update({ is_rejection_stage: false, triggers_revision: false })
          .eq('kanban_model_id', modelId)
          .neq('id', columnId);
      }

      const { error } = await supabase
        .from('kanban_columns')
        .update({
          is_rejection_stage: isRejectionStage,
          triggers_revision: isRejectionStage,
        })
        .eq('id', columnId);

      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['kanban-model', vars.modelId] });
      queryClient.invalidateQueries({ queryKey: ['kanban-model'] });
      queryClient.invalidateQueries({ queryKey: ['default-kanban-model'] });
      queryClient.invalidateQueries({ queryKey: ['rejection-column'] });
      if (vars.isRejectionStage) {
        toast({
          title: 'Coluna de reprovação configurada',
          description: 'Projetos movidos para esta coluna acionarão o sistema de revisões.',
        });
      } else {
        toast({ title: 'Coluna desmarcada' });
      }
    },
    onError: (error) => {
      toast({
        title: 'Erro ao configurar coluna',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ── Stale projects ────────────────────────────────────────────────────────────

export interface StaleProject {
  id: string;
  code: string;
  status: string;
  last_status_change: string;
  company_id: string;
  column_id: string;
  status_label: string;
  stale_days: number;
  days_stale: number;
}

/**
 * Returns every project that has been in its current column longer than the
 * column's `stale_days` threshold (querying the `stale_projects` view).
 */
export function useStaleProjects() {
  return useQuery({
    queryKey: ['stale-projects'],
    queryFn: async (): Promise<StaleProject[]> => {
      const { data, error } = await supabase
        .from('stale_projects')
        .select('*');
      if (error) throw error;
      return (data ?? []) as unknown as StaleProject[];
    },
    // Refresh every 10 minutes — stale detection doesn't need real-time precision
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

// Get default/active kanban model
export function useDefaultKanbanModel() {
  return useQuery({
    queryKey: ['default-kanban-model'],
    queryFn: async () => {
      const { data: models, error } = await supabase
        .from('kanban_models')
        .select(`
          *,
          columns:kanban_columns(*)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;
      if (!models || models.length === 0) return null;

      const model = models[0];
      return {
        ...model,
        columns: (model.columns || []).sort((a: KanbanColumn, b: KanbanColumn) => a.order_index - b.order_index)
      } as KanbanModel;
    }
  });
}

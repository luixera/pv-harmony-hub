import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Regras "card mudou de etapa no Kanban → cria tarefa para alguém".
 *
 * Quem cria a tarefa de fato é um gatilho no banco (trg_task_automations em
 * projects), e não este hook: a etapa muda por caminhos diferentes — arrastar
 * no quadro, o seletor do modal e a aplicação de etapa vinda do e-mail — e o
 * gatilho pega todos. Aqui só se configura a regra.
 *
 * As etapas são gravadas como `status_key` do template de Kanban, que é a
 * fonte da verdade das etapas (ver useDefaultKanbanModel).
 */

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskAutomation {
  id: string;
  tenant_id: string;
  name: string;
  /** null = vale para o card vindo de qualquer etapa */
  from_status: string | null;
  to_status: string;
  assigned_to: string;
  days_to_complete: number;
  priority: TaskPriority;
  title: string;
  description: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Variáveis aceitas no título e na descrição da tarefa. */
export const TASK_AUTOMATION_VARS = [
  'codigo', 'titular', 'empresa', 'etapa', 'etapa_anterior', 'dias',
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low',    label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high',   label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

export function useTaskAutomations() {
  return useQuery({
    queryKey: ['task-automations'],
    queryFn: async (): Promise<TaskAutomation[]> => {
      const { data, error } = await supabase
        .from('task_automations' as never)
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaskAutomation[];
    },
  });
}

export function useSaveTaskAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Partial<TaskAutomation> & { tenant_id?: string }) => {
      if (rule.id) {
        const { id, created_at, updated_at, tenant_id, created_by, ...upd } = rule;
        const { error } = await supabase
          .from('task_automations' as never).update(upd as never).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('task_automations' as never).insert(rule as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-automations'] });
      toast.success('Tarefa automática salva');
    },
    onError: (e) => { console.error(e); toast.error('Erro ao salvar a tarefa automática'); },
  });
}

export function useDeleteTaskAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('task_automations' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-automations'] });
      toast.success('Tarefa automática removida');
    },
    onError: (e) => { console.error(e); toast.error('Erro ao remover'); },
  });
}

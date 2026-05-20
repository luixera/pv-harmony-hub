import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  project_id: string | null;
  created_by: string;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
  project?: { id: string; code: string } | null;
  creator?: { name: string; role: string } | null;
  assignee?: { name: string; role: string } | null;
}

const TASK_SELECT = `
  *,
  project:projects(id, code),
  creator:profiles!created_by(name, role),
  assignee:profiles!assigned_to(name, role)
`;

// ── useTasks ─────────────────────────────────────────────────────────────────
export function useTasks(filters?: {
  status?: TaskStatus;
  assigned_to?: string;
  project_id?: string;
  created_by?: string;
}) {
  return useQuery({
    queryKey: ['tasks', filters],
    queryFn: async () => {
      let q = supabase
        .from('tasks')
        .select(TASK_SELECT)
        .not('status', 'eq', 'cancelled')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (filters?.status)      q = q.eq('status',      filters.status);
      if (filters?.assigned_to) q = q.eq('assigned_to', filters.assigned_to);
      if (filters?.project_id)  q = q.eq('project_id',  filters.project_id);
      if (filters?.created_by)  q = q.eq('created_by',  filters.created_by);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Task[];
    },
    staleTime: 1000 * 60 * 2,
  });
}

// ── useProjectTasks ───────────────────────────────────────────────────────────
export function useProjectTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: ['tasks', { project_id: projectId }],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('project_id', projectId)
        .not('status', 'eq', 'cancelled')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Task[];
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2,
  });
}

// ── useMyPendingTasks ─────────────────────────────────────────────────────────
export function useMyPendingTasks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['tasks-pending', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from('tasks')
        .select('id')
        .eq('assigned_to', user.id)
        .in('status', ['pending', 'in_progress']);
      return data || [];
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });
}

// ── useCreateTask ─────────────────────────────────────────────────────────────
export function useCreateTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (payload: {
      title: string;
      description?: string;
      priority: TaskPriority;
      due_date?: string;
      project_id?: string;
      assigned_to?: string;
    }) => {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          ...payload,
          created_by: user!.id,
          status: 'pending',
        })
        .select(TASK_SELECT)
        .single();
      if (error) throw error;

      // Notificar assignee se for outra pessoa
      if (payload.assigned_to && payload.assigned_to !== user!.id) {
        const { data: me } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user!.id)
          .single();

        const dueTxt = payload.due_date
          ? ` · Vence: ${new Date(payload.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}`
          : '';

        await supabase.from('notifications').insert({
          user_id: payload.assigned_to,
          title: '📋 Nova tarefa para você',
          message: `${me?.name || 'Alguém'} atribuiu: "${payload.title}"${dueTxt}`,
          type: 'task_assigned',
          project_id: payload.project_id || null,
          read: false,
        });
      }

      return data as Task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['tasks-pending'], exact: false });
      toast.success('Tarefa criada!');
    },
    onError: (err: Error) => {
      console.error('Error creating task:', err);
      toast.error('Erro ao criar tarefa');
    },
  });
}

// ── useUpdateTask ─────────────────────────────────────────────────────────────
export function useUpdateTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Task> & { id: string }) => {
      if (updates.status === 'completed') {
        updates.completed_at = new Date().toISOString();
        updates.completed_by = user!.id;
      }

      const { data, error } = await supabase
        .from('tasks')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(TASK_SELECT)
        .single();
      if (error) throw error;
      const task = data as Task;

      // Notificar criador ao concluir (se for outra pessoa)
      if (updates.status === 'completed' && task.created_by !== user!.id) {
        const { data: me } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user!.id)
          .single();

        await supabase.from('notifications').insert({
          user_id: task.created_by,
          title: '✅ Tarefa concluída',
          message: `${me?.name || 'Alguém'} concluiu: "${task.title}"`,
          type: 'task_completed',
          project_id: task.project_id || null,
          read: false,
        });
      }

      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['tasks-pending'], exact: false });
    },
    onError: (err: Error) => {
      console.error('Error updating task:', err);
      toast.error('Erro ao atualizar tarefa');
    },
  });
}

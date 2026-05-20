import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

function formatDateBR(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR');
}

/**
 * Roda uma vez por sessão ao montar.
 * Busca tarefas vencidas/vencendo hoje atribuídas ao usuário
 * e cria uma notificação se ainda não foi notificado hoje.
 */
export function useTaskAlerts() {
  const { user } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'staff')) return;
    if (ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      const today = new Date().toISOString().split('T')[0];

      // Tarefas vencidas ou vencendo hoje
      const { data: overdue } = await supabase
        .from('tasks')
        .select('id, title, due_date')
        .eq('assigned_to', user.id)
        .in('status', ['pending', 'in_progress'])
        .lte('due_date', today)
        .not('due_date', 'is', null);

      if (!overdue || overdue.length === 0) return;

      // Checar quais já foram notificadas hoje (busca notificações do tipo task_overdue de hoje)
      const todayStart = today + 'T00:00:00.000Z';
      const { data: existingToday } = await supabase
        .from('notifications')
        .select('title, message')
        .eq('user_id', user.id)
        .eq('type', 'task_overdue')
        .gte('created_at', todayStart);

      const alreadyNotified = new Set(
        (existingToday || []).map(n => n.message)
      );

      const toInsert = overdue
        .map(task => {
          const isToday = task.due_date === today;
          const msg = isToday
            ? `"${task.title}" vence hoje`
            : `"${task.title}" venceu em ${formatDateBR(task.due_date!)}`;
          return { task, msg };
        })
        .filter(({ msg }) => !alreadyNotified.has(msg));

      if (toInsert.length === 0) return;

      await supabase.from('notifications').insert(
        toInsert.map(({ task, msg }) => ({
          user_id: user.id,
          title: '⚠ Tarefa vencida',
          message: msg,
          type: 'task_overdue',
          project_id: null,
          read: false,
        }))
      );
    };

    run().catch(console.error);
  }, [user]);
}

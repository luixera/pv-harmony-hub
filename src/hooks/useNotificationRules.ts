import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface NotificationRule {
  id: string;
  tenant_id: string;
  name: string;
  event: string;
  status_filter: string | null;
  channel: string;
  destination: string;
  subject: string | null;
  body: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const NOTIFY_EVENTS: { value: string; label: string }[] = [
  { value: 'project_created', label: 'Projeto recebido (novo)' },
];

/** Variáveis disponíveis nos templates. */
export const NOTIFY_VARS = [
  'codigo', 'titular', 'empresa', 'concessionaria', 'cpf_cnpj', 'email', 'telefone',
  'endereco', 'cidade', 'uf', 'uc', 'disjuntor', 'fase',
  'marca_inversor', 'modelo_inversor', 'marca_modulo', 'modelo_modulo', 'potencia_total', 'status', 'data',
];

export function useNotificationRules() {
  return useQuery({
    queryKey: ['notification-rules'],
    queryFn: async (): Promise<NotificationRule[]> => {
      const { data, error } = await supabase
        .from('notification_rules' as never)
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as NotificationRule[];
    },
  });
}

export function useSaveRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Partial<NotificationRule> & { tenant_id?: string }) => {
      if (rule.id) {
        const { id, created_at, updated_at, ...upd } = rule;
        const { error } = await supabase.from('notification_rules' as never).update(upd as never).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('notification_rules' as never).insert(rule as never);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-rules'] }); toast.success('Automação salva'); },
    onError: (e) => { console.error(e); toast.error('Erro ao salvar automação'); },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notification_rules' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-rules'] }); toast.success('Automação removida'); },
    onError: (e) => { console.error(e); toast.error('Erro ao remover'); },
  });
}

/** Envia um e-mail de teste com o template atual. */
export async function sendTestEmail(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('notify-dispatch', {
    body: { test: { to, subject, body } },
  });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true };
}

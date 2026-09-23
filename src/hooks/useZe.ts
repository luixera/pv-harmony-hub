import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import { toast } from 'sonner';

/**
 * ZÉ (José) — o assistente pessoal do gestor no WhatsApp.
 *
 * Aqui mora só o que a TELA precisa: a configuração da conexão e as ações
 * administrativas (conectar por QR, estado, teste de envio, desconectar),
 * que passam pela edge `ze-admin`. O conteúdo do WhatsApp (wa_*) só o dono
 * lê, e nesta entrega a tela nem mostra.
 *
 * Restrito ao ADMIN do tenant GD Manager (`is_library`), como o Bidu e a
 * Ludmilla.
 */

export type SituacaoZe = 'desconectado' | 'aguardando_qr' | 'conectado';

export interface ZeConfig {
  tenant_id: string;
  owner_user_id: string;
  instance_name: string;
  phone_jid: string | null;
  situacao: SituacaoZe;
  qr_code: string | null;
  enabled: boolean;
  horas_sem_resposta: number;
  ignorar_grupos: boolean;
  dias_parado: number;
  transcrever_audios: 'todos' | 'so_meus' | 'nenhum';
  silencio_quando_vazio: boolean;
  updated_at: string;
}

export type AcaoZe = 'estado' | 'conectar' | 'teste_envio' | 'desconectar';

export function useZeDisponivel(): boolean {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  if (!user) return false;
  return user.role === 'admin' && !!tenant?.is_library;
}

export function useZeConfig() {
  const disponivel = useZeDisponivel();
  return useQuery({
    queryKey: ['ze-config'],
    enabled: disponivel,
    queryFn: async (): Promise<ZeConfig | null> => {
      const { data, error } = await supabase.from('ze_config' as never).select('*').maybeSingle();
      if (error) throw error;
      return (data as ZeConfig | null) ?? null;
    },
    // Enquanto espera o QR ser lido, a tela acompanha de perto.
    refetchInterval: (q) => ((q.state.data as ZeConfig | null)?.situacao === 'aguardando_qr' ? 4000 : 30000),
  });
}

export function useZeAcao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (acao: AcaoZe) => {
      const { data, error } = await supabase.functions.invoke('ze-admin', { body: { acao } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'o Zé não respondeu');
      return data as { ok: true; config: Partial<ZeConfig>; wa_id?: string };
    },
    onSuccess: (_d, acao) => {
      qc.invalidateQueries({ queryKey: ['ze-config'] });
      if (acao === 'teste_envio') toast.success('Mensagem enviada — olhe o chat "Você" no seu WhatsApp');
      if (acao === 'desconectar') toast.success('Zé desconectado');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

type PreferenciasZe = Partial<Pick<ZeConfig,
  'horas_sem_resposta' | 'ignorar_grupos' | 'dias_parado' | 'transcrever_audios' | 'silencio_quando_vazio' | 'enabled'
>>;

export function useAtualizarZeConfig() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: PreferenciasZe) => {
      if (!user?.tenantId) throw new Error('sem tenant na sessão');
      // A RLS já limita ao tenant; o filtro explícito é o hábito da casa.
      const { error } = await supabase.from('ze_config' as never).update(patch as never).eq('tenant_id', user.tenantId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ze-config'] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

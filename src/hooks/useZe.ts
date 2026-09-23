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

// ── Caixa de sugestões e ações pendentes ─────────────────────────────────────

export interface ZeTarefaSugerida {
  id: string;
  titulo: string;
  descricao: string | null;
  vencimento: string | null;
  prioridade: 'low' | 'medium' | 'high';
  project_id: string | null;
  assigned_to: string | null;
  motivo: string | null;
  origem: 'rotina' | 'conversa' | 'varredura';
  situacao: 'pendente' | 'aceita' | 'recusada' | 'expirada';
  task_id: string | null;
  created_at: string;
  projeto?: { code: string; status: string } | null;
}

export interface ZePendencia {
  id: string;
  tipo: 'mover_etapa';
  resumo: string;
  payload: Record<string, unknown>;
  expira_em: string;
  created_at: string;
}

/**
 * As tarefas que o Zé SUGERIU e ainda esperam decisão. Elas não estão em
 * `tasks` — a lista oficial só recebe o que o gestor aceita (decisão do
 * usuário, set/2026).
 */
export function useZeSugestoes() {
  const disponivel = useZeDisponivel();
  return useQuery({
    queryKey: ['ze-sugestoes'],
    enabled: disponivel,
    queryFn: async (): Promise<ZeTarefaSugerida[]> => {
      const { data, error } = await supabase
        .from('ze_tarefas_sugeridas' as never)
        .select('*, projeto:project_id(code, status)')
        .eq('situacao', 'pendente')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ZeTarefaSugerida[];
    },
    refetchInterval: 60000,
  });
}

export function useZePendencias() {
  const disponivel = useZeDisponivel();
  return useQuery({
    queryKey: ['ze-pendencias'],
    enabled: disponivel,
    queryFn: async (): Promise<ZePendencia[]> => {
      const { data, error } = await supabase
        .from('ze_pending_actions' as never)
        .select('id, tipo, resumo, payload, expira_em, created_at')
        .eq('situacao', 'pendente')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ZePendencia[];
    },
    refetchInterval: 60000,
  });
}

export interface AjustesDaSugestao {
  titulo?: string;
  vencimento?: string;
  prioridade?: string;
  assigned_to?: string;
}

/** Aceitar é o que transforma a sugestão em tarefa de verdade. */
export function useAceitarSugestao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ajustes }: { id: string; ajustes?: AjustesDaSugestao }) => {
      const { data, error } = await supabase.rpc('ze_aceitar_tarefa_sugerida' as never, {
        _id: id, _ajustes: ajustes ?? {},
      } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ze-sugestoes'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Virou tarefa na sua lista');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRecusarSugestao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('ze_recusar_tarefa_sugerida' as never, { _id: id } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ze-sugestoes'] });
      toast.success('Sugestão descartada');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Confirmar aqui faz exatamente o que confirmar pelo WhatsApp faria. */
export function useResolverPendencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, confirmar }: { id: string; confirmar: boolean }) => {
      const { data, error } = await supabase.rpc('ze_resolver_pendencia' as never, {
        _id: id, _confirmar: confirmar,
      } as never);
      if (error) throw error;
      return data as unknown as { ok: boolean; acao?: string; motivo?: string };
    },
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ['ze-pendencias'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      if (r?.ok) toast.success(v.confirmar ? 'Feito — a etapa mudou' : 'Cancelado');
      else toast.error(r?.motivo ?? 'não deu para resolver');
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

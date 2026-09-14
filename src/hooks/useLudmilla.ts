import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import { toast } from 'sonner';

/**
 * LUDMILLA — a funcionária que acompanha os portais das concessionárias.
 *
 * Aqui mora só o que a TELA precisa: as contas de portal (login por
 * concessionária), gravar credencial, pedir um run e ler o resultado dos
 * runs. A senha nunca passa por aqui de volta: vai por RPC para o Vault e
 * só o robô, na VPS, consegue lê-la.
 *
 * Restrita ao tenant GD Manager (`is_library`), como o Bidu.
 */

export const LUDMILLA_USER_ID = '00000000-10d1-4000-8000-000000000002';

export type SituacaoConta = 'nao_configurado' | 'ok' | 'sessao_expirada' | 'erro';
export type TipoRun = 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura';
export type SituacaoRun = 'na_fila' | 'rodando' | 'ok' | 'erro';

export interface PortalAccount {
  id: string;
  concessionaire_id: string;
  connector: string;
  login: string | null;
  situacao: SituacaoConta;
  ultimo_erro: string | null;
  ultima_varredura_em: string | null;
  enabled: boolean;
  updated_at: string;
}

/** O que o robô responde num `teste_login` (ver worker/ludmilla/src/conectores). */
export interface VereditoLogin {
  veredito: 'entrou' | 'pediu_codigo_email' | 'pediu_codigo_sms' | 'senha_recusada' | 'desconhecido';
  explicacao: string;
  url_final: string;
  titulo: string;
}

export interface PortalRun {
  id: string;
  account_id: string;
  tipo: TipoRun;
  situacao: SituacaoRun;
  pedido_em: string;
  iniciado_em: string | null;
  terminado_em: string | null;
  erro: string | null;
  print_path: string | null;
  resultado: Record<string, unknown> | null;
}

/** A Ludmilla existe para este usuário? Só equipe do tenant biblioteca. */
export function useLudmillaDisponivel(): boolean {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  if (!user) return false;
  return (user.role === 'admin' || user.role === 'staff') && !!tenant?.is_library;
}

/** A Ludmilla sabe entrar neste portal? (espelha o CASE de set_portal_credentials) */
export function conectorParaConcessionaria(nome: string): 'cpfl' | 'elektro' | null {
  const n = nome.toUpperCase();
  if (n.includes('CPFL')) return 'cpfl';
  if (n.includes('ELEKTRO')) return 'elektro';
  return null;
}

export function usePortalAccounts() {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['portal-accounts'],
    queryFn: async (): Promise<PortalAccount[]> => {
      const { data, error } = await supabase.from('portal_accounts' as never).select('*');
      if (error) throw error;
      return (data ?? []) as PortalAccount[];
    },
    enabled: disponivel,
    staleTime: 60_000,
  });
}

export function usePortalRuns(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['portal-runs', accountId],
    queryFn: async (): Promise<PortalRun[]> => {
      const { data, error } = await supabase
        .from('portal_sync_runs' as never)
        .select('*')
        .eq('account_id', accountId as string)
        .order('pedido_em', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as PortalRun[];
    },
    enabled: !!accountId,
    // o robô leva de 20 s a 1 min por visita: a tela acompanha sozinha
    refetchInterval: (q) => (q.state.data?.some(r => r.situacao === 'na_fila' || r.situacao === 'rodando') ? 5_000 : false),
  });
}

/** Grava login + senha (a senha vai para o Vault e não volta). Só admin. */
export function useSetPortalCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ concessionaireId, login, senha }: { concessionaireId: string; login: string; senha: string }) => {
      const { data, error } = await supabase.rpc('set_portal_credentials' as never, {
        p_concessionaire_id: concessionaireId, p_login: login, p_senha: senha,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-accounts'] });
      toast.success('Acesso ao portal gravado. A senha ficou cifrada; só a Ludmilla lê.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Pede um run à Ludmilla ("Testar acesso", "Verificar agora"). */
export function usePedirRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, tipo }: { accountId: string; tipo: TipoRun }) => {
      const { data, error } = await supabase.rpc('ludmilla_pedir_run' as never, {
        p_account_id: accountId, p_tipo: tipo,
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, { accountId, tipo }) => {
      qc.invalidateQueries({ queryKey: ['portal-runs', accountId] });
      toast.success(tipo === 'teste_login'
        ? 'Pedido feito. A Ludmilla entra no portal e conta o que viu — leva menos de um minuto.'
        : 'Pedido enviado à Ludmilla.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** URL temporária do print de um run (bucket privado). */
export async function urlDoPrint(printPath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('ludmilla').createSignedUrl(printPath, 600);
  if (error) return null;
  return data.signedUrl;
}

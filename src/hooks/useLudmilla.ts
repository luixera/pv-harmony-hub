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

export type ModoConta = 'vps' | 'local';

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
  /** vps = robô na VPS (padrão); local = estação do coworking (Elektro: CAPTCHA digitado por gente) */
  modo: ModoConta;
  /** usuário staff com quem a estação entra no GD Manager — só ele pega os runs desta conta */
  operador_local: string | null;
  /** último batimento da estação (a cada 60 s enquanto ligada) */
  estacao_vista_em: string | null;
  /** desde quando a estação está logada no portal sem precisar de login (sessão viva) */
  sessao_viva_desde: string | null;
}

// ── Código da imagem respondido pela equipe (de longe) ───────────────────────

export interface PortalCaptcha {
  id: string;
  account_id: string;
  run_id: string | null;
  imagem_path: string;
  situacao: 'aguardando' | 'respondido' | 'usado' | 'recusado' | 'expirado' | 'cancelado';
  tentativa: number;
  mensagem: string | null;
  criado_em: string;
  expira_em: string;
}

/**
 * Pedidos de código abertos pela estação. A página consulta a cada 5 s:
 * é assim que o cartão "Digite o código" aparece para quem já está nela.
 */
export function usePortalCaptchas() {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['portal-captchas'],
    queryFn: async (): Promise<PortalCaptcha[]> => {
      const { data, error } = await supabase
        .from('portal_captchas' as never)
        .select('*')
        .eq('situacao', 'aguardando')
        .gt('expira_em', new Date().toISOString())
        .order('criado_em', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as PortalCaptcha[];
    },
    enabled: disponivel,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });
}

/** A pessoa digitou os caracteres da imagem: vai para a estação, que preenche e envia. */
export function useResponderCaptcha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ captchaId, resposta }: { captchaId: string; resposta: string }) => {
      const { error } = await supabase.rpc('ludmilla_captcha_responder' as never, {
        p_captcha_id: captchaId, p_resposta: resposta,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-captchas'] });
      toast.success('Código enviado. A estação preenche e entra no portal em alguns segundos.');
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ['portal-captchas'] });
      toast.error(e.message);
    },
  });
}

/** Estação ligada = pulsou nos últimos 3 min. Só faz sentido para contas `local`. */
export function estadoDaEstacao(conta: PortalAccount, agora = Date.now()): { online: boolean; texto: string } | null {
  if (conta.modo !== 'local') return null;
  if (!conta.operador_local) return { online: false, texto: 'estação sem operador — escolha um usuário no acesso ao portal' };
  if (!conta.estacao_vista_em) return { online: false, texto: 'estação nunca ligou — instale a Ludmilla no PC do coworking' };
  const min = Math.floor((agora - new Date(conta.estacao_vista_em).getTime()) / 60_000);
  if (min <= 3) return { online: true, texto: 'estação online' };
  const quando = min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} dias`;
  return { online: false, texto: `estação offline há ${quando}` };
}

/** Equipe do tenant (admin + staff ativos) — quem pode ser o operador da estação. */
export function useEquipeDoTenant(habilitado = true) {
  return useQuery({
    queryKey: ['equipe-do-tenant'],
    queryFn: async (): Promise<{ id: string; name: string | null; email: string | null; role: string }[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, role')
        .in('role', ['admin', 'staff'])
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null; email: string | null; role: string }[];
    },
    enabled: habilitado,
    staleTime: 5 * 60_000,
  });
}

/** Onde a Ludmilla roda para esta conta (VPS ou estação local) e quem é o operador. Só admin (RLS). */
export function useAtualizarContaPortal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, modo, operadorLocal }: { accountId: string; modo: ModoConta; operadorLocal: string | null }) => {
      if (modo === 'local' && !operadorLocal) throw new Error('Escolha o usuário com quem a estação entra no GD Manager.');
      const { error } = await supabase
        .from('portal_accounts' as never)
        .update({ modo, operador_local: modo === 'local' ? operadorLocal : null } as never)
        .eq('id', accountId);
      if (error) throw error;
    },
    onSuccess: (_v, { modo }) => {
      qc.invalidateQueries({ queryKey: ['portal-accounts'] });
      toast.success(modo === 'local'
        ? 'Conta na estação local. Os próximos pedidos vão para o PC do coworking.'
        : 'Conta na VPS. A Ludmilla visita este portal pela VPS.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
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
    // a estação pulsa a cada 60 s: a tela acompanha o online/offline sozinha
    refetchInterval: 60_000,
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

// ── Relatório de recomendações ───────────────────────────────────────────────

export interface PortalUpdate {
  id: string;
  account_id: string;
  protocolo: string;
  titular_portal: string | null;
  status_portal: string;
  status_anterior: string | null;
  project_id: string | null;
  casamento: 'protocolo' | 'cpf' | 'uc' | 'titular' | null;
  recomendacao: string | null;
  /** true = o projeto foi casado por CPF/UC/título e o protocolo do cadastro é outro: aplicar atualiza o protocolo */
  atualizar_protocolo: boolean;
  protocolo_anterior: string | null;
  situacao: 'pendente' | 'aplicada' | 'ignorada';
  aplicada_por: string | null;
  aplicada_em: string | null;
  detectado_em: string;
  raw: Record<string, string> | null;
  project?: { id: string; code: string; status: string; title: string | null } | null;
}

export function usePortalUpdates(situacao: 'pendente' | 'aplicada' | 'ignorada' | 'todas' = 'pendente') {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['portal-updates', situacao],
    queryFn: async (): Promise<PortalUpdate[]> => {
      let q = supabase
        .from('portal_updates' as never)
        .select('*, project:projects(id, code, status, title)')
        .order('detectado_em', { ascending: false })
        .limit(200);
      if (situacao !== 'todas') q = q.eq('situacao', situacao);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PortalUpdate[];
    },
    enabled: disponivel,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Aplica a recomendação: move o card (etapa recomendada ou a escolhida) e registra no histórico. */
export function useAplicarUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status?: string }) => {
      const { error } = await supabase.rpc('ludmilla_aplicar_update' as never, { p_update_id: id, p_status: status ?? null } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-updates'], exact: false });
      qc.invalidateQueries({ queryKey: ['projects'], exact: false });
      toast.success('Card movido. Ficou no histórico com você como autor e a Ludmilla como origem.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useIgnorarUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('ludmilla_ignorar_update' as never, { p_update_id: id } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-updates'], exact: false }),
    onError: (e: Error) => toast.error(e.message),
  });
}

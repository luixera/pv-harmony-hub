import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import { toast } from 'sonner';
import { textoAplicado, type ProjetoParaIdentidade } from '@/lib/ludmillaCartao';

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
export type TipoRun = 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura' | 'criar_projeto' | 'varredura_email';
export type SituacaoRun = 'na_fila' | 'rodando' | 'ok' | 'erro';

export type ModoConta = 'vps' | 'local';

/**
 * COMO a concessionária é acompanhada — ortogonal a `modo`, que diz ONDE o robô
 * roda. `portal` = ela entra no site; `email` = ela lê a caixa e interpreta as
 * mensagens. Não existe conta com os dois (coluna `acompanhamento`, CHECK no
 * banco): a tela escolhe os campos de um meio ou do outro.
 */
export type AcompanhamentoConta = 'portal' | 'email';

export interface PortalAccount {
  id: string;
  tenant_id: string;
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
  /** portal = ela entra no site; email = ela lê a caixa (EDP, ENEL) */
  acompanhamento: AcompanhamentoConta;
  /**
   * Só vale para quem é acompanhada por e-mail: `protocolo_no_assunto` (EDP) parte
   * do projeto e exige o protocolo no assunto; `remetente` (ENEL) parte do e-mail,
   * pelos remetentes, e descobre o projeto. Decide quais contadores a tela mostra.
   */
  identificacao: IdentificacaoConta;
}

export type IdentificacaoConta = 'protocolo_no_assunto' | 'remetente';

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
  dados: Record<string, unknown> | null;
}

export interface PassoCriacao {
  id: string;
  run_id: string;
  passo: number;
  nome: 'login' | 'introducao' | 'dados_uc' | 'dados_projeto' | 'dados_cliente' | 'revisao' | 'concluido' | 'simulado';
  status: 'rodando' | 'ok' | 'erro';
  screenshot: string | null;
  erro: string | null;
  created_at: string;
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
  const { data, error } = await supabase.storage.from('ludmilla').createSignedUrl(printPath, 3600);
  if (error) return null;
  return data.signedUrl;
}

// ── Criação de projeto na CPFL ───────────────────────────────────────────────

/**
 * Solicita criação do projeto na CPFL. Devolve o run_id para subscrição Realtime.
 * `simular` = a Ludmilla preenche tudo, tira os prints, e PARA antes do Salvar.
 */
export function useCriarProjetoCpfl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, projectId, simular }: { accountId: string; projectId: string; simular?: boolean }): Promise<string> => {
      const { data, error } = await supabase.rpc('ludmilla_pedir_run' as never, {
        p_account_id: accountId,
        p_tipo:       'criar_projeto',
        p_dados:      { project_id: projectId, ...(simular ? { simular: true } : {}) },
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_runId, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['portal-runs', accountId] });
    },
    onError: (e: Error) => toast.error(`Não foi possível iniciar a criação: ${e.message}`),
  });
}

/** Subscreve em tempo real os passos de um run de criação. `terminado` = o run acabou: para de consultar. */
export function usePassosCriacao(runId: string | null, terminado = false) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!runId) return;
    const canal = supabase
      .channel(`criacao-${runId}`)
      .on('postgres_changes' as never, {
        event: '*',
        schema: 'public',
        table: 'portal_criacao_passos',
        filter: `run_id=eq.${runId}`,
      }, () => {
        void qc.invalidateQueries({ queryKey: ['passos-criacao', runId] });
      })
      .subscribe();
    return () => { void canal.unsubscribe(); };
  }, [runId, qc]);

  return useQuery({
    queryKey: ['passos-criacao', runId],
    queryFn: async (): Promise<PassoCriacao[]> => {
      if (!runId) return [];
      const { data, error } = await supabase
        .from('portal_criacao_passos' as never)
        .select('*')
        .eq('run_id', runId)
        .order('passo', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PassoCriacao[];
    },
    enabled: !!runId,
    refetchInterval: (q) => {
      if (terminado) return false;
      const passos = q.state.data ?? [];
      const acabou = passos.some(
        p => ((p.nome === 'concluido' || p.nome === 'simulado') && p.status === 'ok') || p.status === 'erro'
      );
      return acabou ? false : 3_000;
    },
  });
}

/**
 * Acompanha UM run de criação (situação e erro): é o que mostra falhas que
 * acontecem antes do passo 1 (login) e o "na fila". Consulta a cada 3 s até
 * o run terminar.
 */
export function useRunCriacao(runId: string | null) {
  return useQuery({
    queryKey: ['run-criacao', runId],
    queryFn: async (): Promise<PortalRun | null> => {
      if (!runId) return null;
      const { data, error } = await supabase
        .from('portal_sync_runs' as never)
        .select('*')
        .eq('id', runId)
        .maybeSingle();
      if (error) throw error;
      return (data as PortalRun | null) ?? null;
    },
    enabled: !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.situacao;
      return s === 'na_fila' || s === 'rodando' || !s ? 3_000 : false;
    },
  });
}

/** Últimos runs de criação CPFL (todos, independente de conta). */
export function useRunsCriacaoCpfl(limit = 20) {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['runs-criacao-cpfl'],
    queryFn: async (): Promise<PortalRun[]> => {
      const { data, error } = await supabase
        .from('portal_sync_runs' as never)
        .select('*')
        .eq('tipo', 'criar_projeto')
        .order('pedido_em', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as PortalRun[];
    },
    enabled: disponivel,
    refetchInterval: 10_000,
  });
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
  project?: ProjetoDoCartao | null;
}

/**
 * O projeto como o cartão o recebe: além do código e da etapa, a EMPRESA e o titular
 * do CADASTRO — pedido do usuário (16/10/2026): todo cartão mostra os dois nomes.
 * `companies` e `project_general_data` são os mesmos embeds que as edge functions
 * `ze-brain` e `bidu-chat` já usam; passam pela RLS normal de quem lê.
 */
export interface ProjetoDoCartao extends ProjetoParaIdentidade {
  id: string;
  code: string;
  status: string;
  title: string | null;
}

export function usePortalUpdates(situacao: 'pendente' | 'aplicada' | 'ignorada' | 'todas' = 'pendente') {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['portal-updates', situacao],
    queryFn: async (): Promise<PortalUpdate[]> => {
      let q = supabase
        .from('portal_updates' as never)
        .select('*, project:projects(id, code, status, title, companies:company_id(name), project_general_data(holder_name))')
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

/**
 * Aplica a recomendação: move o card (etapa recomendada ou a escolhida) e registra no histórico.
 *
 * `silencioso`: sem o aviso de sucesso. A caixa de decisões (`useAcoesDaCaixa`) já disse o que
 * vai acontecer no aviso com "Desfazer"; este chegaria 8 s depois, embaixo da tela, e no celular
 * cobriria o rodapé fixo do detalhe. O aviso de ERRO continua: a fila de decisões conta com ele.
 */
export function useAplicarUpdate(opcoes: { silencioso?: boolean } = {}) {
  const qc = useQueryClient();
  const { silencioso = false } = opcoes;
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status?: string }) => {
      const { error } = await supabase.rpc('ludmilla_aplicar_update' as never, { p_update_id: id, p_status: status ?? null } as never);
      if (error) throw error;
    },
    onSuccess: (_d, { status }) => {
      qc.invalidateQueries({ queryKey: ['portal-updates'], exact: false });
      qc.invalidateQueries({ queryKey: ['projects'], exact: false });
      // sem etapa só o protocolo do cadastro mudou: dizer "card movido" seria falso
      if (!silencioso) toast.success(textoAplicado(status));
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

// ── Registro: o que a Ludmilla fez e o que foi feito através dela ────────────

export type AtorLudmilla = 'ludmilla' | 'equipe';

export interface RegistroLudmilla {
  quando: string;
  ator: AtorLudmilla;
  /** nome de quem fez (ou "Ludmilla" / "agendamento") */
  quem: string | null;
  acao: 'visita' | 'recomendacao' | 'aplicada' | 'ignorada' | 'anexo' | 'parecer'
      | 'captcha_pedido' | 'captcha_respondido' | 'tarefa_encerrada';
  titulo: string;
  detalhe: string | null;
  situacao: 'ok' | 'erro' | 'aviso';
  project_id: string | null;
  /** código do projeto, quando o evento é de um projeto */
  projeto: string | null;
  protocolo: string | null;
}

/**
 * Leitura unificada do que já está gravado (visitas, recomendações, decisões
 * da equipe, anexos, pareceres, códigos de imagem, tarefas encerradas) — por
 * isso o registro já nasce com todo o histórico, sem tabela de log nova.
 */
export function useRegistroLudmilla(limite = 120, ator?: AtorLudmilla) {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['ludmilla-registro', limite, ator ?? 'todos'],
    queryFn: async (): Promise<RegistroLudmilla[]> => {
      const { data, error } = await supabase.rpc('ludmilla_registro' as never, {
        p_limite: limite, p_ator: ator ?? null,
      } as never);
      if (error) throw error;
      return (data ?? []) as RegistroLudmilla[];
    },
    enabled: disponivel,
    staleTime: 30_000,
  });
}

// ── Acompanhamento por e-mail: as regras de leitura ──────────────────────────

export type TipoDocumentoEmail =
  | 'parecer' | 'carta_obras' | 'nota' | 'outro'
  // ENEL (CHECK da migração 20261013120000): o tipo da regra é só uma dica
  | 'carta_projeto' | 'resultado_vistoria' | 'troca_relogio' | 'resposta_automatica' | 'devolucao' | 'comunicado';

/**
 * Uma linha = "e-mail com este trecho no assunto (e deste remetente, quando a
 * regra informa um) é um documento deste tipo". Mora no banco, nunca no código:
 * é o usuário quem ensina a robô a reconhecer os e-mails da concessionária.
 * Sem nenhuma regra ativa, o run de e-mail se recusa a rodar.
 */
export interface RegraEmail {
  id: string;
  account_id: string;
  remetente: string | null;
  assunto: string;
  tipo_documento: TipoDocumentoEmail;
  anexar: boolean;
  ler_pdf: boolean;
  ativo: boolean;
  ordem: number;
  created_at: string;
}

export function useRegrasEmail(accountId: string | null) {
  return useQuery({
    queryKey: ['regras-email', accountId],
    queryFn: async (): Promise<RegraEmail[]> => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('portal_email_regras' as never)
        .select('*')
        .eq('account_id', accountId as string)
        .order('ordem', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as RegraEmail[];
    },
    enabled: !!accountId,
    staleTime: 60_000,
  });
}

/** Cria ou altera uma regra. Só `admin` grava (RLS); staff lê. */
export function useSalvarRegraEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      r: Partial<RegraEmail> & { account_id: string; tenant_id: string },
    ) => {
      const { id, ...campos } = r;
      const { error } = id
        ? await supabase.from('portal_email_regras' as never).update(campos as never).eq('id', id)
        : await supabase.from('portal_email_regras' as never).insert(campos as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regras-email'], exact: false });
      toast.success('Regra salva. Vale a partir da próxima leitura da caixa.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApagarRegraEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('portal_email_regras' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regras-email'], exact: false });
      toast.success('Regra apagada. Os e-mails já lidos continuam no histórico.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ── Acompanhamento por e-mail: o que ela já leu ──────────────────────────────

export interface MensagemEmail {
  id: string;
  account_id: string;
  run_id: string | null;
  message_id: string;
  protocolo: string;
  project_id: string | null;
  assunto: string | null;
  remetente: string | null;
  recebido_em: string | null;
  tipo_documento: TipoDocumentoEmail | null;
  veredito: 'favoravel' | 'pendencia' | 'inconclusivo' | null;
  resumo: string | null;
  /** arquivos que chegaram ao card por causa desta mensagem */
  anexos: number;
  /** a ressalva da robô sobre esta mensagem, quando há uma */
  motivo: string | null;
  /** true = não há mais nada a fazer; false = um run futuro tenta de novo */
  concluida: boolean;
  /** a partir de 5 o robô desiste — e nada avisa ninguém: é esta tela que avisa */
  tentativas: number;
  /** qual anexo a IA leu (o PDF maior do e-mail), para conferir se foi o certo */
  arquivo_lido: string | null;
  update_id: string | null;
  created_at: string;
  project?: { id: string; code: string; status: string; title: string | null } | null;
}

/**
 * O QUE PEDE ATENÇÃO nesta mensagem. Existe porque o robô, sozinho, não avisa:
 * quem passou de 5 tentativas foi abandonado em silêncio, e o e-mail que
 * nenhuma regra reconheceu é marcado como concluído de propósito (é
 * configuração, não falha passageira). A recuperação dos dois é humana e só
 * acontece aqui, pela ação "ler de novo".
 *
 * - `desistiu`       — passou do teto de tentativas; não volta mais sozinho.
 * - `a_tentar`       — ficou para o próximo run (IA ou anexo falharam).
 * - `nao_reconheci`  — nenhuma regra casou, então não chegou a projeto nenhum.
 * - `ressalva`       — terminou, mas com um porém registrado (anexo bloqueado
 *                      por titular divergente, imagem não anexada, PDF ausente).
 */
export type AtencaoEmail = 'desistiu' | 'a_tentar' | 'nao_reconheci' | 'ressalva' | null;

export function atencaoDaMensagem(m: MensagemEmail): AtencaoEmail {
  if (!m.concluida) return m.tentativas >= 5 ? 'desistiu' : 'a_tentar';
  if (!m.project_id) return 'nao_reconheci';
  if (m.motivo) return 'ressalva';
  return null;
}

export function useMensagensEmail(accountId: string | null, limite = 200) {
  return useQuery({
    queryKey: ['mensagens-email', accountId, limite],
    queryFn: async (): Promise<MensagemEmail[]> => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('portal_email_mensagens' as never)
        .select('*, project:projects(id, code, status, title)')
        .eq('account_id', accountId as string)
        .order('created_at', { ascending: false })
        .limit(limite);
      if (error) throw error;
      return (data ?? []) as MensagemEmail[];
    },
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

/**
 * "Ler de novo": zera as tentativas e tira a mensagem de concluída, para o
 * próximo run tratá-la outra vez. É a ÚNICA recuperação de uma mensagem que
 * travou — e é o que faz a correção de uma regra valer para os e-mails antigos.
 * Não mexe no card do projeto: só manda a robô olhar aquela mensagem de novo.
 */
export function useRelerEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mensagemId: string) => {
      const { error } = await supabase.rpc('ludmilla_email_reler' as never, {
        p_mensagem_id: mensagemId,
      } as never);
      if (!error) return;
      // A RPC ainda não existe no banco (nenhuma migração a criou, e
      // `portal_email_mensagens` não tem política de UPDATE para o app). Dizer
      // isso é melhor do que um erro cru do PostgREST — ou, pior, um silêncio
      // que faria o usuário acreditar que a mensagem voltou para a fila.
      const cod = (error as { code?: string }).code;
      if (cod === 'PGRST202' || cod === '42883') {
        throw new Error(
          'A ação "ler de novo" ainda não está no banco (falta a função ludmilla_email_reler). '
          + 'Nada foi alterado: a mensagem continua como está.',
        );
      }
      throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mensagens-email'], exact: false });
      toast.success('Marcada para ser lida de novo. A robô volta nela na próxima leitura da caixa — o card do projeto não mudou agora.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * A última leitura da caixa desta conta. É de onde saem os contadores do
 * cartão: eles são a rede de segurança do automático (imagem descartada,
 * anexo bloqueado, mensagem que ficou para a próxima).
 */
export function useUltimoRunEmail(accountId: string | null) {
  return useQuery({
    queryKey: ['ultimo-run-email', accountId],
    queryFn: async (): Promise<PortalRun | null> => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from('portal_sync_runs' as never)
        .select('*')
        .eq('account_id', accountId as string)
        .eq('tipo', 'varredura_email')
        .order('pedido_em', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as PortalRun[])[0] ?? null;
    },
    enabled: !!accountId,
    // o run leva de segundos a minutos: a tela acompanha sozinha enquanto roda
    refetchInterval: (q) => (q.state.data?.situacao === 'na_fila' || q.state.data?.situacao === 'rodando' ? 5_000 : false),
  });
}

/** Um contador do JSON `resultado` do run, ou null quando o run não o gravou. */
export function contadorDoRun(run: PortalRun | null | undefined, chave: string): number | null {
  const v = run?.resultado?.[chave];
  return typeof v === 'number' ? v : null;
}

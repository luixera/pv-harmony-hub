import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { SituacaoConta } from './erros.js';
import { carregarSessao, guardarSessao, modoAtual, nomeRpc } from './local.js';

/**
 * A fila da Ludmilla vive no banco (`portal_sync_runs`), e este módulo é a
 * única porta do robô para ela. Tudo passa por RPC: na VPS com service role;
 * na estação local (LUDMILLA_MODO=local) com a sessão do usuário operador e
 * as RPCs `_local`, que o banco só deixa o `operador_local` da conta chamar.
 * O robô não tem SELECT direto em tabela nenhuma além do que as funções expõem.
 */

export interface Run {
  id: string;
  tenant_id: string;
  account_id: string;
  tipo: 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura' | 'criar_projeto';
  situacao: string;
  dados?: Record<string, unknown>;
}

export interface Credenciais {
  login: string;
  senha: string;
  connector: string;
}

export interface Fechamento {
  situacao: 'ok' | 'erro';
  erro?: string;
  resultado?: unknown;
  printPath?: string;
  protocolos?: number;
  mudancas?: number;
  situacaoConta?: SituacaoConta;
}

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('Falta SUPABASE_URL no ambiente.');
  if (modoAtual() === 'local') {
    // Estação: chave pública + sessão do usuário operador (guardada em arquivo).
    // Service role NUNCA sai da VPS.
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!anon) throw new Error('Falta SUPABASE_ANON_KEY no ambiente da estação.');
    cliente = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });
    cliente.auth.onAuthStateChange((_ev, s) => {
      if (s?.refresh_token) guardarSessao({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? 0 });
    });
    return cliente;
  }
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

/**
 * Estação: retoma a sessão guardada (ou entra com e-mail/senha na primeira vez,
 * via `--login`). Devolve o e-mail do operador ou lança com a instrução.
 */
export async function entrarNaEstacao(login?: { email: string; senha: string }): Promise<string> {
  const c = supabase();
  if (login) {
    const { data, error } = await c.auth.signInWithPassword({ email: login.email, password: login.senha });
    if (error || !data.session) throw new Error(`Não consegui entrar no GD Manager: ${error?.message ?? 'sem sessão'}`);
    guardarSessao({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at ?? 0 });
    return data.user?.email ?? login.email;
  }
  const s = carregarSessao();
  if (!s) throw new Error('A estação ainda não entrou no GD Manager. Rode: node dist/index.js --login');
  const { data, error } = await c.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  if (error || !data.session) throw new Error(`A sessão da estação expirou (${error?.message ?? 'sem sessão'}). Rode de novo: node dist/index.js --login`);
  return data.user?.email ?? '';
}

/** Heartbeat da estação — a página mostra online/offline por ele. */
export async function pulsar(): Promise<void> {
  if (modoAtual() !== 'local') return;
  await supabase().rpc('ludmilla_estacao_pulsa').then(() => undefined, () => undefined);
}

/** Próximo run da fila, já marcado como `rodando`; null quando não há. */
export async function pegarRun(): Promise<Run | null> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_claim_run'));
  if (error) throw new Error(`Não consegui consultar a fila: ${error.message}`);
  const linhas = (data ?? []) as Run[];
  return linhas[0] ?? null;
}

export async function finalizarRun(runId: string, f: Fechamento): Promise<void> {
  const { error } = await supabase().rpc(nomeRpc('ludmilla_finalizar_run'), {
    p_run_id: runId,
    p_situacao: f.situacao,
    p_erro: f.erro ?? null,
    p_resultado: f.resultado ?? null,
    p_print_path: f.printPath ?? null,
    p_protocolos: f.protocolos ?? 0,
    p_mudancas: f.mudancas ?? 0,
    p_situacao_conta: f.situacaoConta ?? null,
  });
  if (error) throw new Error(`Não consegui fechar o run ${runId}: ${error.message}`);
}

/** Conector da conta — sem decifrar a senha (basta para o reconhecimento). */
export async function conectorDaConta(accountId: string): Promise<string> {
  const { data, error } = await supabase()
    .from('portal_accounts')
    .select('connector')
    .eq('id', accountId)
    .single();
  if (error || !data) throw new Error(`Conta ${accountId} não encontrada: ${error?.message ?? 'sem dados'}`);
  return data.connector as string;
}

/** Credenciais decifradas — só na varredura, só na hora de usar. */
export async function credenciais(accountId: string): Promise<Credenciais> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_portal_credentials'), { p_account_id: accountId });
  if (error) throw new Error(`Não consegui ler as credenciais: ${error.message}`);
  const linha = ((data ?? []) as Credenciais[])[0];
  if (!linha) throw new Error('A conta não tem credencial gravada ou está desativada.');
  return linha;
}

// ── Criação de projeto na CPFL ───────────────────────────────────────────────

import type { DadosCriacaoCpfl } from './conectores/cpfl-criar.js';

/** Carrega todos os dados necessários para criar um projeto na CPFL. */
export async function dadosCriacaoCpfl(
  runId: string,
  projectId: string,
  tenantId: string,
): Promise<DadosCriacaoCpfl> {
  const { data, error } = await supabase().rpc('ludmilla_dados_criacao_cpfl' as never, {
    p_run_id:     runId,
    p_project_id: projectId,
  } as never);
  if (error) throw new Error(`Não consegui carregar dados para criação: ${error.message}`);
  const d = ((data ?? []) as Record<string, unknown>[])[0];
  if (!d) throw new Error('Dados de criação não encontrados para o projeto.');
  // Defaults de autonomia para projetos de GD (sobrescritos pelo que vier em dados do run)
  const autonomiaBase: Record<string, string> = {
    tipo_conexao:    'conexao', // Introdução: "Conexão de microgeração" (UC existente)
    opcao_orcamento: 'conexao', // Dados da UC: "Orçamento de Conexão" (não o Estimado)
  };
  const autonomiaRun = (d['autonomia'] ?? {}) as Record<string, string>;

  return {
    project_id:    projectId,
    tenant_id:     tenantId,
    run_id:        runId,
    uc_number:     String(d['uc_number'] ?? ''),
    coordinates:   String(d['coordinates'] ?? ''),
    customer_name: String(d['customer_name'] ?? ''),
    customer_cpf:  String(d['customer_cpf'] ?? ''),
    project_title: String(d['project_title'] ?? ''),
    modulos:       (d['modulos'] ?? []) as { quantidade: number; potencia_wp: number }[],
    entry_phase:   d['entry_phase'] ? String(d['entry_phase']) : null,
    entry_breaker: d['entry_breaker'] ? String(d['entry_breaker']) : null,
    autonomia:     { ...autonomiaBase, ...autonomiaRun },
  };
}

/** Retorna true se houver algum run `criar_projeto` na_fila. Usado para poll dinâmico. */
export async function temCriacaoPendente(): Promise<boolean> {
  const { data, error } = await supabase()
    .from('portal_sync_runs' as never)
    .select('id')
    .eq('tipo', 'criar_projeto')
    .eq('situacao', 'na_fila')
    .limit(1);
  if (error) return false;
  return ((data as unknown[]) ?? []).length > 0;
}

/** Sobe um arquivo de texto (HTML da descoberta) no bucket, na pasta do run. */
export async function subirTexto(tenantId: string, runId: string, nome: string, conteudo: string): Promise<string> {
  const path = `${tenantId}/${runId}/${nome}`;
  const { error } = await supabase().storage.from('ludmilla').upload(path, Buffer.from(conteudo, 'utf8'), {
    contentType: 'text/html; charset=utf-8', upsert: true,
  });
  if (error) throw new Error(`Não consegui guardar ${nome}: ${error.message}`);
  return path;
}

/** Sobe o print no bucket privado `ludmilla`, na pasta do tenant. Devolve o path. */
export async function subirPrint(tenantId: string, runId: string, png: Buffer): Promise<string> {
  const path = `${tenantId}/${runId}.png`;
  const { error } = await supabase().storage.from('ludmilla').upload(path, png, {
    contentType: 'image/png', upsert: true,
  });
  if (error) throw new Error(`Não consegui guardar o print: ${error.message}`);
  return path;
}

// ── Anexos da concessionária para o card ─────────────────────────────────────

export interface AnexoPendente {
  id: string;
  project_id: string;
  company_id: string;
  protocolo: string;
  id_arquivo: string;
  nome_arquivo: string;
  codigo: string;
}

/** O que o banco autorizou anexar (projeto casado E titular/UC conferidos). */
export async function anexosPendentes(accountId: string): Promise<AnexoPendente[]> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_anexos_pendentes'), { p_account_id: accountId });
  if (error) throw new Error(`Não consegui listar os anexos pendentes: ${error.message}`);
  return (data ?? []) as AnexoPendente[];
}

/** Nome de arquivo seguro para o bucket (mesma ideia do sanitizeFileName do front). */
const nomeSeguro = (nome: string) =>
  nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 120);

/**
 * Sobe o arquivo no bucket dos documentos do projeto, no MESMO caminho que o
 * front usa para anexos de comentário ({empresa}/{projeto}/other_photos/…).
 */
export async function subirDocumento(a: AnexoPendente, bytes: Buffer, mime: string): Promise<string> {
  const path = `${a.company_id}/${a.project_id}/other_photos/${Date.now()}_${nomeSeguro(a.nome_arquivo)}`;
  const { error } = await supabase().storage.from('project-documents').upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(`Não consegui guardar o anexo no projeto: ${error.message}`);
  return path;
}

export async function anexoEnviado(anexoId: string, filePath: string, mime: string): Promise<void> {
  const { error } = await supabase().rpc(nomeRpc('ludmilla_anexo_enviado'), { p_anexo_id: anexoId, p_file_path: filePath, p_file_type: mime });
  if (error) throw new Error(`Não consegui registrar o anexo no card: ${error.message}`);
}

export async function anexoErro(anexoId: string, motivo: string): Promise<void> {
  await supabase().rpc(nomeRpc('ludmilla_anexo_erro'), { p_anexo_id: anexoId, p_motivo: motivo.slice(0, 500) });
}

// ── Código da imagem respondido pela equipe (de longe) ───────────────────────
// Mesmas RPCs nos dois modos: o banco aceita service role OU o operador da conta.

/** foto de cada pedido aberto, para apagar do bucket ao fechar */
const fotosPorPedido = new Map<string, string>();

/** Sobe a foto do código no bucket e abre o pedido; a equipe recebe o sino. */
export async function pedirCaptcha(run: Run, png: Buffer, tentativa: number, mensagem?: string): Promise<string> {
  const path = `${run.tenant_id}/captcha/${run.id}-${tentativa}-${Date.now()}.png`;
  const { error: eUp } = await supabase().storage.from('ludmilla').upload(path, png, { contentType: 'image/png', upsert: true });
  if (eUp) throw new Error(`Não consegui guardar a foto do código: ${eUp.message}`);
  const { data, error } = await supabase().rpc('ludmilla_captcha_pedir', {
    p_run_id: run.id, p_imagem_path: path, p_tentativa: tentativa, p_mensagem: mensagem ?? null,
  });
  if (error) throw new Error(`Não consegui pedir o código à equipe: ${error.message}`);
  const id = String(data);
  fotosPorPedido.set(id, path);
  return id;
}

export async function lerCaptcha(id: string): Promise<{ situacao: string; resposta?: string | null }> {
  const { data, error } = await supabase().rpc('ludmilla_captcha_ler', { p_captcha_id: id });
  if (error) throw new Error(`Não consegui ler a resposta do código: ${error.message}`);
  const linha = ((data ?? []) as { situacao: string; resposta: string | null }[])[0];
  return linha ?? { situacao: 'cancelado' };
}

export async function fecharCaptcha(id: string, situacao: 'usado' | 'recusado' | 'expirado' | 'cancelado', mensagem?: string): Promise<void> {
  await supabase().rpc('ludmilla_captcha_fechar', { p_captcha_id: id, p_situacao: situacao, p_mensagem: mensagem ?? null });
  // a foto já cumpriu o papel: some do bucket (melhor esforço)
  const path = fotosPorPedido.get(id);
  if (path) {
    fotosPorPedido.delete(id);
    await supabase().storage.from('ludmilla').remove([path]).then(() => undefined, () => undefined);
  }
}

/** A página mostra "sessão no portal viva desde …" por isto. */
export async function sessaoViva(accountId: string, viva: boolean): Promise<void> {
  await supabase().rpc('ludmilla_sessao_viva', { p_account_id: accountId, p_viva: viva }).then(() => undefined, () => undefined);
}

/** Protocolos dos projetos que a conta acompanha — o robô lê o detalhe deles mesmo sem mexida recente. */
export async function protocolosDeInteresse(accountId: string): Promise<string[]> {
  const { data, error } = await supabase().rpc(nomeRpc('ludmilla_protocolos_de_interesse'), { p_account_id: accountId });
  if (error) return [];
  return ((data ?? []) as { protocolo: string }[]).map(x => x.protocolo);
}

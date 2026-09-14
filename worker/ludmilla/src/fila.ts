import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { SituacaoConta } from './erros.js';

/**
 * A fila da Ludmilla vive no banco (`portal_sync_runs`), e este módulo é a
 * única porta do robô para ela. Tudo passa por RPC de service role: o robô
 * não tem SELECT direto em tabela nenhuma além do que as funções expõem.
 */

export interface Run {
  id: string;
  tenant_id: string;
  account_id: string;
  tipo: 'reconhecimento' | 'teste_login' | 'descoberta' | 'varredura';
  situacao: string;
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
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

/** Próximo run da fila, já marcado como `rodando`; null quando não há. */
export async function pegarRun(): Promise<Run | null> {
  const { data, error } = await supabase().rpc('ludmilla_claim_run');
  if (error) throw new Error(`Não consegui consultar a fila: ${error.message}`);
  const linhas = (data ?? []) as Run[];
  return linhas[0] ?? null;
}

export async function finalizarRun(runId: string, f: Fechamento): Promise<void> {
  const { error } = await supabase().rpc('ludmilla_finalizar_run', {
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
  const { data, error } = await supabase().rpc('ludmilla_portal_credentials', { p_account_id: accountId });
  if (error) throw new Error(`Não consegui ler as credenciais: ${error.message}`);
  const linha = ((data ?? []) as Credenciais[])[0];
  if (!linha) throw new Error('A conta não tem credencial gravada ou está desativada.');
  return linha;
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

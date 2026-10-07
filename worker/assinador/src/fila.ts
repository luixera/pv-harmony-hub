import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { parse } from 'node:path';

/**
 * A fila do assinador vive no banco (`public.assinaturas`), e este módulo é a
 * única porta do robô para ela. Tudo por RPC, com service role — que só existe
 * na VPS, em /etc/gdm-assinador/env.
 *
 * O robô não tem SELECT direto em tabela nenhuma além do que as funções expõem.
 */

export interface Trabalho {
  id: string;
  tenant_id: string;
  project_id: string;
  document_id: string | null;
  assinavel_id: string | null;
  certificado_id: string | null;
  situacao: 'preparando' | 'triagem' | 'pendente';
  titular_nome: string | null;
  titular_cpf: string | null;
  codigo_verificacao: string;
  documento_aprovado_path: string | null;
  hash_aprovado: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  cidade: string;
  tentativas: number;
}

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Falta SUPABASE_URL no ambiente.');
  if (!chave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** `memorial.xlsx` → `memorial_assinado.pdf`; já assinado continua igual. */
export function nomeAssinado(nome: string): string {
  const { name } = parse(nome);
  const base = name.endsWith('_assinado') ? name : `${name}_assinado`;
  return `${base}.pdf`;
}

/** Onde o PDF preparado fica à espera do "está certo". */
export const caminhoAprovado = (t: Trabalho): string =>
  `${t.tenant_id}/${t.project_id}/assinatura/${t.id}_para_assinar.pdf`;

export async function pegarTrabalho(): Promise<Trabalho | null> {
  const { data, error } = await supabase().rpc('assinatura_claim');
  if (error) throw new Error(`Não consegui consultar a fila: ${error.message}`);
  return ((data ?? []) as Trabalho[])[0] ?? null;
}

/**
 * Move a linha para a próxima situação. A RPC devolve BOOLEANO: `false` quando a
 * transição é inválida, repetida ou quando a linha já foi movida por outra
 * pessoa (ex.: o usuário recusou enquanto o robô assinava). Isso LANÇA — quem
 * chama não pode seguir como se tivesse dado certo, sobretudo no `assinado`:
 * um PDF assinado não pode ser entregue por cima de uma recusa.
 */
export async function passo(id: string, situacao: string, campos: Record<string, unknown> = {}): Promise<void> {
  const { data, error } = await supabase().rpc('assinatura_passo', {
    p_id: id, p_situacao: situacao, p_campos: campos,
  });
  if (error) throw new Error(`Não consegui gravar o passo ${situacao}: ${error.message}`);
  if (data !== true) {
    throw new Error(
      `O banco recusou o passo ${situacao}: a assinatura já foi movida por outra pessoa ou a transição não é válida.`,
    );
  }
}

export async function certificadosParaConferir(): Promise<{ id: string }[]> {
  const { data, error } = await supabase()
    .from('certificados_digitais')
    .select('id')
    .eq('situacao', 'conferindo')
    .eq('ativo', true)
    .limit(3);
  if (error) throw new Error(`Não consegui listar certificados: ${error.message}`);
  return (data ?? []) as { id: string }[];
}

export async function dadosDoCertificado(id: string) {
  const { data, error } = await supabase().rpc('certificado_do_robo', { p_id: id });
  if (error) throw new Error(`Não consegui ler o certificado: ${error.message}`);
  const linha = ((data ?? []) as { arquivo_path: string; senha: string; titular_cpf: string; titular_nome: string }[])[0];
  if (!linha) throw new Error('Certificado não encontrado ou desativado.');
  return linha;
}

export async function certificadoConferido(
  id: string, situacao: 'ok' | 'invalido' | 'vencido',
  dados?: { emissor?: string; serial?: string; inicio?: string; fim?: string; erro?: string },
): Promise<void> {
  const { error } = await supabase().rpc('certificado_conferido', {
    p_id: id, p_situacao: situacao,
    p_emissor: dados?.emissor ?? null, p_serial: dados?.serial ?? null,
    p_inicio: dados?.inicio ?? null, p_fim: dados?.fim ?? null, p_erro: dados?.erro ?? null,
  });
  if (error) throw new Error(`Não consegui fechar a conferência: ${error.message}`);
}

export async function baixar(bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Não consegui baixar ${path}: ${error?.message ?? 'sem conteúdo'}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function subir(bucket: string, path: string, bytes: Buffer, mime: string): Promise<string> {
  const { error } = await supabase().storage.from(bucket)
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`Não consegui subir ${path}: ${error.message}`);
  return path;
}

/** Pede ao Claudinho a peneira de conteúdo (edge function). */
export async function triar(pdf: Buffer, tenantId: string): Promise<{ veredito: string; motivo: string }> {
  const { data, error } = await supabase().functions.invoke('assinatura-triagem', {
    body: { tenant_id: tenantId, base64: pdf.toString('base64') },
  });
  if (error) throw new Error(`A triagem não respondeu: ${error.message}`);
  const r = data as { ok?: boolean; veredito?: string; motivo?: string };
  if (!r?.ok || !r.veredito) throw new Error('A triagem respondeu sem veredito.');
  return { veredito: r.veredito, motivo: r.motivo ?? '' };
}

/** Recado do Zé (texto pronto, sem IA). Falha aqui nunca derruba a assinatura. */
export async function recadoDoZe(tenantId: string, texto: string): Promise<void> {
  await supabase().functions
    .invoke('ze-brain', { body: { modo: 'recado', tenant_id: tenantId, texto } })
    .then(() => undefined, () => undefined);
}

/** Abre a pendência no WhatsApp do gestor ("libero?"). */
export async function pedirAoZe(id: string): Promise<void> {
  const { error } = await supabase().rpc('assinatura_pedir_ao_ze', { p_id: id });
  if (error) throw new Error('Não consegui pedir a liberação ao Zé: ' + error.message);
}

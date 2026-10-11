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
  /** Primeiro segmento do caminho no bucket: a policy de leitura casa com companies.id, não com o tenant. */
  company_id: string;
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

/**
 * `file_name` é nome de EXIBIÇÃO (com acento, espaço, `#`...). A chave do objeto
 * no Storage não aceita isso: só `[A-Za-z0-9._-]`. Use só no segmento do path;
 * o nome legível continua indo para o banco.
 */
export function nomeSeguroParaStorage(nome: string): string {
  const seguro = nome.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9._-]/g, '_');
  return seguro || 'documento';
}

/**
 * A RPC recusou a transição (`false`): a linha foi movida por outra pessoa ou a
 * transição é inválida. É DIFERENTE de erro de rede — só com esta classe o
 * commit sabidamente NÃO aconteceu, e só então é seguro apagar o que foi subido.
 */
export class PassoRecusado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'PassoRecusado';
  }
}

/** Onde o PDF preparado fica à espera do "está certo". */
export const caminhoAprovado = (t: Trabalho): string =>
  `${t.company_id}/${t.project_id}/assinatura/${t.id}_para_assinar.pdf`;

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
    throw new PassoRecusado(
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

export async function apagar(bucket: string, path: string): Promise<void> {
  const { error } = await supabase().storage.from(bucket).remove([path]);
  if (error) throw new Error(`Não consegui apagar ${path}: ${error.message}`);
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

/**
 * O recado FOI MESMO entregue? `functions.invoke` não lança em erro HTTP (devolve
 * `error`), e o ze-brain responde 200 `{ ok: true, pulou: ... }` quando o Zé está
 * desligado ou desconectado — nada foi enviado. Só `{ ok: true, recado: true }`
 * conta como entregue.
 */
export function recadoFoiEntregue(resp: { data?: unknown; error?: unknown }): boolean {
  if (resp.error) return false;
  const d = resp.data as { ok?: unknown; recado?: unknown; pulou?: unknown } | null | undefined;
  return d?.ok === true && d?.recado === true && d?.pulou === undefined;
}

/**
 * Recado do Zé (texto pronto, sem IA). Devolve se foi entregue; nunca lança —
 * falha aqui não pode derrubar a assinatura. Quem precisa de garantia usa a
 * outbox (`entregarRecados`), que reenvia.
 */
export async function recadoDoZe(tenantId: string, texto: string): Promise<boolean> {
  try {
    const resp = await supabase().functions
      .invoke('ze-brain', { body: { modo: 'recado', tenant_id: tenantId, texto } });
    return recadoFoiEntregue(resp);
  } catch {
    return false;
  }
}

export interface RecadoPendente { id: string; tenant_id: string; texto: string }

/** Pega até 10 recados da outbox (a RPC já descarta os velhos e marca o claim). */
export async function recadosPendentes(): Promise<RecadoPendente[]> {
  const { data, error } = await supabase().rpc('ze_recados_pendentes');
  if (error) throw new Error(`Não consegui consultar os recados: ${error.message}`);
  return (data ?? []) as RecadoPendente[];
}

/** Fecha o recado: entregue (`ok`) ou não (a RPC anota e conta a tentativa). */
export async function recadoEntregue(id: string, ok: boolean): Promise<void> {
  const { error } = await supabase().rpc('ze_recado_entregue', { _id: id, _ok: ok });
  if (error) throw new Error(`Não consegui fechar o recado: ${error.message}`);
}

export interface PassadaDeRecados { enviados: number; falhas: number }

/**
 * Uma passada de entrega: pega os pendentes, manda cada um e DEPOIS marca.
 * Enviar-e-depois-marcar é entrega "ao menos uma vez": se a marcação falhar, o
 * recado volta (no máximo 3 vezes) — melhor repetir um aviso do que perder o
 * "Libero?" ou o vencimento do certificado. As dependências são injetáveis só
 * para o teste.
 */
export async function entregarRecados(
  enviar: (tenantId: string, texto: string) => Promise<boolean> = recadoDoZe,
  buscar: () => Promise<RecadoPendente[]> = recadosPendentes,
  fechar: (id: string, ok: boolean) => Promise<void> = recadoEntregue,
): Promise<PassadaDeRecados> {
  let enviados = 0;
  let falhas = 0;
  for (const r of await buscar()) {
    const ok = await enviar(r.tenant_id, r.texto);
    if (ok) enviados++; else falhas++;
    try {
      await fechar(r.id, ok);
    } catch {
      // Não marcou: o recado volta depois do prazo da RPC. Um recado com
      // problema não impede os seguintes.
    }
  }
  return { enviados, falhas };
}

/** Abre a pendência no WhatsApp do gestor ("libero?"). */
export async function pedirAoZe(id: string): Promise<void> {
  const { error } = await supabase().rpc('assinatura_pedir_ao_ze', { p_id: id });
  if (error) throw new Error('Não consegui pedir a liberação ao Zé: ' + error.message);
}

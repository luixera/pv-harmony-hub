import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { sanitizeFileName, validateFile } from '@/lib/utils';
import { mesmoTitular, normalizarUc } from '@/lib/beneficiarias';

/**
 * UNIDADES BENEFICIÁRIAS — o dado estruturado do autoconsumo remoto.
 *
 * Spec: docs/superpowers/specs/2026-10-22-beneficiarias-autoconsumo-remoto-design.md.
 * Uma linha por UC com o percentual; a geradora não é linha (fica com o
 * resto). Quem pode escrever é decisão do banco (RLS): a empresa até a
 * análise, a equipe até a criação na CPFL, ninguém depois. A tela só
 * reflete — se o banco recusar, o erro vem no toast.
 *
 * O `as never` nos argumentos de `supabase` é o padrão do repositório (os
 * tipos gerados estão defasados e a tabela é nova).
 */

export type OrigemBeneficiaria = 'digitado' | 'lido_da_conta' | 'confirmado_no_portal';

export interface Beneficiaria {
  id: string;
  project_id: string;
  uc_number: string;
  percent: number;
  holder_name: string | null;
  holder_doc: string | null;
  address: string | null;
  document_id: string | null;
  origin: OrigemBeneficiaria;
  holder_mismatch: boolean;
  position: number;
}

/** O que o Claudinho devolve ao ler a conta de uma beneficiária. */
export interface LeituraDaConta {
  uc: string | null;
  holder_name: string | null;
  holder_doc: string | null;
  address: string | null;
}

const num = (v: unknown) => Number(v ?? 0);

function paraBeneficiaria(r: Record<string, unknown>): Beneficiaria {
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    uc_number: String(r.uc_number ?? ''),
    percent: num(r.percent),
    holder_name: (r.holder_name as string | null) ?? null,
    holder_doc: (r.holder_doc as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    document_id: (r.document_id as string | null) ?? null,
    origin: (r.origin as OrigemBeneficiaria) ?? 'digitado',
    holder_mismatch: Boolean(r.holder_mismatch),
    position: num(r.position),
  };
}

export function useBeneficiarias(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['beneficiarias', projectId],
    queryFn: async (): Promise<Beneficiaria[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_beneficiaries' as never)
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(paraBeneficiaria);
    },
    enabled: !!projectId,
  });
}

/** Invalida o que mostra beneficiária ou o flag derivado dela. */
function invalidar(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  qc.invalidateQueries({ queryKey: ['beneficiarias', projectId] });
  qc.invalidateQueries({ queryKey: ['project', projectId] });
  qc.invalidateQueries({ queryKey: ['projects'] });
  qc.invalidateQueries({ queryKey: ['documents', projectId] });
}

export interface BeneficiariaParaGravar {
  id?: string;
  uc_number: string;
  percent: number;
  holder_name?: string | null;
  holder_doc?: string | null;
  address?: string | null;
  document_id?: string | null;
  origin?: OrigemBeneficiaria;
  holder_mismatch?: boolean;
  position: number;
}

/** Insere ou atualiza uma linha. A UC vai normalizada; o banco confere a soma. */
export function useSalvarBeneficiaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, linha }: { projectId: string; linha: BeneficiariaParaGravar }) => {
      const base = {
        project_id: projectId,
        uc_number: normalizarUc(linha.uc_number),
        percent: linha.percent,
        holder_name: linha.holder_name ?? null,
        holder_doc: linha.holder_doc ? normalizarUc(linha.holder_doc) : null,
        address: linha.address ?? null,
        document_id: linha.document_id ?? null,
        origin: linha.origin ?? 'digitado',
        holder_mismatch: linha.holder_mismatch ?? false,
        position: linha.position,
      };
      const q = linha.id
        ? supabase.from('project_beneficiaries' as never).update(base as never).eq('id', linha.id).select().single()
        : supabase.from('project_beneficiaries' as never).insert(base as never).select().single();
      const { data, error } = await q;
      if (error) throw error;
      return paraBeneficiaria(data as Record<string, unknown>);
    },
    onSuccess: (_, { projectId }) => invalidar(qc, projectId),
    onError: (e: Error) => toast.error(traduzirErro(e)),
  });
}

export function useRemoverBeneficiaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { projectId: string; id: string }) => {
      const { error, count } = await supabase
        .from('project_beneficiaries' as never)
        .delete({ count: 'exact' })
        .eq('id', id);
      if (error) throw error;
      // RLS recusa em silêncio (0 linhas): é a trava da análise/CPFL
      if (!count) throw new Error('Esta beneficiária não pode mais ser removida por você.');
    },
    onSuccess: (_, { projectId }) => invalidar(qc, projectId),
    onError: (e: Error) => toast.error(traduzirErro(e)),
  });
}

/** Mensagens do banco que valem ser mostradas como estão (vêm em português). */
function traduzirErro(e: Error): string {
  const m = e.message || '';
  if (/soma dos percentuais/i.test(m)) return m.replace(/^.*?A soma/, 'A soma');
  if (/duplicate key|project_beneficiaries_project_id_uc_number_key/i.test(m)) return 'Esta UC já está na lista.';
  if (/row-level security|permission denied/i.test(m)) return 'Você não pode mais alterar as beneficiárias deste projeto.';
  return m || 'Não consegui gravar a beneficiária.';
}

// ── A foto da conta ──────────────────────────────────────────────────────────

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });

/**
 * O Claudinho lê a conta de energia da beneficiária — a mesma função que já
 * extrai `uc_number` e titular na entrada do projeto. Devolve o que leu; quem
 * decide o que fazer com a UC lida é a tela (a UC digitada é a chave e não é
 * sobrescrita sozinha).
 */
export async function lerContaBeneficiaria(file: File): Promise<LeituraDaConta> {
  const { data, error } = await supabase.functions.invoke('claudinho-verifica', {
    body: {
      mode: 'analyze',
      documents: [{ base64: await toBase64(file), mimeType: file.type || 'application/octet-stream', hint: 'energy_bill' }],
    },
  });
  if (error || !data?.ok) throw new Error(data?.error || 'O Claudinho não conseguiu ler a conta.');
  const campo = (k: string): string | null => {
    const f = (data as Record<string, { value?: string | null } | undefined>)[k];
    return f?.value ? String(f.value) : null;
  };
  const endereco = [campo('address'), campo('city'), campo('state')].filter(Boolean).join(' · ') || null;
  return {
    uc: campo('uc_number') ? normalizarUc(campo('uc_number')) : null,
    holder_name: campo('holder_name'),
    holder_doc: campo('cpf_cnpj') ? normalizarUc(campo('cpf_cnpj')) : null,
    address: endereco,
  };
}

/**
 * Sobe a foto da conta como documento `energy_bill_beneficiaries` e devolve o
 * id, para ligar à linha. Mesmo caminho e mesma validação dos formulários.
 */
export async function subirContaBeneficiaria(p: {
  file: File; projectId: string; companyId: string; isPublicForm?: boolean; userId?: string;
}): Promise<string> {
  const erro = validateFile(p.file);
  if (erro) throw new Error(erro);
  const nome = sanitizeFileName(p.file.name);
  const base = p.isPublicForm ? `public/${p.companyId}` : p.companyId;
  const caminho = `${base}/${p.projectId}/energy_bill_beneficiaries/${Date.now()}_${nome}`;
  const { error: upErr } = await supabase.storage.from('project-documents').upload(caminho, p.file);
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from('documents')
    .insert({
      project_id: p.projectId,
      file_name: nome,
      file_type: p.file.type,
      file_url: caminho,
      document_type: 'energy_bill_beneficiaries',
      ...(p.userId ? { uploaded_by: p.userId } : {}),
    })
    .select('id')
    .single();
  if (error) throw error;
  return String((data as { id: string }).id);
}

/** Linha como a tela de envio a mantém antes de o projeto existir. */
export interface LinhaDeEnvio {
  chave: string;
  uc: string;
  percentual: string;
  foto: File | null;
  leitura: LeituraDaConta | null;
  lendo: boolean;
}

/**
 * Depois de o projeto nascer: grava as linhas e sobe as fotos. Roda no envio
 * (empresa logada ou formulário público). Erros de foto não derrubam a linha
 * — a beneficiária entra sem `document_id` e a pessoa anexa depois.
 */
export async function gravarBeneficiariasDoEnvio(p: {
  projectId: string; companyId: string; isPublicForm?: boolean; userId?: string;
  docGeradora: string | null | undefined;
  linhas: { uc: string; percent: number; foto: File | null; leitura: LeituraDaConta | null }[];
}): Promise<void> {
  let position = 0;
  for (const l of p.linhas) {
    let document_id: string | null = null;
    if (l.foto) {
      try {
        document_id = await subirContaBeneficiaria({
          file: l.foto, projectId: p.projectId, companyId: p.companyId, isPublicForm: p.isPublicForm, userId: p.userId,
        });
      } catch (e) { console.warn('conta da beneficiária não subiu:', e); }
    }
    const iguais = mesmoTitular(p.docGeradora, l.leitura?.holder_doc);
    const { error } = await supabase.from('project_beneficiaries' as never).insert({
      project_id: p.projectId,
      uc_number: normalizarUc(l.uc),
      percent: l.percent,
      holder_name: l.leitura?.holder_name ?? null,
      holder_doc: l.leitura?.holder_doc ?? null,
      address: l.leitura?.address ?? null,
      document_id,
      origin: l.leitura ? 'lido_da_conta' : 'digitado',
      holder_mismatch: iguais === false,
      position: position++,
    } as never);
    if (error) throw error;
  }
}

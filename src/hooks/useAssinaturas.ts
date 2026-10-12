import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import { toast } from 'sonner';
import { sanitizeFileName, validateFile } from '@/lib/utils';

/**
 * ASSINATURA DIGITAL — o que a tela precisa.
 *
 * A senha do certificado nunca passa por aqui de volta: vai por RPC para o
 * Vault e só o robô, na VPS, consegue lê-la. E `assinavel_id` só é gravado por
 * RPC — a tela não tem privilégio nessa coluna (é a tranca).
 *
 * Restrito ao tenant GD Manager (`is_library`), como o Bidu e a Ludmilla.
 */

export type SituacaoAssinatura =
  | 'preparando' | 'conferir' | 'triagem' | 'aguardando_ze'
  | 'pendente' | 'assinando' | 'assinado' | 'recusado' | 'erro';

export interface TipoAssinavel {
  id: string;
  codigo: string;
  nome: string;
  origem: 'gerado' | 'enviado' | 'ambos';
  exige_triagem: boolean;
  ativo: boolean;
}

export interface Assinatura {
  id: string;
  project_id: string;
  document_id: string | null;
  assinavel_id: string | null;
  situacao: SituacaoAssinatura;
  titular_nome: string | null;
  motivo: string | null;
  recusa: string | null;
  erro: string | null;
  codigo_verificacao: string;
  documento_aprovado_path: string | null;
  documento_assinado_id: string | null;
  pedida_em: string;
  created_at: string;
}

export interface Certificado {
  id: string;
  titular_nome: string;
  titular_cpf: string;
  emissor: string | null;
  serial: string | null;
  validade_inicio: string | null;
  validade_fim: string | null;
  situacao: 'conferindo' | 'ok' | 'invalido' | 'vencido';
  erro: string | null;
  ativo: boolean;
}

export interface LinhaRegistro {
  id: string;
  project_id: string;
  codigo_projeto: string;
  titular_projeto: string;
  tipo: string;
  situacao: SituacaoAssinatura;
  titular_nome: string | null;
  serial: string | null;
  pedida_por_nome: string;
  pedida_em: string;
  liberada_por_nome: string | null;
  codigo_verificacao: string;
  recusa: string | null;
  erro: string | null;
  documento_aprovado_path: string | null;
  assinado_path: string | null;
  assinado_nome: string | null;
}

/** Mesmo recorte do Bidu: admin/staff do tenant biblioteca. */
export function useAssinaturaDisponivel(): boolean {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  if (!user) return false;
  return (user.role === 'admin' || user.role === 'staff') && !!tenant?.is_library;
}

export function useCatalogoAssinavel() {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['catalogo-assinavel'],
    queryFn: async (): Promise<TipoAssinavel[]> => {
      const { data, error } = await supabase
        .from('documentos_assinaveis' as never)
        .select('*')
        .eq('ativo', true)
        .order('nome');
      if (error) throw error;
      return (data ?? []) as TipoAssinavel[];
    },
    enabled: disponivel,
  });
}

export function useCertificadoAtivo() {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['certificado-ativo'],
    queryFn: async (): Promise<Certificado | null> => {
      const { data, error } = await supabase
        .from('certificados_digitais' as never)
        .select('*')
        .eq('ativo', true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Certificado | null;
    },
    enabled: disponivel,
    // enquanto está "conferindo", o worker ainda vai responder
    refetchInterval: q => ((q.state.data as Certificado | null)?.situacao === 'conferindo' ? 4_000 : false),
  });
}

export function useAssinaturasDoProjeto(projectId: string | undefined) {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['assinaturas', projectId],
    queryFn: async (): Promise<Assinatura[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('assinaturas' as never)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Assinatura[];
    },
    enabled: disponivel && !!projectId,
    // o worker trabalha em segundo plano: a tela acompanha
    refetchInterval: q =>
      ((q.state.data as Assinatura[] | undefined) ?? []).some(a =>
        ['preparando', 'triagem', 'aguardando_ze', 'pendente', 'assinando'].includes(a.situacao))
        ? 4_000 : false,
  });
}

export function useRegistroAssinaturas(limite = 100) {
  const disponivel = useAssinaturaDisponivel();
  return useQuery({
    queryKey: ['registro-assinaturas', limite],
    queryFn: async (): Promise<LinhaRegistro[]> => {
      const { data, error } = await supabase.rpc('assinatura_registro' as never, { p_limite: limite } as never);
      if (error) throw error;
      return (data ?? []) as LinhaRegistro[];
    },
    enabled: disponivel,
    refetchInterval: 15_000,
  });
}

/** URL assinada de 5 min para abrir o PDF (preparado ou assinado). */
export async function urlDoArquivo(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(path, 300);
  if (error) return null;
  return data.signedUrl;
}

/** Mesma URL assinada, como hook (cache de 4 min, abaixo dos 5 de validade). */
export function useUrlDoArquivo(path: string | null | undefined) {
  return useQuery({
    queryKey: ['assinatura-url', path],
    queryFn: () => urlDoArquivo(path as string),
    enabled: !!path,
    staleTime: 1000 * 60 * 4,
  });
}

/**
 * Pedir assinatura. Dois caminhos:
 *  - `file`: sobe o arquivo e registra com a marca (RPC documento_para_assinar);
 *  - `documentId`: documento já no projeto (gerado) — marca e pede.
 *
 * `companyId` é obrigatório no caminho `file`: a policy de INSERT do bucket
 * `project-documents` exige que o PRIMEIRO segmento do caminho seja o id da
 * EMPRESA do tenant (convenção `${company_id}/${project_id}/<tipo>/arquivo`,
 * a mesma de useDocuments e da Ludmilla).
 */
export function usePedirAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      projectId: string; companyId: string; assinavelId: string; motivo?: string;
      file?: File; documentId?: string;
    }) => {
      let documentId = p.documentId;

      if (p.file) {
        const erro = validateFile(p.file);
        if (erro) throw new Error(erro);
        if (!p.companyId) throw new Error('Projeto sem empresa — não dá para guardar o arquivo.');
        const nome = sanitizeFileName(p.file.name);
        const path = `${p.companyId}/${p.projectId}/assinatura/${Date.now()}_${nome}`;
        const { error: errUp } = await supabase.storage
          .from('project-documents').upload(path, p.file);
        if (errUp) throw errUp;

        const { data, error } = await supabase.rpc('documento_para_assinar' as never, {
          p_project_id: p.projectId, p_assinavel_id: p.assinavelId,
          p_path: path, p_name: nome, p_type: p.file.type || 'application/octet-stream',
        } as never);
        if (error) {
          // A RPC recusou: tenta não deixar arquivo órfão no bucket. A policy de
          // DELETE do bucket é só do admin, e para quem não é `remove` NÃO dá
          // erro: devolve `data: []` (nada apagado). Por isso o aviso também
          // dispara com a lista vazia — é justamente o caso em que o órfão fica.
          const { data: apagados, error: errRm } = await supabase.storage
            .from('project-documents').remove([path]);
          if (errRm || !apagados || apagados.length === 0) {
            console.warn('[assinatura] arquivo órfão não removido:', path, errRm?.message ?? 'sem permissão para apagar');
          }
          throw error;
        }
        documentId = data as unknown as string;
      } else if (documentId) {
        const { data: marcou, error } = await supabase.rpc('documento_marcar_assinavel' as never, {
          p_document_id: documentId, p_assinavel_id: p.assinavelId,
        } as never);
        if (error) throw error;
        // `false` = a RPC não achou o documento neste projeto/tenant
        if (marcou !== true) throw new Error('Documento não encontrado neste projeto.');
      } else {
        throw new Error('Escolha um arquivo ou um documento do projeto.');
      }

      const { data, error } = await supabase.rpc('assinatura_pedir' as never, {
        p_project_id: p.projectId, p_document_id: documentId,
        p_assinavel_id: p.assinavelId, p_motivo: p.motivo ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (_, p) => {
      qc.invalidateQueries({ queryKey: ['assinaturas', p.projectId] });
      qc.invalidateQueries({ queryKey: ['documents', p.projectId] });
      qc.invalidateQueries({ queryKey: ['registro-assinaturas'] });
      toast.success('Pedido enviado — vou preparar o PDF para você conferir.');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui pedir a assinatura'),
  });
}

export function useAprovarAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; projectId: string }) => {
      const { data, error } = await supabase.rpc('assinatura_aprovar' as never, { p_id: id } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (proxima, p) => {
      qc.invalidateQueries({ queryKey: ['assinaturas', p.projectId] });
      qc.invalidateQueries({ queryKey: ['registro-assinaturas'] });
      toast.success(proxima === 'triagem'
        ? 'Conferido. O Claudinho vai dar uma olhada antes de assinar.'
        : 'Conferido. Assinando…');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui aprovar'),
  });
}

export function useRecusarAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo?: string; projectId: string }) => {
      const { error } = await supabase.rpc('assinatura_recusar' as never, { p_id: id, p_motivo: motivo ?? null } as never);
      if (error) throw error;
    },
    onSuccess: (_, p) => {
      qc.invalidateQueries({ queryKey: ['assinaturas', p.projectId] });
      qc.invalidateQueries({ queryKey: ['registro-assinaturas'] });
      toast.success('Pedido cancelado');
    },
    onError: (e: Error) => toast.error(e.message || 'Não consegui cancelar'),
  });
}

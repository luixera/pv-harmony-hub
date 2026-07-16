import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { validateFile, sanitizeFileName } from '@/lib/utils';
import { toast } from 'sonner';

const BUCKET = 'concessionaire-templates';

export interface ConcessionaireTemplate {
  name: string;
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
  path: string;
}

export function useConcessionaireTemplates(concessionaireId: string | undefined) {
  return useQuery({
    queryKey: ['concessionaire-templates', concessionaireId],
    queryFn: async (): Promise<ConcessionaireTemplate[]> => {
      if (!concessionaireId) return [];

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(concessionaireId, { sortBy: { column: 'created_at', order: 'desc' } });

      if (error) throw error;

      return (data || [])
        // filtra placeholder e "pastas" (ex.: .backups — itens sem id)
        .filter(f => f.name !== '.emptyFolderPlaceholder' && !f.name.startsWith('.') && f.id !== null)
        .map(f => ({ ...f, path: `${concessionaireId}/${f.name}` }));
    },
    enabled: !!concessionaireId,
  });
}

export function useUploadConcessionaireTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      concessionaireId,
      file,
    }: {
      concessionaireId: string;
      file: File;
    }) => {
      // Validate MIME type and size before upload
      const validationError = validateFile(file);
      if (validationError) throw new Error(validationError);

      const safeFileName = sanitizeFileName(file.name);
      const path = `${concessionaireId}/${Date.now()}_${safeFileName}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file);
      if (error) throw error;
      return path;
    },
    onSuccess: (_, { concessionaireId }) => {
      queryClient.invalidateQueries({ queryKey: ['concessionaire-templates', concessionaireId] });
      toast.success('Template enviado com sucesso');
    },
    onError: () => {
      toast.error('Erro ao enviar template');
    },
  });
}

export function useDeleteConcessionaireTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      concessionaireId,
      path,
    }: {
      concessionaireId: string;
      path: string;
    }) => {
      const idx = path.lastIndexOf('/');
      const backupPath = `${path.slice(0, idx)}/.backups/${path.slice(idx + 1)}`;
      // remove o template e o backup pristine (se existir)
      const { error } = await supabase.storage.from(BUCKET).remove([path, backupPath]);
      if (error) throw error;
    },
    onSuccess: (_, { concessionaireId }) => {
      queryClient.invalidateQueries({ queryKey: ['concessionaire-templates', concessionaireId] });
      toast.success('Template excluído com sucesso');
    },
    onError: () => {
      toast.error('Erro ao excluir template');
    },
  });
}

export async function downloadTemplateBuffer(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data.arrayBuffer();
}

// ── Edição de templates: sobrescrever + backup do original ────────────────────

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Caminho do backup pristine de um template: <dir>/.backups/<arquivo>. */
function backupPathFor(path: string): string {
  const idx = path.lastIndexOf('/');
  return `${path.slice(0, idx)}/.backups/${path.slice(idx + 1)}`;
}

/** Sobrescreve o template no storage com o buffer corrigido. */
export async function overwriteTemplate(path: string, buffer: ArrayBuffer): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Blob([buffer], { type: DOCX_MIME }), { upsert: true, contentType: DOCX_MIME });
  if (error) throw error;
}

/** Verifica se existe backup do original. */
export async function hasTemplateBackup(path: string): Promise<boolean> {
  const bp = backupPathFor(path);
  const dir = bp.slice(0, bp.lastIndexOf('/'));
  const name = bp.slice(bp.lastIndexOf('/') + 1);
  const { data } = await supabase.storage.from(BUCKET).list(dir, { search: name });
  return (data ?? []).some(f => f.name === name);
}

/**
 * Garante o backup pristine do template ANTES da primeira edição.
 * Se o backup já existe (edições anteriores), não sobrescreve — assim o
 * "restaurar original" sempre volta ao arquivo originalmente enviado.
 */
export async function backupTemplateOnce(path: string): Promise<void> {
  if (await hasTemplateBackup(path)) return;
  const buffer = await downloadTemplateBuffer(path);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(backupPathFor(path), new Blob([buffer], { type: DOCX_MIME }), { upsert: false, contentType: DOCX_MIME });
  if (error && !`${error.message}`.toLowerCase().includes('exists')) throw error;
}

/** Restaura o template ao original enviado (mantém o backup para o futuro). */
export async function restoreTemplateBackup(path: string): Promise<void> {
  const buffer = await downloadTemplateBuffer(backupPathFor(path));
  await overwriteTemplate(path, buffer);
}

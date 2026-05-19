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
        .filter(f => f.name !== '.emptyFolderPlaceholder')
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
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { toast } from 'sonner';
import { validateFile, sanitizeFileName } from '@/lib/utils';

type Document = Database['public']['Tables']['documents']['Row'];
type DocumentType = Database['public']['Enums']['document_type'];

export function useDocuments(projectId: string | undefined) {
  return useQuery({
    queryKey: ['documents', projectId],
    queryFn: async (): Promise<Document[]> => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });
}

interface UploadDocumentParams {
  projectId: string;
  companyId: string;
  file: File;
  documentType: DocumentType;
  isPublicForm?: boolean;
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      projectId,
      companyId,
      file,
      documentType,
      isPublicForm = false,
    }: UploadDocumentParams) => {
      // Validate file type and size before upload
      const validationError = validateFile(file);
      if (validationError) throw new Error(validationError);

      // Sanitize filename to prevent path traversal
      const safeFileName = sanitizeFileName(file.name);

      // Determine storage path
      const basePath = isPublicForm ? `public/${companyId}` : companyId;
      const filePath = `${basePath}/${projectId}/${documentType}/${Date.now()}_${safeFileName}`;

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('project-documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL (even though bucket is private, we can still get signed URLs later)
      const { data: { publicUrl } } = supabase.storage
        .from('project-documents')
        .getPublicUrl(filePath);

      // Create document record
      const { data, error: dbError } = await supabase
        .from('documents')
        .insert({
          project_id: projectId,
          file_name: safeFileName,
          file_type: file.type,
          file_url: filePath, // Store path, not URL
          document_type: documentType,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      return data;
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['documents', projectId] });
      toast.success('Documento enviado');
    },
    onError: (error) => {
      console.error('Error uploading document:', error);
      toast.error('Erro ao enviar documento');
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (document: Document) => {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('project-documents')
        .remove([document.file_url]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', document.id);

      if (dbError) throw dbError;
    },
    onSuccess: (_, document) => {
      queryClient.invalidateQueries({ queryKey: ['documents', document.project_id] });
      toast.success('Documento removido');
    },
    onError: (error) => {
      console.error('Error deleting document:', error);
      toast.error('Erro ao remover documento');
    },
  });
}

export function useDocumentUrl(filePath: string | undefined) {
  return useQuery({
    queryKey: ['document-url', filePath],
    queryFn: async () => {
      if (!filePath) return null;

      const { data, error } = await supabase.storage
        .from('project-documents')
        .createSignedUrl(filePath, 300); // 5 min expiry — security best practice

      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !!filePath,
    staleTime: 1000 * 60 * 4, // 4 min — refresh before 5 min URL expiry
  });
}

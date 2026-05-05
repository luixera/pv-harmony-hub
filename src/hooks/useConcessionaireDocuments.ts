import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ConcessionaireDocument {
  id: string;
  concessionaire_id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export function useConcessionaireDocuments(concessionaireId: string | undefined) {
  return useQuery({
    queryKey: ['concessionaire-documents', concessionaireId],
    queryFn: async (): Promise<ConcessionaireDocument[]> => {
      if (!concessionaireId) return [];
      
      const { data, error } = await supabase
        .from('concessionaire_documents')
        .select('*')
        .eq('concessionaire_id', concessionaireId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!concessionaireId,
  });
}

export function useUploadConcessionaireDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      concessionaireId, 
      file 
    }: { 
      concessionaireId: string; 
      file: File;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Upload file to storage
      const filePath = `${concessionaireId}/${Date.now()}_${file.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from('concessionaire-documents')
        .upload(filePath, file);
      
      if (uploadError) throw uploadError;
      
      // Create database record
      const { data, error: dbError } = await supabase
        .from('concessionaire_documents')
        .insert({
          concessionaire_id: concessionaireId,
          file_name: file.name,
          file_path: filePath,
          file_type: file.type,
          uploaded_by: user?.id,
        })
        .select()
        .single();
      
      if (dbError) throw dbError;
      
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['concessionaire-documents', variables.concessionaireId] });
      toast.success('Documento enviado com sucesso');
    },
    onError: () => {
      toast.error('Erro ao enviar documento');
    },
  });
}

export function useDeleteConcessionaireDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      id, 
      filePath,
      concessionaireId 
    }: { 
      id: string; 
      filePath: string;
      concessionaireId: string;
    }) => {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('concessionaire-documents')
        .remove([filePath]);
      
      if (storageError) {
        console.warn('Storage deletion failed:', storageError);
      }
      
      // Delete database record
      const { error: dbError } = await supabase
        .from('concessionaire_documents')
        .delete()
        .eq('id', id);
      
      if (dbError) throw dbError;
      
      return { id, concessionaireId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['concessionaire-documents', data.concessionaireId] });
      toast.success('Documento excluído com sucesso');
    },
    onError: () => {
      toast.error('Erro ao excluir documento');
    },
  });
}

export function useConcessionaireDocumentUrl() {
  return async (filePath: string): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from('concessionaire-documents')
      .createSignedUrl(filePath, 60); // 60 seconds
    
    if (error) {
      console.error('Error creating signed URL:', error);
      return null;
    }
    
    return data.signedUrl;
  };
}

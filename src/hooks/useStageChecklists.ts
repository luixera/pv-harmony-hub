import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StageChecklist {
  id: string;
  from_status: string;
  to_status: string;
  required_documents: string[];
  custom_items: string[];
  enabled: boolean;
  created_at: string;
}

export const documentTypeLabels: Record<string, string> = {
  energy_bill_generator: 'Conta de energia - Geradora',
  energy_bill_beneficiaries: 'Contas de energia - Beneficiárias',
  holder_document: 'Documento do titular',
  entrance_standard_photo: 'Foto do padrão de entrada',
  breaker_photo: 'Foto do disjuntor',
  other_photos: 'Outras fotos',
};

export function useStageChecklists() {
  return useQuery({
    queryKey: ['stage-checklists'],
    queryFn: async (): Promise<StageChecklist[]> => {
      const { data, error } = await supabase
        .from('stage_checklists')
        .select('*')
        .order('created_at');
      if (error) throw error;
      return data as StageChecklist[];
    },
  });
}

export function useChecklist(fromStatus: string, toStatus: string) {
  const { data: all = [] } = useStageChecklists();
  return all.find(c => c.from_status === fromStatus && c.to_status === toStatus) ?? null;
}

export function useUpdateChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<StageChecklist> & { id: string }) => {
      const { error } = await supabase
        .from('stage_checklists')
        .update(data)
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stage-checklists'] });
    },
  });
}

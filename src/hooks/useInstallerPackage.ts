import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type PackageSourceType =
  | 'summary'                // cartilha RESUMO gerada
  | 'project_document'       // documento enviado no projeto (ref = document_type)
  | 'concessionaire_template'// template .docx da concessionária (ref = path)
  | 'equipment_inmetro'      // INMETRO do catálogo (ref = 'inverter' | 'module')
  | 'equipment_datasheet'    // datasheet do catálogo (ref = 'inverter' | 'module')
  | 'equipment_afci';        // certificado AFCI do catálogo (ref = 'inverter')

export interface PackageItem {
  id: string;
  label: string;
  source_type: PackageSourceType;
  ref: string | null;
  required: boolean;
}

/** Tipos de documento do projeto disponíveis para linkar. */
export const PROJECT_DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'holder_document', label: 'CNH / Documento de identidade' },
  { value: 'breaker_photo', label: 'Foto do disjuntor' },
  { value: 'entrance_standard_photo', label: 'Foto padrão de entrada' },
  { value: 'energy_bill_generator', label: 'Conta de energia (gerador)' },
  { value: 'energy_bill_beneficiaries', label: 'Conta de energia (beneficiários)' },
  { value: 'other_photos', label: 'Outros anexos' },
  // Titular pessoa jurídica — entram no pacote quando o projeto tiver.
  { value: 'cnpj_card', label: 'Cartão CNPJ' },
  { value: 'social_contract', label: 'Contrato social' },
  { value: 'legal_rep_document', label: 'Documento do responsável legal' },
  { value: 'power_of_attorney', label: 'Procuração' },
  { value: 'extra_attachment', label: 'Arquivos extras' },
];

/** Fotos de instalação que podem ser reaproveitadas de outro projeto (mesmo disjuntor + fase). */
export const REUSABLE_PHOTO_TYPES = ['breaker_photo', 'entrance_standard_photo'];

export function useInstallerPackage(concessionaireId: string | undefined) {
  return useQuery({
    queryKey: ['installer-package', concessionaireId],
    queryFn: async (): Promise<PackageItem[]> => {
      if (!concessionaireId) return [];
      const { data, error } = await supabase
        .from('installer_packages' as never)
        .select('items')
        .eq('concessionaire_id', concessionaireId)
        .maybeSingle();
      if (error) throw error;
      return ((data as { items?: PackageItem[] } | null)?.items ?? []) as PackageItem[];
    },
    enabled: !!concessionaireId,
  });
}

export function useSaveInstallerPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ concessionaireId, items }: { concessionaireId: string; items: PackageItem[] }) => {
      const { error } = await supabase
        .from('installer_packages' as never)
        .upsert({ concessionaire_id: concessionaireId, items } as never, { onConflict: 'concessionaire_id' });
      if (error) throw error;
    },
    onSuccess: (_, { concessionaireId }) => {
      queryClient.invalidateQueries({ queryKey: ['installer-package', concessionaireId] });
      toast.success('Pacote do projetista salvo');
    },
    onError: (e) => { console.error(e); toast.error('Erro ao salvar o pacote'); },
  });
}

/** Preset do master para uma concessionária (por nome). */
export function useInstallerPreset(concessionaireName: string | undefined) {
  return useQuery({
    queryKey: ['installer-preset', concessionaireName],
    queryFn: async (): Promise<PackageItem[] | null> => {
      if (!concessionaireName) return null;
      const { data, error } = await supabase
        .from('installer_package_presets' as never)
        .select('items')
        .eq('concessionaire_name', concessionaireName)
        .maybeSingle();
      if (error) throw error;
      const items = (data as { items?: PackageItem[] } | null)?.items;
      return items ? (items as PackageItem[]) : null;
    },
    enabled: !!concessionaireName,
  });
}

export function useSaveInstallerPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ concessionaireName, items }: { concessionaireName: string; items: PackageItem[] }) => {
      const { error } = await supabase
        .from('installer_package_presets' as never)
        .upsert({ concessionaire_name: concessionaireName, items } as never, { onConflict: 'concessionaire_name' });
      if (error) throw error;
    },
    onSuccess: (_, { concessionaireName }) => {
      queryClient.invalidateQueries({ queryKey: ['installer-preset', concessionaireName] });
      toast.success('Preset do master salvo');
    },
    onError: (e) => { console.error(e); toast.error('Erro ao salvar o preset'); },
  });
}

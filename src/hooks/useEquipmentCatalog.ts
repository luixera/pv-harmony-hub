import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildEquipmentDocName, buildEquipmentDocPath, ensurePdf } from '@/lib/equipmentDocs';

export type EquipmentType = 'inverter' | 'module';

export interface EquipmentCatalogItem {
  id: string;
  type: EquipmentType;
  brand: string;
  model: string;
  power: number | null;
  datasheet_url: string | null;
  inmetro_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const BUCKET = 'equipment-documents';

/** Catálogo compartilhado. type opcional filtra inversor/módulo. */
export function useEquipmentCatalog(type?: EquipmentType) {
  return useQuery({
    queryKey: ['equipment-catalog', type ?? 'all'],
    queryFn: async (): Promise<EquipmentCatalogItem[]> => {
      let q = supabase.from('equipment_catalog' as never).select('*').order('brand').order('model');
      if (type) q = q.eq('type', type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EquipmentCatalogItem[];
    },
  });
}

/** Gera uma URL assinada temporária para visualizar/baixar um documento. */
export async function getEquipmentDocUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) { console.error(error); return null; }
  return data.signedUrl;
}

/** Baixa o arquivo como blob (download direto sem sair da página). */
export async function downloadEquipmentDoc(path: string, fileName: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) { toast.error('Não foi possível baixar o arquivo'); return; }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function uploadDoc(
  equipmentKey: string,
  kind: 'datasheet' | 'inmetro',
  file: File,
  brand: string,
  model: string,
): Promise<string> {
  // Converte imagem (JPG/PNG) em PDF e usa nome padronizado (DATASHEET/INMETRO MARCA MODELO.pdf)
  const pdfBlob = await ensurePdf(file);
  const path = buildEquipmentDocPath(equipmentKey, kind, brand, model);
  const { error } = await supabase.storage.from(BUCKET).upload(path, pdfBlob, {
    upsert: true, contentType: 'application/pdf',
  });
  if (error) throw error;
  return path;
}

/** Renomeia o arquivo existente para o padrão atual (TIPO MARCA MODELO) se marca/modelo mudaram. */
async function renameDocIfNeeded(
  currentPath: string,
  equipmentKey: string,
  kind: 'datasheet' | 'inmetro',
  brand: string,
  model: string,
): Promise<string> {
  const desired = buildEquipmentDocPath(equipmentKey, kind, brand, model);
  if (currentPath === desired) return currentPath;
  const { error } = await supabase.storage.from(BUCKET).move(currentPath, desired);
  if (error) { console.error('Erro ao renomear documento:', error); return currentPath; }
  return desired;
}

interface SaveEquipmentInput {
  id?: string;
  type: EquipmentType;
  brand: string;
  model: string;
  power: number | null;
  datasheetFile?: File | null;
  inmetroFile?: File | null;
  datasheet_url?: string | null;
  inmetro_url?: string | null;
}

export function useSaveEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveEquipmentInput) => {
      const key = input.id ?? crypto.randomUUID();
      let datasheet_url = input.datasheet_url ?? null;
      let inmetro_url = input.inmetro_url ?? null;

      // Arquivo novo → sobe (já com nome padronizado). Sem arquivo novo mas com
      // documento existente → renomeia se marca/modelo mudaram.
      if (input.datasheetFile) {
        datasheet_url = await uploadDoc(key, 'datasheet', input.datasheetFile, input.brand, input.model);
      } else if (datasheet_url) {
        datasheet_url = await renameDocIfNeeded(datasheet_url, key, 'datasheet', input.brand, input.model);
      }
      if (input.inmetroFile) {
        inmetro_url = await uploadDoc(key, 'inmetro', input.inmetroFile, input.brand, input.model);
      } else if (inmetro_url) {
        inmetro_url = await renameDocIfNeeded(inmetro_url, key, 'inmetro', input.brand, input.model);
      }

      const row = {
        type: input.type,
        brand: input.brand.trim(),
        model: input.model.trim(),
        power: input.power,
        datasheet_url,
        inmetro_url,
      };

      if (input.id) {
        const { error } = await supabase.from('equipment_catalog' as never).update(row as never).eq('id', input.id);
        if (error) throw error;
        return input.id;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from('equipment_catalog' as never)
          .insert({ id: key, ...row, created_by: user?.id ?? null } as never)
          .select('id').single();
        if (error) throw error;
        return (data as { id: string }).id;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment-catalog'] });
      toast.success('Equipamento salvo');
    },
    onError: (e: unknown) => {
      console.error(e);
      const msg = e instanceof Error && e.message.includes('duplicate') ? 'Esse modelo já está no catálogo' : 'Erro ao salvar equipamento';
      toast.error(msg);
    },
  });
}

export function useDeleteEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('equipment_catalog' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment-catalog'] });
      toast.success('Equipamento removido');
    },
    onError: (e) => { console.error(e); toast.error('Erro ao remover equipamento'); },
  });
}

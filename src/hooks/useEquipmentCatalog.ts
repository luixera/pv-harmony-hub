import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildEquipmentDocName, buildEquipmentDocPath, ensurePdf, DocKind } from '@/lib/equipmentDocs';

export type EquipmentType = 'inverter' | 'module';

export interface EquipmentCatalogItem {
  id: string;
  type: EquipmentType;
  brand: string;
  model: string;
  power: number | null;
  datasheet_url: string | null;
  inmetro_url: string | null;
  /** Certificado AFCI — somente inversores. */
  afci_url: string | null;
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
  kind: DocKind,
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
  kind: DocKind,
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
  afciFile?: File | null;
  datasheet_url?: string | null;
  inmetro_url?: string | null;
  afci_url?: string | null;
}

/** Busca o certificado AFCI já cadastrado para uma marca de inversor. */
export async function afciDaMarca(brand: string): Promise<string | null> {
  const nome = brand.trim();
  if (!nome) return null;
  const { data } = await supabase
    .from('equipment_catalog' as never)
    .select('afci_url')
    .eq('type', 'inverter')
    .ilike('brand', nome)
    .not('afci_url', 'is', null)
    .limit(1)
    .maybeSingle();
  return (data as { afci_url?: string } | null)?.afci_url ?? null;
}

/** Hook de leitura para a UI avisar que a marca já tem AFCI. */
export function useAfciDaMarca(brand: string) {
  return useQuery({
    queryKey: ['afci-marca', brand.trim().toLowerCase()],
    queryFn: () => afciDaMarca(brand),
    enabled: brand.trim().length > 1,
    staleTime: 60_000,
  });
}

export function useSaveEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveEquipmentInput) => {
      const key = input.id ?? crypto.randomUUID();

      // Arquivo novo → sobe (já com nome padronizado). Sem arquivo novo mas com
      // documento existente → renomeia se marca/modelo mudaram.
      const resolveDoc = async (kind: DocKind, file: File | null | undefined, current: string | null) => {
        if (file) return uploadDoc(key, kind, file, input.brand, input.model);
        if (current) return renameDocIfNeeded(current, key, kind, input.brand, input.model);
        return null;
      };

      const datasheet_url = await resolveDoc('datasheet', input.datasheetFile, input.datasheet_url ?? null);
      const inmetro_url = await resolveDoc('inmetro', input.inmetroFile, input.inmetro_url ?? null);
      // AFCI só existe para inversores e é um documento da MARCA, não do
      // modelo: se a marca já tem certificado, o novo equipamento herda em
      // vez de obrigar a anexar o mesmo arquivo de novo.
      let afci_url: string | null = null;
      if (input.type === 'inverter') {
        afci_url = await resolveDoc('afci', input.afciFile, input.afci_url ?? null);
        if (!afci_url) afci_url = await afciDaMarca(input.brand);
      }

      const row = {
        type: input.type,
        brand: input.brand.trim(),
        model: input.model.trim(),
        power: input.power,
        datasheet_url,
        inmetro_url,
        afci_url,
      };

      // Certificado novo anexado → passa a valer para os outros inversores da
      // mesma marca que ainda não tinham. Não sobrescreve quem já tem, para
      // não apagar um documento anexado de propósito.
      if (input.type === 'inverter' && input.afciFile && afci_url) {
        await supabase.from('equipment_catalog' as never)
          .update({ afci_url } as never)
          .eq('type', 'inverter')
          .ilike('brand', input.brand.trim())
          .is('afci_url', null);
      }

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

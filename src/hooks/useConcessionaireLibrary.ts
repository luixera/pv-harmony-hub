import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/** Item da biblioteca de concessionárias (mantida pela GD Manager). */
export interface LibraryItem {
  source_id: string;
  name: string;
  templates: number;
  entry_rules: number;
  package_items: number;
  /** Já existe uma cópia deste item no tenant? */
  imported: boolean;
  local_id: string | null;
  /** A origem mudou depois da última sincronização? */
  has_update: boolean;
  source_version: string;
  synced_at: string | null;
}

/**
 * Estado da biblioteca para o tenant logado.
 * Retorna vazio para o próprio tenant-biblioteca (ele é a origem).
 */
export function useConcessionaireLibrary() {
  return useQuery({
    queryKey: ['concessionaire-library'],
    queryFn: async (): Promise<LibraryItem[]> => {
      const { data, error } = await supabase.rpc('tenant_library_status' as never);
      if (error) throw error;
      return (data ?? []) as LibraryItem[];
    },
    staleTime: 1000 * 60,
  });
}

/** Importa (ou reimporta) itens da biblioteca para o tenant. */
export function useImportLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceIds?: string[]) => {
      const { data, error } = await supabase.functions.invoke('sync-library', {
        body: sourceIds?.length ? { sourceIds } : {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { imported: number; items: { name: string; status: string; templates: number }[] };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['concessionaire-library'] });
      qc.invalidateQueries({ queryKey: ['energy-concessionaires'] });
      qc.invalidateQueries({ queryKey: ['concessionaire-templates'] });
      qc.invalidateQueries({ queryKey: ['entry-rules'] });
      qc.invalidateQueries({ queryKey: ['installer-package'] });
      const novas = r.items.filter(i => i.status === 'importada').length;
      const atualizadas = r.items.filter(i => i.status === 'atualizada').length;
      const partes = [
        novas > 0 ? `${novas} importada(s)` : '',
        atualizadas > 0 ? `${atualizadas} atualizada(s)` : '',
      ].filter(Boolean).join(' · ');
      toast.success(partes || 'Nada a importar');
    },
    onError: (e: unknown) => {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Erro ao importar da biblioteca');
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Chaves da API de status da Ludmilla (`POST /functions/v1/ludmilla-status`).
 *
 * A chave em claro só existe na resposta de `criar` — o banco guarda o hash.
 * A tela mostra uma vez e pede para copiar; depois disso ninguém a vê mais.
 */
export interface LudmillaApiKey {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: string;
  ultimo_uso_em: string | null;
  revogada_em: string | null;
}

export function useLudmillaApiKeys() {
  return useQuery({
    queryKey: ['ludmilla-api-keys'],
    queryFn: async (): Promise<LudmillaApiKey[]> => {
      const { data, error } = await supabase
        .from('ludmilla_api_keys' as never)
        .select('id, nome, prefixo, criado_em, ultimo_uso_em, revogada_em')
        .order('criado_em', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as LudmillaApiKey[];
    },
  });
}

export function useCriarApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string): Promise<{ id: string; prefixo: string; chave: string }> => {
      const { data, error } = await supabase.rpc('ludmilla_api_key_criar' as never, { p_nome: nome } as never);
      if (error) throw new Error(error.message);
      return data as unknown as { id: string; prefixo: string; chave: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ludmilla-api-keys'] }),
    onError: (e: Error) => toast.error(e.message || 'Não consegui criar a chave'),
  });
}

export function useRevogarApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('ludmilla_api_key_revogar' as never, { p_id: id } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ludmilla-api-keys'] }); toast.success('Chave revogada'); },
    onError: (e: Error) => toast.error(e.message || 'Não consegui revogar a chave'),
  });
}

/** Endereço público da API — o mesmo projeto Supabase do site. */
export function urlDaApiDeStatus(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  return `${base}/functions/v1/ludmilla-status`;
}

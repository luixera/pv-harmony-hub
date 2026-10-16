import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Cadastro, Coleta, Detalhe, Premissas, Resumo } from './tipos';

/**
 * Porta única da tela para as RPCs `eletropostos_*` (só master; o banco recusa
 * o resto). Chave de cache sempre começa com 'eletropostos' — é o que as
 * mutações invalidam.
 */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export function useResumo(de: string, ate: string) {
  return useQuery({
    queryKey: ['eletropostos', 'resumo', de, ate],
    queryFn: () => rpc<Resumo>('eletropostos_resumo', { p_de: de, p_ate: ate }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,          // a coleta é de 5 em 5 min
    refetchIntervalInBackground: false,
    placeholderData: anterior => anterior,
  });
}

export function useDetalhe(id: string | null, de: string, ate: string) {
  return useQuery({
    queryKey: ['eletropostos', 'detalhe', id, de, ate],
    enabled: id !== null,
    queryFn: () => rpc<Detalhe | null>('eletropostos_detalhe', { p_local: id, p_de: de, p_ate: ate }),
    staleTime: 60_000,
  });
}

export function useColeta() {
  return useQuery({
    queryKey: ['eletropostos', 'coleta'],
    queryFn: () => rpc<Coleta>('eletropostos_coleta', {}),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['eletropostos'] });
}

/** Cria (sem `id`) ou atualiza as chaves presentes. Devolve o id. */
export function useSalvarLocal() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (local: Partial<Cadastro>) => rpc<string>('eletropostos_local_salvar', { p_local: local }),
    onSuccess: () => { void invalidar(); },
  });
}

export function useVincular() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (v: { fonte: string; local_fonte: string; local_id: string }) =>
      rpc<null>('eletropostos_vincular', { p_fonte: v.fonte, p_local_fonte: v.local_fonte, p_local: v.local_id }),
    onSuccess: () => { void invalidar(); },
  });
}

export function useSalvarPremissas() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (valores: Partial<Premissas>) => rpc<Premissas>('eletropostos_premissas_salvar', { p_valores: valores }),
    onSuccess: () => { void invalidar(); },
  });
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Camada, DetalheAlimentador, DetalheTrafo, Fontes, RespostaMapa, ResultadoBusca } from './tipos';
import { chaveDaCaixa, type Caixa } from './zoom';

export function useRedeNoMapa(p: { caixa: Caixa | null; zoom: number; soRisco: boolean; camadas: Camada[] }) {
  const camadas = [...p.camadas].sort();
  return useQuery({
    queryKey: ['rede-no-mapa-v3', p.caixa ? chaveDaCaixa(p.caixa) : '-', p.zoom, p.soRisco, camadas.join('+')],
    enabled: p.caixa !== null && camadas.length > 0,
    queryFn: async (): Promise<RespostaMapa> => {
      const c = p.caixa!;
      const { data, error } = await supabase.rpc('rede_no_mapa_v3' as never, {
        p_oeste: c.oeste, p_sul: c.sul, p_leste: c.leste, p_norte: c.norte,
        p_zoom: p.zoom, p_so_risco: p.soRisco, p_camadas: camadas,
      } as never);
      if (error) throw error;
      return data as RespostaMapa;
    },
    staleTime: 60_000,
    placeholderData: anterior => anterior,   // o mapa não pisca: o dado velho fica até o novo chegar
  });
}

export function useBuscaRede(termo: string | null) {
  return useQuery({
    queryKey: ['rede-buscar', termo],
    enabled: termo !== null,
    queryFn: async (): Promise<ResultadoBusca[]> => {
      const { data, error } = await supabase.rpc('rede_buscar' as never, { p_texto: termo, p_limite: 5 } as never);
      if (error) throw error;
      return (data ?? []) as ResultadoBusca[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useDetalheAlimentador(id: number | null) {
  return useQuery({
    queryKey: ['rede-alimentador', id],
    enabled: id !== null,
    queryFn: async (): Promise<DetalheAlimentador | null> => {
      const { data, error } = await supabase.rpc('rede_alimentador_detalhe' as never, { p_id: id } as never);
      if (error) throw error;
      return (data as DetalheAlimentador | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

export function useDetalheTrafo(id: number | null) {
  return useQuery({
    queryKey: ['rede-trafo', id],
    enabled: id !== null,
    queryFn: async (): Promise<DetalheTrafo | null> => {
      const { data, error } = await supabase.rpc('rede_trafo_detalhe' as never, { p_id: id } as never);
      if (error) throw error;
      return (data as DetalheTrafo | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

export function useFontes(ligado: boolean) {
  return useQuery({
    queryKey: ['rede-fontes'],
    enabled: ligado,
    queryFn: async (): Promise<Fontes> => {
      const { data, error } = await supabase.rpc('rede_fontes' as never);
      if (error) throw error;
      return data as Fontes;
    },
    staleTime: 5 * 60_000,
  });
}

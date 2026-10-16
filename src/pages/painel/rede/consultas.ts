import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Camada, DetalheAlimentador, DetalheTrafo, Fontes, NovoParecer, Parecer, RespostaMapa, ResultadoBusca, TrafoProximo } from './tipos';
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

// ── Confronto com a distribuidora (spec §13) ─────────────────────────────────
export async function trafoMaisProximo(lng: number, lat: number, raioM = 300): Promise<TrafoProximo | null> {
  const { data, error } = await supabase.rpc('rede_trafo_mais_proximo' as never, { p_lng: lng, p_lat: lat, p_raio_m: raioM } as never);
  if (error) throw error;
  return (data as TrafoProximo | null) ?? null;
}

const BUCKET = 'rede-pareceres';

/** Sobe o PDF para <trafo>/<sha256>.pdf. O mesmo arquivo duas vezes não vira dois objetos. */
export async function enviarPdfParecer(transformadorId: number, hash: string, arquivo: File): Promise<string> {
  const caminho = `${transformadorId}/${hash}.pdf`;
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: 'application/pdf', upsert: false });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
  return caminho;
}

export async function urlDoParecer(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 120);
  if (error || !data) throw error ?? new Error('sem URL');
  return data.signedUrl;
}

export async function registrarParecer(p: NovoParecer): Promise<Parecer> {
  const { data, error } = await supabase.rpc('rede_parecer_registrar' as never, { p } as never);
  if (error) throw error;
  return data as Parecer;
}

export async function anularParecer(id: number): Promise<void> {
  const { error } = await supabase.rpc('rede_parecer_anular' as never, { p_id: id } as never);
  if (error) throw error;
}

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLudmillaDisponivel, type PortalAccount } from '@/hooks/useLudmilla';
import { linhaDaRpc, normalDaRpc, type LinhaDaCarteira, type NormalDaEtapa } from '@/lib/ludmillaCarteira';
import { somarLeituras, type RunDeLeitura, type SomaDeLeituras } from '@/lib/ludmillaLeituras';
import { desdeDoRecado, gravarVisita, lerVisita } from '@/lib/ludmillaRecado';

/**
 * O QUE A PÁGINA NOVA DA LUDMILLA LÊ ALÉM DO QUE JÁ LIA (spec 2026-11-08, entrega 2).
 * As RPCs da entrega 1 (`ludmilla_carteira`, `ludmilla_normais`) e as contagens do recado. Nada
 * aqui grava no banco; tudo passa pela RLS de quem lê. As RPCs não estão nos tipos gerados:
 * `as never`, como o resto da Ludmilla.
 */

/** Os projetos ativos com tempo na etapa, normal, com quem está, donos e histórico. */
export function useCarteiraDaLudmilla() {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['ludmilla-carteira'],
    queryFn: async (): Promise<LinhaDaCarteira[]> => {
      const { data, error } = await supabase.rpc('ludmilla_carteira' as never, {} as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(linhaDaRpc);
    },
    enabled: disponivel,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** O normal de cada concessionária × etapa (muda devagar: meia hora basta). */
export function useNormaisDaLudmilla() {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['ludmilla-normais'],
    queryFn: async (): Promise<NormalDaEtapa[]> => {
      const { data, error } = await supabase.rpc('ludmilla_normais' as never, {} as never);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(normalDaRpc);
    },
    enabled: disponivel,
    staleTime: 30 * 60_000,
  });
}

/**
 * O que ela leu desde `desde` (decisão 7): as varreduras de portal `ok` (o maior número de protocolos)
 * e quantos e-mails cada conta de e-mail registrou. Uma consulta de contagem por conta de e-mail.
 */
export function useLeiturasDesde(desde: number, contas: PortalAccount[]) {
  const disponivel = useLudmillaDisponivel();
  const comEmail = contas.filter(c => c.acompanhamento === 'email').map(c => c.id).sort();
  const desdeIso = new Date(desde).toISOString();
  return useQuery({
    queryKey: ['ludmilla-leituras-desde', desdeIso, comEmail],
    queryFn: async (): Promise<SomaDeLeituras> => {
      const [runs, ...contagens] = await Promise.all([
        supabase.from('portal_sync_runs' as never).select('account_id, protocolos_lidos')
          .eq('tipo', 'varredura').eq('situacao', 'ok').gte('terminado_em', desdeIso).limit(500),
        ...comEmail.map(id => supabase.from('portal_email_mensagens' as never)
          .select('id', { count: 'exact', head: true }).eq('account_id', id).gte('created_at', desdeIso)),
      ]);
      if (runs.error) throw runs.error;
      const emails: Record<string, number> = {};
      contagens.forEach((r, i) => {
        if (r.error) throw r.error;
        emails[comEmail[i]] = r.count ?? 0;
      });
      return somarLeituras((runs.data ?? []) as unknown as RunDeLeitura[], emails);
    },
    enabled: disponivel && contas.length > 0,
    staleTime: 5 * 60_000,
  });
}

function armazemLocal(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * O "desde" do recado (decisão 6): lido UMA vez ao abrir a página (a última visita guardada) e a
 * visita de agora gravada logo em seguida. Enquanto a página fica aberta, o "desde" não muda.
 */
export function useDesdeDoRecado(userId: string | undefined): number {
  const [desde] = useState(() => desdeDoRecado(userId ? lerVisita(armazemLocal(), userId) : null, Date.now()));
  useEffect(() => {
    if (userId) gravarVisita(armazemLocal(), userId, new Date().toISOString());
  }, [userId]);
  return desde;
}

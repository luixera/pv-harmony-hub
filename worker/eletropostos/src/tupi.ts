import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { linhasDaTupi } from './status.js';

/**
 * Coletor da Tupi — a única fonte do monitor de eletropostos que funciona sem
 * pessoa. Lê o mapa público (`stationsShortVersion`), filtra a região e grava
 * por `eletropostos_gravar` (service role; só esta RPC é chamada). Em erro,
 * grava uma varredura com `ok=false` e o motivo — a aba Coleta mostra.
 *
 * Só leitura do mapa público; nenhum login, nenhum dado de usuário.
 */

export const URL_TUPI =
  'https://api.tupinambaenergia.com.br/stationsShortVersion?plugTypes='
  + '%5B%22Tipo%202%22%2C%22CCS%202%22%2C%22CHAdeMO%22%5D&fast=false&searchText=';

const FONTE = 'tupi';

let cliente: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Falta SUPABASE_URL no ambiente.');
  if (!chave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  return cliente;
}

export async function coletarTupi(): Promise<number> {
  const sb = supabase();
  try {
    const r = await fetch(URL_TUPI, {
      headers: { 'User-Agent': 'monitor-eletropostos (estudo de viabilidade)', Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`Tupi respondeu HTTP ${r.status}`);
    const { linhas } = linhasDaTupi(await r.json());
    const { data, error } = await sb.rpc('eletropostos_gravar', { p_fonte: FONTE, p_linhas: linhas, p_erro: null });
    if (error) throw new Error(error.message);
    return Number(data ?? linhas.length);
  } catch (e) {
    const motivo = ((e as Error).message ?? String(e)).slice(0, 300);
    await sb.rpc('eletropostos_gravar', { p_fonte: FONTE, p_linhas: [], p_erro: motivo }).then(() => undefined, () => undefined);
    throw e;
  }
}

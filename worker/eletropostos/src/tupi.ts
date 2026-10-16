import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { linhasDaTupi } from './status.js';

/**
 * Coletor da Tupi — a única fonte do monitor de eletropostos que funciona sem
 * pessoa. Lê o mapa público (`stationsShortVersion`), filtra a região e grava
 * por `eletropostos_gravar` (service role; só esta RPC é chamada). Em erro,
 * grava uma varredura com `ok=false` e o motivo — a aba Coleta mostra.
 *
 * Só leitura do mapa público; nenhum login, nenhum dado de usuário.
 *
 * Tudo aqui tem TETO de tempo: o mapa (30 s) e cada chamada ao Supabase
 * (20 s). Sem isso, uma conexão pendurada travava o tique sem nenhum log
 * (aconteceu no primeiro deploy, 16/10/2026).
 */

export const URL_TUPI =
  'https://api.tupinambaenergia.com.br/stationsShortVersion?plugTypes='
  + '%5B%22Tipo%202%22%2C%22CCS%202%22%2C%22CHAdeMO%22%5D&fast=false&searchText=';

const FONTE = 'tupi';
const TETO_MAPA_MS = 30_000;
const TETO_RPC_MS = 20_000;

export type Log = (msg: string, extra?: Record<string, unknown>) => void;

let cliente: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Falta SUPABASE_URL no ambiente.');
  if (!chave) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  cliente = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
    // cada requisição ao Supabase com o seu próprio teto
    global: { fetch: (entrada, init) => fetch(entrada, { ...init, signal: AbortSignal.timeout(TETO_RPC_MS) }) },
  });
  return cliente;
}

async function gravar(linhas: unknown[], erro: string | null): Promise<number> {
  const { data, error } = await supabase().rpc('eletropostos_gravar', { p_fonte: FONTE, p_linhas: linhas, p_erro: erro });
  if (error) throw new Error(`eletropostos_gravar: ${error.message}`);
  return Number(data ?? linhas.length);
}

export async function coletarTupi(log: Log = () => undefined): Promise<number> {
  let linhas: unknown[] = [];
  try {
    const t0 = Date.now();
    const r = await fetch(URL_TUPI, {
      headers: { 'User-Agent': 'monitor-eletropostos (estudo de viabilidade)', Accept: 'application/json' },
      signal: AbortSignal.timeout(TETO_MAPA_MS),
    });
    if (!r.ok) throw new Error(`Tupi respondeu HTTP ${r.status}`);
    const lidas = linhasDaTupi(await r.json());
    linhas = lidas.linhas;
    log('mapa lido', { estacoes_na_caixa: lidas.estacoes, conectores: linhas.length, ms: Date.now() - t0 });
    return await gravar(linhas, null);
  } catch (e) {
    const motivo = ((e as Error).message ?? String(e)).slice(0, 300);
    await gravar([], motivo).catch(e2 => log('não consegui nem registrar o erro', { erro: (e2 as Error).message }));
    throw e;
  }
}

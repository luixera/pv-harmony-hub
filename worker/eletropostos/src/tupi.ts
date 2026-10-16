import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { linhasDaTupi } from './status.js';
import { lerMapaPeloNavegador } from './navegador.js';

/**
 * Coletor da Tupi — a única fonte do monitor de eletropostos que funciona sem
 * pessoa. Grava por `eletropostos_gravar` (service role; só esta RPC é
 * chamada). Em erro, grava uma varredura com `ok=false` e o motivo — a aba
 * Coleta mostra.
 *
 * De onde vem o dado (ordem):
 *  1. o mapa público aberto num NAVEGADOR (navegador.ts) — o caminho normal
 *     desde 16/10/2026, quando a API fechou para scripts; autorizado pelo
 *     usuário;
 *  2. a API direta (`stationsShortVersion`), só se o navegador falhar — é o
 *     caminho antigo e volta a servir se a Tupi reabrir a API.
 *
 * Só leitura; nenhum login, nenhum dado de usuário. Tudo tem TETO de tempo:
 * navegador 60 s, API 30 s, cada chamada ao Supabase 20 s.
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
    global: { fetch: (entrada, init) => fetch(entrada, { ...init, signal: AbortSignal.timeout(TETO_RPC_MS) }) },
  });
  return cliente;
}

async function gravar(linhas: unknown[], erro: string | null): Promise<number> {
  const { data, error } = await supabase().rpc('eletropostos_gravar', { p_fonte: FONTE, p_linhas: linhas, p_erro: erro });
  if (error) throw new Error(`eletropostos_gravar: ${error.message}`);
  return Number(data ?? linhas.length);
}

async function lerPelaApi(): Promise<unknown> {
  const r = await fetch(URL_TUPI, {
    headers: { 'User-Agent': 'monitor-eletropostos (estudo de viabilidade)', Accept: 'application/json' },
    signal: AbortSignal.timeout(TETO_MAPA_MS),
  });
  if (!r.ok) throw new Error(`Tupi respondeu HTTP ${r.status}`);
  return r.json();
}

/** Navegador primeiro; API só como reserva. Devolve o JSON e por onde veio. */
export async function lerMapa(log: Log): Promise<{ dados: unknown; origem: 'navegador' | 'api' }> {
  try {
    return { dados: await lerMapaPeloNavegador(log), origem: 'navegador' };
  } catch (e) {
    log('navegador falhou, tentando a API', { erro: (e as Error).message });
    return { dados: await lerPelaApi(), origem: 'api' };
  }
}

export async function coletarTupi(log: Log = () => undefined): Promise<number> {
  let linhas: unknown[] = [];
  try {
    const t0 = Date.now();
    const { dados, origem } = await lerMapa(log);
    const lidas = linhasDaTupi(dados);
    linhas = lidas.linhas;
    log('mapa lido', { origem, estacoes_na_caixa: lidas.estacoes, conectores: linhas.length, ms: Date.now() - t0 });
    return await gravar(linhas, null);
  } catch (e) {
    const motivo = ((e as Error).message ?? String(e)).slice(0, 300);
    await gravar([], motivo).catch(e2 => log('não consegui nem registrar o erro', { erro: (e2 as Error).message }));
    throw e;
  }
}

import { supabase } from '../fila.js';
import { linhasDaTupi } from './status.js';

/**
 * Coletor da Tupi — a única fonte do monitor de eletropostos que funciona sem
 * pessoa, por isso roda na VPS, como tique de 5 min do laço da Ludmilla
 * (ver index.ts). Lê o mapa público (`stationsShortVersion`), filtra a região
 * e grava por `eletropostos_gravar` (service role). Em erro, grava uma
 * varredura com `ok=false` e o motivo — a aba Coleta mostra; o laço segue.
 *
 * Só leitura do mapa público; nenhum login, nenhum dado de usuário.
 */

export const URL_TUPI =
  'https://api.tupinambaenergia.com.br/stationsShortVersion?plugTypes='
  + '%5B%22Tipo%202%22%2C%22CCS%202%22%2C%22CHAdeMO%22%5D&fast=false&searchText=';

const FONTE = 'tupi';

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

/**
 * Agenda o tique alinhado às janelas de 5 min (um pouco depois da virada, para
 * a leitura cair na janela nova). Devolve a função que desarma.
 */
export function agendarTupi(executar: () => Promise<void>): () => void {
  const PASSO = 5 * 60_000;
  let intervalo: NodeJS.Timeout | null = null;
  const atraso = PASSO - (Date.now() % PASSO) + 5_000;
  const inicio = setTimeout(() => {
    void executar();
    intervalo = setInterval(() => { void executar(); }, PASSO);
  }, atraso);
  return () => { clearTimeout(inicio); if (intervalo) clearInterval(intervalo); };
}

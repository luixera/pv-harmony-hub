import { coletarTupi } from './tupi.js';
import { atrasoAteProximaJanela } from './status.js';

/**
 * ELETROPOSTOS — o laço do coletor (agente próprio, separado da Ludmilla por
 * decisão do usuário em 16/10/2026).
 *
 * A cada janela de 5 minutos (alinhada ao relógio, uns segundos depois da
 * virada) lê o mapa público da Tupi e grava no Supabase. Só isso. Erro numa
 * coleta vira varredura com ok=false e um log; o laço segue para a próxima.
 *
 * Ambiente (de /etc/gdm-eletropostos/env na VPS): SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, ELETROPOSTOS_PASSO_MIN (padrão 5).
 */

const PASSO_MS = Number(process.env.ELETROPOSTOS_PASSO_MIN ?? 5) * 60_000;
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

async function tique(): Promise<void> {
  try {
    const n = await coletarTupi();
    log('tupi ok', { conectores: n });
  } catch (e) {
    log('tupi falhou', { erro: (e as Error).message });
  }
}

function principal(): void {
  log('eletropostos no ar', { passo_min: PASSO_MS / 60_000 });
  let intervalo: NodeJS.Timeout | null = null;
  const atraso = atrasoAteProximaJanela(Date.now(), PASSO_MS);
  log('primeira coleta agendada', { em_segundos: Math.round(atraso / 1000) });
  const inicio = setTimeout(() => {
    void tique();
    intervalo = setInterval(() => { void tique(); }, PASSO_MS);
  }, atraso);
  const encerrar = () => {
    log('encerrando');
    clearTimeout(inicio);
    if (intervalo) clearInterval(intervalo);
    process.exit(0);
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
}

principal();

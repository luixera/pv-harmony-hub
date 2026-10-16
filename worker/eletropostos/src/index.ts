import { coletarTupi } from './tupi.js';
import { atrasoAteProximaJanela, deveTentar, registrarResultado, type Recuo } from './status.js';

/**
 * ELETROPOSTOS — o laço do coletor (agente próprio, separado da Ludmilla por
 * decisão do usuário em 16/10/2026).
 *
 * A cada janela de 5 minutos (alinhada ao relógio, uns segundos depois da
 * virada) lê o mapa público da Tupi e grava no Supabase. Só isso. Erro numa
 * coleta vira varredura com ok=false e um log; o laço segue para a próxima.
 * Um tique nunca espera o anterior: se o anterior ainda está rodando (todas
 * as chamadas têm teto, então é raro), o novo é pulado e isso vai para o log.
 *
 * Recuo: quando a Tupi passa a recusar (HTTP 403 — aconteceu em 16/10/2026,
 * bloqueio do Cloudflare na API), o coletor NÃO insiste a cada 5 min: depois
 * de 3 recusas seguidas tenta só uma vez por hora, e volta ao normal na
 * primeira leitura boa. A casa não disfarça automação nem contorna bloqueio.
 *
 * Ambiente (de /etc/gdm-eletropostos/env na VPS): SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, ELETROPOSTOS_PASSO_MIN (padrão 5).
 */

const PASSO_MS = Number(process.env.ELETROPOSTOS_PASSO_MIN ?? 5) * 60_000;
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

let rodando = false;
let recuo: Recuo = { recusasSeguidas: 0, ultimaTentativa: 0 };

async function tique(): Promise<void> {
  if (rodando) { log('tique pulado: o anterior ainda roda'); return; }
  const agora = Date.now();
  if (!deveTentar(recuo, agora)) {
    log('tique pulado: em recuo após recusas da Tupi', { recusas_seguidas: recuo.recusasSeguidas });
    return;
  }
  rodando = true;
  const t0 = agora;
  log('coleta iniciada');
  try {
    const n = await coletarTupi(log);
    recuo = registrarResultado(recuo, true, t0);
    log('tupi ok', { conectores: n, ms: Date.now() - t0 });
  } catch (e) {
    const msg = (e as Error).message;
    recuo = registrarResultado(recuo, false, t0, msg);
    log('tupi falhou', { erro: msg, ms: Date.now() - t0, recusas_seguidas: recuo.recusasSeguidas });
  } finally {
    rodando = false;
  }
}

function principal(): void {
  log('eletropostos no ar', { passo_min: PASSO_MS / 60_000, node: process.version });
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
  process.on('unhandledRejection', e => log('rejeição sem tratamento', { erro: (e as Error)?.message ?? String(e) }));
  process.on('uncaughtException', e => { log('exceção sem tratamento', { erro: e.message }); process.exit(1); });
}

principal();

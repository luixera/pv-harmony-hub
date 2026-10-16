/**
 * Monitor de eletropostos — a parte PURA do coletor da Tupi.
 *
 * Porta de `comum.py` (MAPA_STATUS, normalizar) e de `coletor_tupi.py` (caixa
 * geográfica e montagem das linhas). Sem rede e sem banco: é o que
 * `test/status.test.ts` exercita.
 *
 * Regra do usuário: NENHUM dado de motorista. O JSON da Tupi traz
 * `startedUserID`/`reservedUserID` por conector — aqui só saem os campos
 * nomeados em `Linha`, nada mais.
 */

export type Status = 'livre' | 'ocupado' | 'fora' | 'desconhecido';

export const MAPA_STATUS: Record<string, Status> = {
  available: 'livre',
  charging: 'ocupado', preparing: 'ocupado', finishing: 'ocupado',
  suspendedev: 'ocupado', suspendedevse: 'ocupado', occupied: 'ocupado',
  faulted: 'fora', unavailable: 'fora',
  'disponível': 'livre', disponivel: 'livre', livre: 'livre',
  carregando: 'ocupado', ocupado: 'ocupado', 'em uso': 'ocupado', 'em carregamento': 'ocupado',
  'indisponível': 'fora', indisponivel: 'fora', 'manutenção': 'fora', manutencao: 'fora',
  offline: 'fora', falha: 'fora',
};

export function normalizar(s: unknown): Status {
  const chave = String(s ?? '').trim().toLowerCase();
  return MAPA_STATUS[chave] ?? 'desconhecido';
}

/** Região de S. J. do Rio Preto + Mirassol + Bady Bassitt (a mesma do Python). */
export const CAIXA = { latMin: -20.95, latMax: -20.70, lngMin: -49.55, lngMax: -49.28 };

export function dentroDaCaixa(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  return CAIXA.latMin < lat && lat < CAIXA.latMax && CAIXA.lngMin < lng && lng < CAIXA.lngMax;
}

/** Uma leitura de conector, no formato que `eletropostos_gravar(p_linhas)` espera. */
export interface Linha {
  local_fonte: string;
  local_nome: string | null;
  lat: number | null;
  lng: number | null;
  conector: string;
  potencia_kw: number | null;
  status_bruto: string | null;
  status: Status;
  upstream_ts: string | null;
}

interface EstacaoTupi {
  stationID?: unknown; name?: unknown; lat?: unknown; lng?: unknown;
  connectedPlugs?: unknown;
}
interface PlugTupi { connectorID?: unknown; power?: unknown; stateName?: unknown; updatedAt?: unknown }

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texto = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * Do JSON de `stationsShortVersion` para as linhas do banco: só estações na
 * caixa, uma linha por conector. `estacoes` conta as estações vistas na caixa
 * (mesmo sem conector), porque `registrar_local_fonte` acontecia por estação.
 */
export function linhasDaTupi(dados: unknown): { linhas: Linha[]; estacoes: number } {
  if (!Array.isArray(dados)) return { linhas: [], estacoes: 0 };
  const linhas: Linha[] = [];
  let estacoes = 0;
  for (const e of dados as EstacaoTupi[]) {
    if (!e || !dentroDaCaixa(e.lat, e.lng)) continue;
    const id = texto(e.stationID);
    if (!id) continue;
    estacoes++;
    const plugs = Array.isArray(e.connectedPlugs) ? (e.connectedPlugs as PlugTupi[]) : [];
    for (const p of plugs) {
      const bruto = texto(p?.stateName);
      linhas.push({
        local_fonte: id,
        local_nome: texto(e.name),
        lat: numero(e.lat),
        lng: numero(e.lng),
        conector: texto(p?.connectorID) ?? '*',
        potencia_kw: numero(p?.power),
        status_bruto: bruto,
        status: normalizar(bruto),
        upstream_ts: texto(p?.updatedAt),
      });
    }
  }
  return { linhas, estacoes };
}

/** Milissegundos até a próxima virada de 5 min, mais uma folga para a leitura cair na janela nova. */
export function atrasoAteProximaJanela(agora = Date.now(), passoMs = 5 * 60_000, folgaMs = 5_000): number {
  return passoMs - (agora % passoMs) + folgaMs;
}

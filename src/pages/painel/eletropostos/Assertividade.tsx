import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { card, GOLD, Loading } from '../ConsoleSections';
import { fmt, pct, relativo } from './calculo';
import { h3, mudo, sub, td, th, vazio } from './estilo';
import { COR_STATUS } from './tipos';

/**
 * Assertividade da leitura — pedido do usuário em 16/10/2026: "marca as falhas
 * de leitura, assim conseguimos mensurar qual a assertividade".
 *
 * Um ciclo é uma varredura de uma fonte: ok · parcial (gravou algo, mas algum
 * local falhou) · falha (nada gravado). Por fonte: ciclos por situação e
 * leituras lidas × esperadas (a mediana dos ciclos com leitura). Por local: leituras
 * obtidas ÷ (tentativas × conectores) e as falhas atribuídas a ele, com o
 * último erro. Dado da RPC `eletropostos_assertividade`.
 */
interface PorFonte {
  fonte: string; ciclos: number; ok: number; parciais: number; falhas: number; leituras: number;
  esperado_por_ciclo: number; taxa_ciclos_ok: number | null; taxa_leitura: number | null; ultimo_ok: string | null;
}
interface PorLocal {
  fonte: string; local_fonte: string; nome: string; local_id: string | null; cadastro: string | null;
  leituras: number; conectores: number; ilegiveis: number; tentativas: number; taxa: number | null;
  falhas: number; ultimo_erro: string | null; ultima_falha: string | null;
}
interface Ciclo { ts: string; fonte: string; n: number; situacao: 'ok' | 'parcial' | 'falha'; erro: string | null }
interface Dados { por_fonte: PorFonte[]; por_local: PorLocal[]; ciclos_24h: Ciclo[] }

const COR_SITUACAO = { ok: COR_STATUS.livre, parcial: GOLD, falha: COR_STATUS.fora } as const;
const ROTULO_SITUACAO = { ok: 'ok', parcial: 'parcial', falha: 'falha' } as const;

function useAssertividade(de: string, ate: string) {
  return useQuery({
    queryKey: ['eletropostos', 'assertividade', de, ate],
    queryFn: async (): Promise<Dados> => {
      const { data, error } = await supabase.rpc('eletropostos_assertividade' as never, { p_de: de, p_ate: ate } as never);
      if (error) throw error;
      return data as Dados;
    },
    staleTime: 60_000, refetchInterval: 5 * 60_000, refetchIntervalInBackground: false,
  });
}

function Barra({ v }: { v: number | null }) {
  if (v == null) return <span style={mudo}>—</span>;
  const cor = v >= 0.9 ? COR_STATUS.livre : v >= 0.6 ? GOLD : COR_STATUS.fora;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'inline-block', width: 70, height: 6, background: '#1e1e28', borderRadius: 3, overflow: 'hidden' }}>
        <b style={{ display: 'block', height: '100%', width: `${Math.round(v * 100)}%`, background: cor }} />
      </span>{pct(v)}
    </span>
  );
}

/** Últimas 24 h de ciclos de uma fonte: um ponto por ciclo, na posição do horário. */
function Faixa24h({ ciclos }: { ciclos: Ciclo[] }) {
  const w = 480, h = 14, fim = Date.now(), ini = fim - 24 * 3600e3;
  return (
    <svg viewBox={`0 0 ${w} ${h + 12}`} style={{ width: '100%', maxWidth: 480, height: 'auto', display: 'block' }} role="img" aria-label="Ciclos das últimas 24 horas">
      <rect x={0} y={0} width={w} height={h} fill="#1e1e28" rx={3} />
      {ciclos.map((c, i) => {
        const x = (new Date(c.ts).getTime() - ini) / (fim - ini) * w;
        return <rect key={i} x={Math.max(0, x - 1.5)} y={2} width={3} height={h - 4} rx={1} fill={COR_SITUACAO[c.situacao]}>
          <title>{new Date(c.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {ROTULO_SITUACAO[c.situacao]} · {c.n} leituras{c.erro ? ` · ${c.erro}` : ''}</title>
        </rect>;
      })}
      <text x={0} y={h + 10} fill="#777" fontSize={10}>há 24 h</text>
      <text x={w} y={h + 10} textAnchor="end" fill="#777" fontSize={10}>agora</text>
    </svg>
  );
}

export function Assertividade({ de, ate }: { de: string; ate: string }) {
  const { data, isLoading } = useAssertividade(de, ate);
  if (isLoading || !data) return <Loading />;
  const agora = Date.now();
  const legenda = (
    <span style={{ display: 'inline-flex', gap: 12, fontSize: 11, color: '#999' }}>
      {(['ok', 'parcial', 'falha'] as const).map(s => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: COR_SITUACAO[s], display: 'inline-block' }} />{ROTULO_SITUACAO[s]}
        </span>))}
    </span>
  );
  return (
    <div>
      <h3 style={{ ...h3, marginTop: 24 }}>Assertividade da leitura</h3>
      <p style={sub}>
        Um ciclo é uma varredura da fonte: <b>ok</b> gravou tudo; <b>parcial</b> gravou, mas algum local falhou; <b>falha</b> não gravou nada.
        A taxa de leitura compara o que foi lido com o esperado por ciclo (a mediana dos ciclos que leram algo). No período de {de.slice(8)}/{de.slice(5, 7)} a {ate.slice(8)}/{ate.slice(5, 7)}.
      </p>

      <div style={{ ...card, padding: 0, overflow: 'auto', marginBottom: 14 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead><tr>{['Fonte', 'Ciclos', 'OK', 'Parciais', 'Falhas', 'Ciclos ok', 'Leituras', 'Esperado/ciclo', 'Taxa de leitura', 'Últimas 24 h'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
          <tbody>
            {data.por_fonte.length === 0 && <tr><td colSpan={10} style={{ ...td, color: '#777', padding: 18 }}>Nenhum ciclo no período.</td></tr>}
            {data.por_fonte.map(f => (
              <tr key={f.fonte}>
                <td style={{ ...td, fontWeight: 600, color: '#fff' }}>{f.fonte}</td>
                <td style={td}>{f.ciclos}</td>
                <td style={{ ...td, color: COR_SITUACAO.ok }}>{f.ok}</td>
                <td style={{ ...td, color: GOLD }}>{f.parciais}</td>
                <td style={{ ...td, color: COR_SITUACAO.falha }}>{f.falhas}</td>
                <td style={td}><Barra v={f.taxa_ciclos_ok} /></td>
                <td style={td}>{f.leituras}</td>
                <td style={td}>{f.esperado_por_ciclo}</td>
                <td style={td}><Barra v={f.taxa_leitura} /></td>
                <td style={{ ...td, minWidth: 220 }}><Faixa24h ciclos={data.ciclos_24h.filter(c => c.fonte === f.fonte)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '8px 10px', borderTop: '1px solid #1a1a22' }}>{legenda}</div>
      </div>

      <h3 style={h3}>Por local</h3>
      <p style={sub}>Leituras obtidas ÷ (ciclos com leitura da fonte × conectores lidos). Locais em rodízio (lidos só em alguns ciclos, caso do ATM EVs fora do inventário) ficam com taxa baixa por desenho. "Ilegíveis" são leituras gravadas com status desconhecido.</p>
      {data.por_local.length === 0 ? <div style={vazio}>Nenhuma leitura no período.</div> : (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead><tr>{['Local (como a fonte chama)', 'Fonte', 'Cadastro', 'Conectores', 'Leituras', 'Tentativas', 'Taxa', 'Ilegíveis', 'Falhas', 'Último erro'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>
              {data.por_local.map(l => (
                <tr key={`${l.fonte}:${l.local_fonte}`}>
                  <td style={{ ...td, fontWeight: 600, color: '#fff' }}>{l.nome}</td>
                  <td style={td}>{l.fonte}</td>
                  <td style={{ ...td, color: l.cadastro ? '#ddd' : '#777' }}>{l.cadastro ?? 'sem vínculo'}</td>
                  <td style={td}>{l.conectores}</td>
                  <td style={td}>{l.leituras}</td>
                  <td style={td}>{l.tentativas}</td>
                  <td style={td}><Barra v={l.taxa} /></td>
                  <td style={{ ...td, color: l.ilegiveis ? GOLD : '#777' }}>{l.ilegiveis}</td>
                  <td style={{ ...td, color: l.falhas ? COR_STATUS.fora : '#777' }}>{l.falhas}</td>
                  <td style={{ ...td, whiteSpace: 'normal', color: '#999', maxWidth: 360, fontSize: 11.5 }}>
                    {l.ultimo_erro ? <>{l.ultimo_erro} <span style={mudo}>({relativo(l.ultima_falha, agora)})</span></> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ ...mudo, fontSize: 11, marginTop: 8 }}>Esperado por ciclo: {data.por_fonte.map(f => `${f.fonte} ${fmt(f.esperado_por_ciclo, 0)}`).join(' · ')}.</p>
    </div>
  );
}

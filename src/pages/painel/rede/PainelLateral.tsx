import { AlertTriangle, ArrowLeft, Crosshair, GitBranch } from 'lucide-react';
import { GOLD } from '../ConsoleSections';
import { useDetalheAlimentador } from './consultas';
import { CORES, ORDEM, ROTULOS } from './estilos';
import { inteiro, kva, kw, mesesDesde, pct, percentualDe, rotuloIdade } from './formato';
import type { PropsAlimentador, PropsPonto, RespostaMapa, Risco, Selecao } from './tipos';
import type { Caixa } from './zoom';

/**
 * O equivalente acessível do mapa — não enfeite. Mil marcadores não se
 * navegam por teclado; esta coluna sim. Tem os mesmos dados do mapa, na
 * mesma ordem de importância: resumo da área, lista contextual, detalhe.
 */
interface Props {
  resposta: RespostaMapa | undefined; carregando: boolean; selecao: Selecao;
  aoSelecionar: (s: Selecao) => void; aoEnquadrar: (c: Caixa) => void; aoCentrar: (lng: number, lat: number) => void;
}

const rotuloSecao: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 };
const linha: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '9px 12px', background: '#16161F' };
const bloco: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 10, overflow: 'hidden' };
const botaoLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' };

const Ponto = ({ risco }: { risco: Risco }) =>
  <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0, background: CORES[risco] }} />;

function Resumo({ r }: { r: RespostaMapa['resumo'] }) {
  const tile = (risco: Risco, rotulo: string) => (
    <div key={risco} style={{ background: `${CORES[risco]}1A`, border: `1px solid ${CORES[risco]}47`, borderRadius: 10, padding: '10px 12px' }}>
      <p style={{ fontSize: 19, fontWeight: 800, color: risco === 'folga' ? '#5DD372' : risco === 'risco' ? '#FF7A6B' : CORES[risco], margin: 0 }}>
        {percentualDe(r[risco], r.total)}%
      </p>
      <p style={{ fontSize: 11, color: '#9A9AA8', margin: '2px 0 0' }}>{rotulo} · {inteiro(r[risco])}</p>
    </div>
  );
  return (
    <div>
      <p style={{ ...rotuloSecao, marginBottom: 9 }}>Área visível · {inteiro(r.total)} trafos</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {tile('folga', 'com folga')}{tile('atencao', 'em atenção')}{tile('risco', 'em risco')}{tile('sem_dado', 'sem dado')}
      </div>
    </div>
  );
}

function BarraOcupacao({ ocupacao, risco, limiarRisco }: { ocupacao: number | null; risco: Risco; limiarRisco: number }) {
  if (ocupacao === null) return null;
  const escala = Math.max(limiarRisco * 1.5, ocupacao);   // a marca dos 100% nunca cola na borda
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Ocupação da margem</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: CORES[risco] }}>{pct(ocupacao)}</span>
      </div>
      <div style={{ height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (ocupacao / escala) * 100)}%`, height: '100%', background: CORES[risco], borderRadius: 5 }} />
        <div aria-hidden style={{ position: 'absolute', left: `${(limiarRisco / escala) * 100}%`, top: -2, bottom: -2, width: 2, background: '#E8E8EE' }} />
      </div>
      <p style={{ fontSize: 10.5, color: '#6B6B78', margin: '5px 0 0' }}>
        A marca clara é o limite de {limiarRisco}%{ocupacao >= limiarRisco ? ' — a barra passou dele.' : '.'}
      </p>
    </div>
  );
}

function Procedencia({ base }: { base: RespostaMapa['base'] }) {
  const idade = base.data_base ? mesesDesde(base.data_base) : null;
  const d = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <p style={rotuloSecao}>Procedência do dado</p>
      {[['Fonte', 'BDGD · ANEEL'], ['Distribuidora', base.distribuidora ?? '—'], ['Data-base', d(base.data_base)],
        ['Importada em', d(base.importado_em)]].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#9A9AA8' }}>{k}</span><span style={{ color: '#D5D5DD', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
      {idade !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#9A9AA8' }}>Idade do dado</span><span style={{ color: '#E3B341', fontWeight: 700 }}>{rotuloIdade(idade)}</span>
        </div>
      )}
    </div>
  );
}

function ContextoAlimentador({ id, aoAbrir }: { id: number | null; aoAbrir: (id: number) => void }) {
  const q = useDetalheAlimentador(id);
  if (id === null) return <span style={{ fontSize: 12, color: '#8A8A96' }}>alimentador não informado</span>;
  if (!q.data) return <span style={{ fontSize: 12, color: '#8A8A96' }}>{q.isLoading ? 'lendo o alimentador…' : '—'}</span>;
  const a = q.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[['Alimentador', a.codigo], ['Subestação', a.subestacao ?? '—'],
        ['Trafos no alimentador', `${inteiro(a.trafos)} · ${inteiro(a.trafos_risco)} em risco`],
        ['Ocupação do alimentador', pct(a.ocupacao_pct)]].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#9A9AA8' }}>{k}</span><span style={{ color: '#D5D5DD', fontWeight: 600, textAlign: 'right' }}>{v}</span>
        </div>
      ))}
      <button type="button" onClick={() => aoAbrir(a.id)} style={botaoLink}><GitBranch size={12} /> Ver o alimentador</button>
    </div>
  );
}

function DetalheTrafo({ p, regras, base, aoVoltar, aoAbrirAlimentador }:
  { p: PropsPonto; regras: RespostaMapa['regras']; base: RespostaMapa['base']; aoVoltar: () => void; aoAbrirAlimentador: (id: number) => void }) {
  const veredito: Record<Risco, [string, string]> = {
    risco: ['Margem esgotada', 'A geração já conectada supera a carga mínima diurna estimada. Um novo projeto neste trafo tende a inverter o fluxo.'],
    atencao: ['Margem apertada', `A geração conectada já passa de ${regras.atencao}% da margem estimada. Cabe pouco antes da inversão.`],
    folga: ['Há margem aparente', `A geração conectada fica abaixo de ${regras.atencao}% da carga mínima diurna estimada.`],
    sem_dado: ['Sem dado para avaliar', 'A base não traz carga ou geração para este trafo. Ausência de dado não é ausência de risco.'],
  };
  const [titulo, texto] = veredito[p.risco];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={aoVoltar} style={botaoLink}><ArrowLeft size={13} /> Voltar à lista</button>
      <div>
        <p style={rotuloSecao}>Transformador de distribuição</p>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '4px 0 0' }}>{p.codigo}</h3>
        <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
          {p.alimentador ? `Alimentador ${p.alimentador}` : 'alimentador não informado'}{p.subestacao ? ` · SE ${p.subestacao}` : ''}
        </p>
      </div>
      <div style={{ background: `${CORES[p.risco]}1A`, border: `1px solid ${CORES[p.risco]}59`, borderRadius: 11, padding: 13 }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800, color: CORES[p.risco], margin: '0 0 6px' }}>
          <AlertTriangle size={14} /> {titulo}
        </p>
        <p style={{ fontSize: 12.5, color: '#D5D5DD', margin: 0, lineHeight: 1.5 }}>{texto}</p>
      </div>
      <div style={bloco}>
        <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>Potência nominal</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kva(p.potencia_nominal_kva)}</span></div>
        <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>Carga mínima diurna estimada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(p.carga_min_diurna_kw)}</span></div>
        <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>GD já conectada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(p.gd_conectada_kw)}</span></div>
        <div style={{ ...linha, background: `${CORES[p.risco]}17` }}><span style={{ fontSize: 12, color: '#D5D5DD', fontWeight: 600 }}>Margem até a inversão</span><span style={{ fontSize: 14, fontWeight: 800, color: CORES[p.risco] }}>{kw(p.margem_kw)}</span></div>
      </div>
      <BarraOcupacao ocupacao={p.ocupacao_pct} risco={p.risco} limiarRisco={regras.risco} />
      <ContextoAlimentador id={p.alimentador_id} aoAbrir={aoAbrirAlimentador} />
      <Procedencia base={base} />
    </div>
  );
}

function DetalheAlimentadorView({ id, props, regras, base, aoVoltar, aoEnquadrar }:
  { id: number; props?: PropsAlimentador; regras: RespostaMapa['regras']; base: RespostaMapa['base']; aoVoltar: () => void; aoEnquadrar: (c: Caixa) => void }) {
  const q = useDetalheAlimentador(id);
  const a = q.data;
  const risco: Risco = a?.risco ?? props?.risco ?? 'sem_dado';
  const codigo = a?.codigo ?? props?.codigo ?? `#${id}`;
  const caixa: Caixa | null =
    a && a.oeste !== null && a.sul !== null && a.leste !== null && a.norte !== null
      ? { oeste: a.oeste, sul: a.sul, leste: a.leste, norte: a.norte }
      : props ? { oeste: props.oeste, sul: props.sul, leste: props.leste, norte: props.norte } : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={aoVoltar} style={botaoLink}><ArrowLeft size={13} /> Voltar à lista</button>
      <div>
        <p style={rotuloSecao}>Alimentador de média tensão</p>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '4px 0 0' }}>{codigo}</h3>
        <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
          {a?.subestacao ? `SE ${a.subestacao}` : props?.subestacao ? `SE ${props.subestacao}` : 'subestação não informada'}
          {a?.distribuidora ? ` · ${a.distribuidora}` : ''}
        </p>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600,
                     color: '#ddd', padding: '4px 9px', borderRadius: 20, background: `${CORES[risco]}2E`, border: `1px solid ${CORES[risco]}80` }}>
        <AlertTriangle size={11} style={{ color: CORES[risco] }} /> {ROTULOS[risco]}
      </span>
      {a && (
        <>
          <div style={bloco}>
            <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>Carga mínima diurna estimada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(a.carga_min_diurna_kw)}</span></div>
            <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>GD já conectada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(a.gd_conectada_kw)}</span></div>
            <div style={{ ...linha, background: `${CORES[risco]}17` }}><span style={{ fontSize: 12, color: '#D5D5DD', fontWeight: 600 }}>Margem até a inversão</span><span style={{ fontSize: 14, fontWeight: 800, color: CORES[risco] }}>{kw(a.margem_kw)}</span></div>
          </div>
          <BarraOcupacao ocupacao={a.ocupacao_pct} risco={risco} limiarRisco={regras.risco} />
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 7 }}>Trafos neste alimentador · {inteiro(a.trafos)}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {ORDEM.map(r => {
                const n = { risco: a.trafos_risco, atencao: a.trafos_atencao, folga: a.trafos_folga, sem_dado: a.trafos_sem_dado }[r];
                return (
                  <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Ponto risco={r} /><span style={{ flex: 1, color: '#D5D5DD' }}>{ROTULOS[r]}</span>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{inteiro(n)}</span>
                    <span style={{ width: 36, textAlign: 'right', color: '#8A8A96' }}>{percentualDe(n, a.trafos)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          {!a.tem_tracado && <p style={{ fontSize: 11.5, color: '#9A9AA8', margin: 0 }}>Este alimentador ainda não tem traçado na base; a caixa vem dos trafos.</p>}
        </>
      )}
      {caixa && <button type="button" onClick={() => aoEnquadrar(caixa)} style={botaoLink}><Crosshair size={13} /> Enquadrar este alimentador</button>}
      <Procedencia base={base} />
    </div>
  );
}

export function PainelLateral({ resposta, carregando, selecao, aoSelecionar, aoEnquadrar, aoCentrar }: Props) {
  const pontos = resposta?.pontos?.features.map(f => f.properties) ?? [];
  const alims = (resposta?.alimentadores?.features.map(f => f.properties) ?? [])
    .slice().sort((a, b) => (b.ocupacao_pct ?? -1) - (a.ocupacao_pct ?? -1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
      {resposta && !selecao && <Resumo r={resposta.resumo} />}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy={carregando}>
        {selecao?.tipo === 'trafo' && resposta && (
          <DetalheTrafo p={selecao.props} regras={resposta.regras} base={resposta.base}
                        aoVoltar={() => aoSelecionar(null)} aoAbrirAlimentador={id => aoSelecionar({ tipo: 'alimentador', id })} />
        )}
        {selecao?.tipo === 'alimentador' && resposta && (
          <DetalheAlimentadorView id={selecao.id} props={selecao.props} regras={resposta.regras} base={resposta.base}
                                  aoVoltar={() => aoSelecionar(null)} aoEnquadrar={aoEnquadrar} />
        )}

        {!selecao && resposta?.camada === 'ponto' && (
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 6 }}>
              Transformadores nesta vista{resposta.excedeu ? ` · os ${inteiro(resposta.teto)} mais ocupados` : ''}
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {pontos.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => { aoSelecionar({ tipo: 'trafo', props: p }); aoCentrar(p.lng, p.lat); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: 'none',
                                   border: 'none', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <Ponto risco={p.risco} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#ddd' }}>{p.codigo}</span>
                    <span style={{ fontSize: 11, color: '#8A8A96', whiteSpace: 'nowrap' }}>{pct(p.ocupacao_pct)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!selecao && resposta?.camada === 'celula' && alims.length === 0 && (
          <p style={{ fontSize: 12, color: '#8A8A96', margin: 0, lineHeight: 1.5 }}>
            Aproxime até o zoom 14 para listar os transformadores, ou ligue a camada de alimentadores para ver os mais saturados.
          </p>
        )}

        {!selecao && alims.length > 0 && (
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 6 }}>Alimentadores mais saturados na vista</p>
            <div style={bloco}>
              {alims.slice(0, 12).map(a => (
                <button key={a.id} type="button" onClick={() => aoSelecionar({ tipo: 'alimentador', id: a.id, props: a })}
                        style={{ ...linha, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', alignItems: 'center' }}>
                  <Ponto risco={a.risco} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{a.codigo}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: '#8A8A96' }}>
                      {a.subestacao ? `SE ${a.subestacao} · ` : ''}{inteiro(a.trafos)} trafos · {inteiro(a.trafos_risco)} em risco
                    </span>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: CORES[a.risco] }}>{pct(a.ocupacao_pct)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ fontSize: 11.5, color: '#9A9AA8', margin: 0, lineHeight: 1.55 }}>
          <strong style={{ color: '#D5D5DD' }}>Indicativo, não é parecer.</strong>{' '}
          A carga mínima é estimada da curva das unidades consumidoras. Só a distribuidora emite o parecer de acesso.
        </p>
      </div>
    </div>
  );
}

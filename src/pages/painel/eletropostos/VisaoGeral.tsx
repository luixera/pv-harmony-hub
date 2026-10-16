import { Clock, Zap, Gauge, Battery, DollarSign, MapPin } from 'lucide-react';
import { card, grid, Kpi } from '../ConsoleSections';
import { useDetalhe } from './consultas';
import { faixa, fmt, mil, pct, perfilMedio } from './calculo';
import { Fita, St } from './Graficos';
import { h3, manchete, mudo, sub, vazio } from './estilo';
import type { Local, Resumo, Status } from './tipos';

interface Props { resumo: Resumo; de: string; ate: string; abrir: (id: string) => void; irParaColeta: () => void }

export function VisaoGeral({ resumo, de, ate, abrir, irParaColeta }: Props) {
  const k = resumo.kpis;
  const mon = resumo.locais.filter(l => l.monitorado).sort((a, b) => (b.ocupacao ?? -1) - (a.ocupacao ?? -1));
  if (!mon.length) {
    return (
      <div>
        <p style={manchete}>Nenhum carregador está sendo monitorado ainda.</p>
        <p style={sub}>
          {k.locais} locais cadastrados ({k.locais_dc} rápidos). Assim que o coletor rodar, as leituras aparecem aqui.
          {' '}<button onClick={irParaColeta} style={{ all: 'unset', color: '#F5A800', cursor: 'pointer', textDecoration: 'underline' }}>Veja a aba Coleta</button>.
        </p>
      </div>
    );
  }
  const dias = k.dias;
  const porConectorDia = k.horas_ocupado / dias / Math.max(1, k.conectores_monitorados);
  const agora = (['ocupado', 'livre', 'fora', 'desconhecido'] as Status[]).filter(s => k.agora[s]);
  return (
    <div>
      <p style={manchete}>
        Em {fmt(dias, dias < 2 ? 1 : 0)} {dias < 2 ? 'dia' : 'dias'}, os <b>{k.conectores_monitorados} conectores</b> monitorados ficaram carregando{' '}
        <b>{pct(k.ocupacao_media)}</b> do tempo — cerca de <b>{fmt(porConectorDia, 1)} h por conector por dia</b>.
      </p>
      <p style={{ ...sub, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Agora:</span>
        {agora.map(s => <span key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{k.agora[s]} <St s={s} /></span>)}
        <span style={mudo}>· Cobertura da coleta no período: {pct(k.cobertura)}.</span>
      </p>
      <div style={{ ...grid(170), marginBottom: 22 }}>
        <Kpi icon={Clock} label="Horas carregando" value={`${fmt(k.horas_ocupado, 0)} h`} />
        <Kpi icon={Zap} label="Recargas detectadas" value={fmt(k.sessoes, 0)} />
        <Kpi icon={Battery} label="Energia estimada" value={`${faixa(k.kwh_min, k.kwh_max, v => fmt(v / 1000, 1))} MWh`} hint="faixa, não medição" />
        <Kpi icon={DollarSign} label="Receita estimada" value={`R$ ${faixa(k.receita_min, k.receita_max, mil)} mil`} hint="preço do local ou padrão" />
        <Kpi icon={MapPin} label="Locais monitorados" value={String(k.monitorados)} hint={`de ${k.locais_dc} rápidos`} />
        <Kpi icon={Gauge} label="Ocupação média" value={pct(k.ocupacao_media)} />
      </div>

      <h3 style={h3}>Uso por hora do dia</h3>
      <p style={{ ...sub, marginBottom: 10 }}>Altura e cor = fração do tempo em que o local esteve carregando naquela hora, média do período. Clique para ver o detalhe.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,260px) 1fr 92px', gap: 14, padding: '0 14px 6px', color: '#777', fontSize: 11 }}>
        <div />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
        <div style={{ textAlign: 'right' }}>ocupação</div>
      </div>
      <div style={{ ...card, padding: 0 }}>
        {mon.map((l, i) => <FitaLocal key={l.id} local={l} de={de} ate={ate} primeira={i === 0} abrir={abrir} />)}
      </div>
      {mon.length === 0 && <div style={vazio}>Sem locais monitorados.</div>}
    </div>
  );
}

function FitaLocal({ local: l, de, ate, primeira, abrir }: { local: Local; de: string; ate: string; primeira: boolean; abrir: (id: string) => void }) {
  const { data } = useDetalhe(l.id, de, ate);
  const perfil = perfilMedio(data?.perfil);
  return (
    <div role="button" tabIndex={0} onClick={() => abrir(l.id)} onKeyDown={e => e.key === 'Enter' && abrir(l.id)}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,260px) 1fr 92px', gap: 14, alignItems: 'center', padding: '10px 14px',
        borderTop: primeira ? 'none' : '1px solid #1a1a22', cursor: 'pointer' }}>
      <div style={{ fontWeight: 600, lineHeight: 1.25, color: '#eee', fontSize: 13 }}>
        {l.nome}
        <small style={{ display: 'block', color: '#777', fontWeight: 400, fontSize: 11.5 }}>
          {l.operadora || 'Operadora não informada'} · {l.conectores_monitorados} conector{l.conectores_monitorados > 1 ? 'es' : ''} · {fmt(l.potencia_kw, 0)} kW
        </small>
      </div>
      <Fita perfil={perfil} />
      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 16, color: '#fff' }}>
        {pct(l.ocupacao)}
        <small style={{ display: 'block', fontSize: 11, color: '#777', fontWeight: 400 }}>{fmt(l.horas_ocupado_dia / Math.max(1, l.conectores_monitorados), 1)} h/dia/conector</small>
      </div>
    </div>
  );
}

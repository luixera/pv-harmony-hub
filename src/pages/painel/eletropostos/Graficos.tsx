import { GOLD } from '../ConsoleSections';
import { brl, faixa, fmt, pct } from './calculo';
import { COR_STATUS, ROTULO_STATUS, type DiaSerie, type Status } from './tipos';

/**
 * Gráficos em SVG inline, portados do painel local: a fita de ocupação por
 * hora (assinatura visual), barras por dia, mapa de calor dia × hora e a
 * linha do tempo de 48 h. Sem biblioteca: são poucos retângulos.
 */

export function St({ s }: { s: Status | null | undefined }) {
  const k: Status = s ?? 'desconhecido';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', color: '#ddd' }}>
      <i style={{ width: 8, height: 8, borderRadius: '50%', background: COR_STATUS[k], display: 'inline-block' }} />{ROTULO_STATUS[k]}
    </span>
  );
}

/** 24 barras: altura e opacidade = fração do tempo carregando naquela hora. */
export function Fita({ perfil }: { perfil: (number | null)[] }) {
  const w = 480, h = 30, bw = w / 24;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Ocupação por hora do dia" style={{ width: '100%', height: 30, display: 'block' }}>
      {perfil.map((v, i) => v == null
        ? <rect key={i} x={i * bw + 1} y={h - 3} width={bw - 2} height={3} fill="#2a2a35"><title>{i}h: sem leitura</title></rect>
        : <rect key={i} x={i * bw + 1} y={h - Math.max(3, v * h)} width={bw - 2} height={Math.max(3, v * h)} rx={2} fill={GOLD} fillOpacity={0.35 + 0.65 * v}>
            <title>{i}h: {fmt(v * 100, 0)}% do tempo carregando</title>
          </rect>)}
    </svg>
  );
}

export function BarrasDia({ diario }: { diario: DiaSerie[] }) {
  if (!diario.length) return null;
  const w = 680, h = 150, pad = 26, bw = (w - pad) / diario.length;
  const max = Math.max(1, ...diario.map(d => d.horas_ocupado));
  const y = (v: number) => h - 20 - (v / max) * (h - 34);
  const passo = Math.ceil(diario.length / 14);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Horas carregando por dia">
      <line x1={pad} x2={w} y1={h - 20} y2={h - 20} stroke="#2a2a35" />
      {diario.map((d, i) => {
        const x = pad + i * bw, alt = h - 20 - y(d.horas_ocupado);
        const dia = new Date(d.dia + 'T12:00');
        return (
          <g key={d.dia}>
            <rect x={x + bw * 0.3} y={y(d.horas_ocupado)} width={bw * 0.4} height={Math.max(0, alt)} rx={3} fill={GOLD}>
              <title>{dia.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}: {fmt(d.horas_ocupado, 1)} h carregando · {pct(d.ocupacao)} · receita {faixa(d.receita_min, d.receita_max, brl)}</title>
            </rect>
            {diario.length <= 14 && d.horas_ocupado > 0 && <text x={x + bw / 2} y={y(d.horas_ocupado) - 4} textAnchor="middle" fill="#aaa" fontSize={11}>{fmt(d.horas_ocupado, 1)}</text>}
            {(diario.length <= 14 || i % passo === 0) && <text x={x + bw / 2} y={h - 5} textAnchor="middle" fill="#888" fontSize={11}>{dia.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</text>}
          </g>
        );
      })}
    </svg>
  );
}

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export function MapaCalor({ perfil }: { perfil: (number | null)[][] }) {
  const cw = 25, ch = 20, x0 = 36, y0 = 4;
  return (
    <svg viewBox={`0 0 ${x0 + 24 * cw} ${y0 + 7 * ch + 18}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Ocupação por dia da semana e hora">
      {perfil.map((lin, w) => (
        <g key={w}>
          <text x={0} y={y0 + w * ch + 14} fill="#888" fontSize={11}>{DIAS[w]}</text>
          {lin.map((v, h) => (
            <rect key={h} x={x0 + h * cw + 1} y={y0 + w * ch + 1} width={cw - 2} height={ch - 2} rx={3}
              fill={v == null ? '#1e1e28' : GOLD} fillOpacity={v == null ? 1 : 0.08 + 0.92 * v}>
              <title>{DIAS[w]} {h}h: {v == null ? 'sem leitura' : fmt(v * 100, 0) + '% carregando'}</title>
            </rect>
          ))}
        </g>
      ))}
      {[0, 6, 12, 18, 23].map(h => <text key={h} x={x0 + h * cw + cw / 2} y={y0 + 7 * ch + 14} textAnchor="middle" fill="#888" fontSize={11}>{h}h</text>)}
    </svg>
  );
}

/** Últimas 48 h de um conector: barra cheia = carregando, traço = fora/sem leitura. */
export function LinhaTempo({ pontos }: { pontos: [string, Status][] | undefined }) {
  if (!pontos?.length) return null;
  const fim = new Date(pontos[pontos.length - 1][0]).getTime(), ini = fim - 48 * 3600e3, w = 680, h = 22;
  const x = (t: string) => (new Date(t).getTime() - ini) / (fim - ini) * w;
  const pts = pontos.filter(r => new Date(r[0]).getTime() >= ini && r[1] !== 'livre');
  return (
    <svg viewBox={`0 0 ${w} ${h + 14}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Últimas 48 horas">
      <rect x={0} y={0} width={w} height={h} fill="#1e1e28" rx={3} />
      {pts.map((r, i) => (
        <rect key={i} x={x(r[0])} y={r[1] === 'ocupado' ? 0 : h / 2 - 2} width={Math.max(1.5, w / 576)} height={r[1] === 'ocupado' ? h : 4} fill={COR_STATUS[r[1]]}>
          <title>{r[0].replace('T', ' ')} · {ROTULO_STATUS[r[1]]}</title>
        </rect>
      ))}
      <text x={0} y={h + 12} fill="#888" fontSize={11}>há 48 h</text>
      <text x={w} y={h + 12} textAnchor="end" fill="#888" fontSize={11}>agora</text>
    </svg>
  );
}

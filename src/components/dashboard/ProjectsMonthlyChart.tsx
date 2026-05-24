import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useProjectsMonthly } from '@/hooks/useProjectsMonthly';

// ── Tooltip customizado ───────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1A1A1A', borderRadius: 8,
      padding: '10px 14px', border: 'none',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8, margin: '0 0 8px' }}>
        {label}
      </p>
      {payload.map((entry: any) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: entry.fill, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{entry.name}:</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginLeft: 2 }}>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Skeleton de loading ───────────────────────────────────────────────────────
function ChartSkeleton() {
  return (
    <div className="kpi-card" style={{ height: 340 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[140, 90, 110].map((w, i) => (
          <div key={i} style={{
            height: 16, width: w, borderRadius: 4,
            background: 'var(--color-background-secondary, #F5F5F5)',
            animation: 'pulse 1.5s infinite',
          }} />
        ))}
      </div>
      <div style={{
        height: 260, borderRadius: 8,
        background: 'var(--color-background-secondary, #F5F5F5)',
      }} />
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function ProjectsMonthlyChart() {
  const [period, setPeriod] = useState<3 | 6 | 12>(12);
  const { data: allData = [], isLoading } = useProjectsMonthly();

  // Filtrar pelo período selecionado
  const chartData = useMemo(() => allData.slice(-period), [allData, period]);

  // Métricas do período
  const totalRecebidos = chartData.reduce((s, d) => s + d.recebidos, 0);
  const totalAprovados = chartData.reduce((s, d) => s + d.aprovados, 0);
  const taxaAprovacao  = totalRecebidos > 0
    ? Math.round((totalAprovados / totalRecebidos) * 100)
    : 0;

  if (isLoading) return <ChartSkeleton />;

  return (
    <div className="kpi-card">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p style={{
            fontSize: 14, fontWeight: 600, margin: '0 0 3px',
            display: 'flex', alignItems: 'center', gap: 7,
          }}
            className="text-card-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="#F5A800" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6"  y1="20" x2="6"  y2="14" />
            </svg>
            Projetos por mês
          </p>
          <p className="text-muted-foreground" style={{ fontSize: 12, margin: 0 }}>
            Recebidos, aprovados e reprovados
          </p>
        </div>

        {/* Seletor de período */}
        <select
          value={period}
          onChange={e => setPeriod(Number(e.target.value) as 3 | 6 | 12)}
          className="text-muted-foreground"
          style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 8,
            border: '1px solid var(--border)', cursor: 'pointer',
            background: 'transparent', outline: 'none',
          }}
        >
          <option value={3}>Últimos 3 meses</option>
          <option value={6}>Últimos 6 meses</option>
          <option value={12}>Últimos 12 meses</option>
        </select>
      </div>

      {/* Legenda + métricas */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
        {[
          { color: '#F5A800', label: 'Recebidos'  },
          { color: '#639922', label: 'Aprovados'  },
          { color: '#E24B4A', label: 'Reprovados' },
        ].map(item => (
          <span key={item.label} className="text-muted-foreground"
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, display: 'inline-block', flexShrink: 0 }} />
            {item.label}
          </span>
        ))}

        {/* Métricas */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 24 }}>
          <div style={{ textAlign: 'right' }}>
            <p className="text-muted-foreground" style={{ fontSize: 11, margin: 0 }}>Total no período</p>
            <p className="text-card-foreground" style={{ fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
              {totalRecebidos}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="text-muted-foreground" style={{ fontSize: 11, margin: 0 }}>Taxa de aprovação</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.2, color: '#3B6D11' }}>
              {taxaAprovacao}%
            </p>
          </div>
        </div>
      </div>

      {/* Gráfico ou estado vazio */}
      {chartData.length === 0 || totalRecebidos === 0 ? (
        <div style={{
          height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 8,
        }} className="text-muted-foreground">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6"  y1="20" x2="6"  y2="14" />
          </svg>
          <span style={{ fontSize: 13 }}>Nenhum projeto no período</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
            barCategoryGap="30%"
            barGap={3}
          >
            <CartesianGrid vertical={false} stroke="rgba(136,135,128,0.15)" strokeWidth={0.5} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: '#888780' }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={period > 6 ? -30 : 0}
              textAnchor={period > 6 ? 'end' : 'middle'}
              height={period > 6 ? 45 : 30}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#888780' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={30}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(136,135,128,0.06)' }} />
            <Bar dataKey="recebidos"  name="Recebidos"  fill="#F5A800" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="aprovados"  name="Aprovados"  fill="#639922" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="reprovados" name="Reprovados" fill="#E24B4A" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

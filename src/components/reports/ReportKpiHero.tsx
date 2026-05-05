import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react'
import { ReportKPIs } from '@/hooks/useReports'

interface ReportKpiHeroProps {
  kpis: ReportKPIs
  filterLabel: string | null
  variation: number
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0)

const formatCurrencyShort = (v: number) => {
  if (v >= 1000000) return `R$${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `R$${(v / 1000).toFixed(0)}k`
  return formatCurrency(v)
}

export function ReportKpiHero({ kpis, filterLabel, variation }: ReportKpiHeroProps) {
  const isPositive = variation >= 0
  const meta = kpis.totalFaturamento > 0
    ? Math.max(kpis.totalFaturamento * 1.15, kpis.totalFaturamento + 1)
    : 100
  const progress = kpis.totalFaturamento > 0 ? Math.min(Math.round((kpis.totalFaturamento / meta) * 100), 100) : 0

  return (
    <div
      style={{
        background: '#1A1A1A',
        borderRadius: 14,
        padding: 18,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative circles */}
      <div
        style={{
          position: 'absolute',
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: 'rgba(245,168,0,0.07)',
          top: -40,
          right: -30,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'rgba(245,168,0,0.05)',
          bottom: -20,
          left: 20,
          pointerEvents: 'none',
        }}
      />

      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: isPositive ? 'rgba(245,168,0,0.15)' : 'rgba(226,75,74,0.15)',
            color: isPositive ? '#F5A800' : '#FF6B6B',
            borderRadius: 20,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {isPositive ? '+' : ''}{variation}% vs anterior
        </span>
        <div
          style={{
            width: 32,
            height: 32,
            background: 'rgba(245,168,0,0.12)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <DollarSign size={16} color="#F5A800" />
        </div>
      </div>

      {/* Main value */}
      <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', lineHeight: 1.1, marginBottom: 4 }}>
        {formatCurrencyShort(kpis.totalFaturamento)}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
        Faturamento{filterLabel ? ` — ${filterLabel}` : ''}
      </div>

      {/* Trend */}
      {kpis.faturamentoAnterior > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
          {isPositive ? '+' : ''}{formatCurrencyShort(Math.abs(kpis.totalFaturamento - kpis.faturamentoAnterior))} vs trimestre anterior
        </div>
      )}

      {/* Progress bar */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #F5A800, #FFD166)',
              borderRadius: 2,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
          Meta: {formatCurrencyShort(meta)}
        </span>
        <span style={{ fontSize: 9, color: '#F5A800', fontWeight: 700 }}>{progress}% atingido</span>
      </div>
    </div>
  )
}

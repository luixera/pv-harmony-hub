import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts'
import { MonthlyData } from '@/hooks/useReports'

interface ReportBarChartProps {
  data: MonthlyData[]
  type: 'projects' | 'financial' | 'power'
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0)

function CustomTooltip({ active, payload, label, type }: TooltipProps<number, string> & { type: string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div
      style={{
        background: '#1A1A1A',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 11,
        color: '#fff',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4, color: '#F5A800' }}>{label}</div>
      {payload.map((entry, i) => (
        <div key={i} style={{ color: '#ddd' }}>
          {entry.name}:{' '}
          <strong style={{ color: '#fff' }}>
            {type === 'financial'
              ? formatCurrency(entry.value as number)
              : type === 'power'
              ? `${(entry.value as number).toFixed(2)} kWp`
              : entry.value}
          </strong>
        </div>
      ))}
    </div>
  )
}

export function ReportBarChart({ data, type }: ReportBarChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Sem dados no período</span>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} barCategoryGap="25%" barGap={2}>
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 10, fill: '#aaa' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip type={type} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />

        {type === 'projects' && (
          <>
            <Bar dataKey="novos" name="Novos" stackId="a" fill="#F5A800" radius={[0, 0, 0, 0]} isAnimationActive />
            <Bar dataKey="concluidos" name="Concluídos" stackId="a" fill="#2D6A4F" radius={[4, 4, 0, 0]} isAnimationActive />
          </>
        )}

        {type === 'financial' && (
          <>
            <Bar dataKey="faturado" name="Faturado" stackId="b" fill="#378ADD" radius={[0, 0, 0, 0]} isAnimationActive />
            <Bar dataKey="recebido" name="Recebido" stackId="b" fill="#2D6A4F" radius={[4, 4, 0, 0]} isAnimationActive />
          </>
        )}

        {type === 'power' && (
          <Bar dataKey="potencia" name="Potência (kWp)" fill="#534AB7" radius={[4, 4, 0, 0]} isAnimationActive />
        )}
      </BarChart>
    </ResponsiveContainer>
  )
}

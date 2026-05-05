import { BarChart, Bar, ResponsiveContainer, Cell } from 'recharts'
import { MonthlyData } from '@/hooks/useReports'

interface ReportTicketChartProps {
  data: MonthlyData[]
}

const formatCurrency = (v: number) => {
  if (v >= 1000000) return `R$${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `R$${(v / 1000).toFixed(0)}k`
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0)
}

export function ReportTicketChart({ data }: ReportTicketChartProps) {
  const avg = data.length > 0 ? data.reduce((acc, m) => acc + m.ticketMedio, 0) / data.length : 0

  if (data.length === 0) {
    return (
      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Sem dados</span>
      </div>
    )
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} barCategoryGap="20%">
          <Bar dataKey="ticketMedio" radius={[3, 3, 0, 0]} isAnimationActive>
            {data.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill="#F5A800"
                fillOpacity={0.3 + (index / Math.max(data.length - 1, 1)) * 0.7}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div
        style={{
          background: '#FEF3D0',
          border: '0.5px solid #F5A800',
          borderRadius: 6,
          padding: '5px 10px',
          fontSize: 11,
          color: '#854F0B',
          fontWeight: 600,
          marginTop: 6,
          textAlign: 'center',
        }}
      >
        Média: {formatCurrency(avg)}
      </div>
    </div>
  )
}

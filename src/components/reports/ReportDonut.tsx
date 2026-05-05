import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { ConcessionaireData } from '@/hooks/useReports'

interface ReportDonutProps {
  data: ConcessionaireData[]
}

const COLORS = ['#F5A800', '#378ADD', '#2D6A4F', '#D85A30', '#D0D0D0']

export function ReportDonut({ data }: ReportDonutProps) {
  const total = data.reduce((acc, d) => acc + d.count, 0)

  if (data.length === 0 || total === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140 }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Sem dados no período</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      {/* Donut */}
      <div style={{ flexShrink: 0 }}>
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              cx="50%"
              cy="50%"
              innerRadius={32}
              outerRadius={50}
              paddingAngle={2}
              isAnimationActive
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '0.5px solid #E0E0E0' }}
              formatter={(value: number, name: string) => [value, name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ textAlign: 'center', marginTop: -8 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1A1A1A' }}>{total}</div>
          <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' }}>projetos</div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map((item, index) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: COLORS[index % COLORS.length],
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: '#555',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#1A1A1A', marginLeft: 4 }}>{item.count}</span>
            <span style={{ fontSize: 9, color: '#aaa', width: 28, textAlign: 'right' }}>{item.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

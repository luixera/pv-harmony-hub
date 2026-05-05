import { CompanyRanking, StaffRanking } from '@/hooks/useReports'

interface ReportRankingProps {
  items: (CompanyRanking | StaffRanking)[]
  title: string
}

const formatCurrencyShort = (v: number) => {
  if (v >= 1000000) return `R$${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `R$${(v / 1000).toFixed(0)}k`
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0)
}

const rankColors: Record<number, { bg: string; color: string }> = {
  0: { bg: '#FEF3D0', color: '#854F0B' },
  1: { bg: '#F0F0F0', color: '#555' },
  2: { bg: '#FFF8EE', color: '#A06520' },
}

export function ReportRanking({ items, title }: ReportRankingProps) {
  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100 }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Sem dados no período</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, index) => {
        const rankStyle = rankColors[index] || { bg: '#F8F8F8', color: '#777' }
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Position */}
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: rankStyle.bg,
                color: rankStyle.color,
                fontSize: 10,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {index + 1}
            </span>

            {/* Name + bar */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#1A1A1A',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginBottom: 3,
                }}
              >
                {item.name}
              </div>
              <div
                style={{
                  height: 4,
                  background: '#F0F0F0',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${item.barWidth}%`,
                    background: index === 0 ? '#F5A800' : '#D0D0D0',
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>

            {/* Values */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#2D6A4F' }}>
                {formatCurrencyShort(item.faturamento)}
              </div>
              <div style={{ fontSize: 9, color: '#aaa' }}>{item.projects} proj.</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

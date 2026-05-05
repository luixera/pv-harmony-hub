import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface ReportKpiCardProps {
  value: string
  label: string
  subtext?: string
  trend?: number
  trendPositive?: boolean
  iconColor: string
  icon: React.ElementType
  sparkData?: number[]
}

export function ReportKpiCard({
  value,
  label,
  subtext,
  trend,
  trendPositive,
  iconColor,
  icon: Icon,
  sparkData = [],
}: ReportKpiCardProps) {
  const maxSpark = Math.max(...sparkData, 1)
  const hasTrend = trend !== undefined

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: 14,
        border: '0.5px solid #EBEBEB',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `${iconColor}18`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={14} color={iconColor} />
        </div>

        {hasTrend && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              background: trendPositive ? 'rgba(45,106,79,0.10)' : 'rgba(226,75,74,0.10)',
              color: trendPositive ? '#2D6A4F' : '#E24B4A',
              borderRadius: 20,
              padding: '2px 7px',
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {trendPositive ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {trendPositive ? '+' : ''}{trend}%
          </span>
        )}
      </div>

      {/* Value */}
      <div style={{ fontSize: 20, fontWeight: 800, color: '#1A1A1A', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#aaa' }}>{label}</div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 }}>
        {subtext && <span style={{ fontSize: 9, color: '#bbb' }}>{subtext}</span>}

        {/* Sparkline */}
        {sparkData.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22 }}>
            {sparkData.map((val, i) => (
              <div
                key={i}
                style={{
                  width: 5,
                  height: `${Math.max((val / maxSpark) * 100, 10)}%`,
                  background: iconColor,
                  borderRadius: 2,
                  opacity: 0.3 + (i / Math.max(sparkData.length - 1, 1)) * 0.7,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

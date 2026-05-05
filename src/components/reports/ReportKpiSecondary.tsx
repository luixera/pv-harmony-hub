import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface ReportKpiSecondaryProps {
  label: string
  value: string
  delta?: number
  deltaPositive?: boolean
  iconBg: string
  iconColor: string
  icon: React.ElementType
}

export function ReportKpiSecondary({
  label,
  value,
  delta,
  deltaPositive,
  iconBg,
  iconColor,
  icon: Icon,
}: ReportKpiSecondaryProps) {
  const hasDelta = delta !== undefined

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: '#fff',
        borderRadius: 12,
        padding: 13,
        border: '0.5px solid #EBEBEB',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={16} color={iconColor} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            color: '#aaa',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1A1A1A', lineHeight: 1.2 }}>{value}</div>
      </div>

      {hasDelta && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            background: deltaPositive ? 'rgba(45,106,79,0.10)' : 'rgba(226,75,74,0.10)',
            color: deltaPositive ? '#2D6A4F' : '#E24B4A',
            borderRadius: 20,
            padding: '3px 7px',
            fontSize: 9,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {deltaPositive ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
          {deltaPositive ? '+' : ''}{delta}%
        </span>
      )}
    </div>
  )
}

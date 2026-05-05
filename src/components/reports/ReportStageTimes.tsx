import { StageTime } from '@/hooks/useReports'

interface ReportStageTimesProps {
  stageTimes: StageTime[]
  total: number
}

export function ReportStageTimes({ stageTimes, total }: ReportStageTimesProps) {
  const maxDays = Math.max(...stageTimes.map((s) => s.days), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {stageTimes.map((st) => (
        <div key={st.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Label */}
          <span
            style={{
              fontSize: 10,
              color: '#888',
              width: 140,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {st.label}
          </span>

          {/* Bar */}
          <div style={{ flex: 1, height: 8, background: '#F5F5F5', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(st.days / maxDays) * 100}%`,
                background: st.color,
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          {/* Days */}
          <span style={{ fontSize: 10, fontWeight: 700, color: '#1A1A1A', width: 36, textAlign: 'right', flexShrink: 0 }}>
            {st.days}d
          </span>
        </div>
      ))}

      {/* Total */}
      <div
        style={{
          marginTop: 4,
          paddingTop: 8,
          borderTop: '0.5px solid #F0F0F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 10, color: '#888' }}>Tempo total médio</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#1A1A1A' }}>{total}d</span>
      </div>
    </div>
  )
}

import { StageData } from '@/hooks/useReports'

interface ReportFunnelProps {
  stages: StageData[]
}

export function ReportFunnel({ stages }: ReportFunnelProps) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1)

  if (stages.every((s) => s.count === 0)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140 }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Sem dados no período</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {stages.map((stage) => {
        const width = maxCount > 0 ? Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 8 : 0) : 0
        return (
          <div key={stage.stage} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Label */}
            <span
              style={{
                fontSize: 10,
                color: '#888',
                width: 90,
                flexShrink: 0,
                textAlign: 'right',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {stage.stageLabel}
            </span>

            {/* Bar */}
            <div style={{ flex: 1, position: 'relative', height: 22 }}>
              <div
                style={{
                  height: '100%',
                  width: `${width}%`,
                  background: stage.color,
                  borderRadius: 5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: stage.count > 0 ? 28 : 0,
                  transition: 'width 0.3s ease',
                }}
              >
                {stage.count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{stage.count}</span>
                )}
              </div>
            </div>

            {/* Percentage */}
            <span
              style={{
                fontSize: 10,
                color: '#aaa',
                width: 30,
                flexShrink: 0,
                textAlign: 'right',
              }}
            >
              {stage.percentage}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

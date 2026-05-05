import { useState, useEffect } from 'react';
import { Clock, Edit2 } from 'lucide-react';
import { ProjectRevision } from '@/hooks/useProjectRevisions';
import { computeRevisionDiff, formatDiffValue } from '@/utils/revisionDiff';

interface RevisionTimelineProps {
  revisions: ProjectRevision[];
}

interface RevisionStatus {
  label: string;
  color: string;
  bg: string;
  isCurrent: boolean;
}

function getRevisionStatus(index: number, total: number): RevisionStatus {
  if (index === total - 1) {
    return { label: 'Atual', color: '#F5A800', bg: '#FEF3D0', isCurrent: true };
  }
  return { label: 'Reprovada', color: '#A32D2D', bg: '#FCEBEB', isCurrent: false };
}

export function RevisionTimeline({ revisions }: RevisionTimelineProps) {
  // Sort ascending: oldest first, newest last
  const ordered = [...revisions].sort((a, b) => a.revision_number - b.revision_number);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Expand the latest revision by default once data loads
  useEffect(() => {
    if (ordered.length > 0 && expandedIds.size === 0) {
      setExpandedIds(new Set([ordered[ordered.length - 1].id]));
    }
  }, [ordered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{
      background: '#F8F8F8',
      borderRadius: 10,
      border: '0.5px solid #EFEFEF',
      padding: '12px 14px',
      marginBottom: 16,
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10,
          fontWeight: 600,
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
        }}>
          <Clock size={11} />
          Histórico de revisões
        </div>
        <span style={{
          background: '#F5A800',
          color: '#1A1A1A',
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 7px',
          borderRadius: 20,
        }}>
          {ordered.length}
        </span>
      </div>

      {/* ── Timeline ── */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {ordered.map((rev, index) => {
          const isExpanded = expandedIds.has(rev.id);
          const isLast     = index === ordered.length - 1;
          const prevRev    = index > 0 ? ordered[index - 1] : null;
          const diff       = prevRev ? computeRevisionDiff(prevRev, rev) : null;
          const revStatus  = getRevisionStatus(index, ordered.length);
          const powerDiff  = diff?.equipment.find(d => d.field === 'total_installed_power') ?? null;

          return (
            <div
              key={rev.id}
              style={{
                display: 'flex',
                gap: 10,
                position: 'relative',
                paddingBottom: isLast ? 0 : 4,
              }}
            >
              {/* Connector line between items */}
              {!isLast && (
                <div style={{
                  position: 'absolute',
                  left: 9,
                  top: 22,
                  bottom: 0,
                  width: 1,
                  background: '#E0E0E0',
                  zIndex: 0,
                }} />
              )}

              {/* Numbered dot */}
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: revStatus.bg,
                color: revStatus.color,
                border: `1.5px solid ${revStatus.color}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                flexShrink: 0,
                position: 'relative',
                zIndex: 1,
                marginTop: 2,
              }}>
                {index + 1}
              </div>

              {/* Content column */}
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14 }}>

                {/* Clickable header row */}
                <div
                  onClick={() => toggleExpand(rev.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    cursor: 'pointer',
                    marginBottom: isExpanded ? 8 : 0,
                    padding: '3px 0',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A' }}>
                    Revisão {rev.revision_number}
                  </span>
                  <span style={{ fontSize: 10, color: '#aaa' }}>
                    {new Date(rev.created_at).toLocaleDateString('pt-BR')}
                  </span>
                  <span style={{
                    background: revStatus.bg,
                    color: revStatus.color,
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 7px',
                    borderRadius: 20,
                  }}>
                    {revStatus.label}
                  </span>
                  {isLast && (
                    <span style={{
                      background: '#FEF3D0',
                      color: '#854F0B',
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '1px 7px',
                      borderRadius: 20,
                    }}>
                      atual
                    </span>
                  )}
                  {/* Animated chevron */}
                  <span style={{
                    marginLeft: 'auto',
                    color: '#aaa',
                    fontSize: 11,
                    display: 'inline-block',
                    transition: 'transform .15s ease',
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}>
                    ▸
                  </span>
                </div>

                {/* ── Expanded body ── */}
                {isExpanded && (
                  <div>
                    {/* Rejection reason */}
                    {rev.rejection_reason && (
                      <div style={{
                        background: '#FCEBEB',
                        border: '0.5px solid #FFBDBD',
                        borderRadius: 7,
                        padding: '7px 10px',
                        marginBottom: 8,
                        display: 'flex',
                        gap: 6,
                        alignItems: 'flex-start',
                      }}>
                        <span style={{ color: '#A32D2D', fontSize: 14, flexShrink: 0, lineHeight: 1.3 }}>⚠</span>
                        <span style={{ fontSize: 10, color: '#A32D2D', lineHeight: 1.5 }}>
                          <strong>Motivo:</strong>{' '}{rev.rejection_reason}
                        </span>
                      </div>
                    )}

                    {/* First revision: no previous to compare */}
                    {!prevRev && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: '#F5F5F5',
                        color: '#888',
                        fontSize: 9,
                        padding: '3px 9px',
                        borderRadius: 20,
                      }}>
                        📋 Submissão original
                      </span>
                    )}

                    {/* Diff vs previous revision */}
                    {diff && (
                      <div>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#555',
                          marginBottom: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}>
                          <Edit2 size={11} />
                          O que mudou vs Rev.{' '}{ordered[index - 1].revision_number}:
                        </div>

                        {!diff.hasChanges ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: '#F0F0F0',
                            color: '#888',
                            fontSize: 9,
                            padding: '3px 9px',
                            borderRadius: 20,
                          }}>
                            Sem alterações nos dados
                          </span>
                        ) : (
                          <div>
                            {/* Change cards grid */}
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 6,
                            }}>
                              {[...diff.equipment, ...diff.generalData].map(d => (
                                <div key={d.field} style={{
                                  background: '#fff',
                                  borderRadius: 7,
                                  padding: '7px 9px',
                                  border: '0.5px solid #EFEFEF',
                                }}>
                                  <label style={{
                                    fontSize: 9,
                                    color: '#aaa',
                                    textTransform: 'uppercase',
                                    letterSpacing: '.04em',
                                    display: 'block',
                                    marginBottom: 3,
                                  }}>
                                    {d.label}
                                  </label>
                                  <span style={{
                                    fontSize: 10,
                                    color: '#A32D2D',
                                    textDecoration: 'line-through',
                                    display: 'block',
                                  }}>
                                    {formatDiffValue(d.from, d.field)}
                                  </span>
                                  <span style={{
                                    fontSize: 10,
                                    color: '#0F6E56',
                                    fontWeight: 600,
                                    display: 'block',
                                    marginTop: 2,
                                  }}>
                                    {formatDiffValue(d.to, d.field)}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* Power total highlight badge */}
                            {powerDiff && (
                              <div style={{
                                marginTop: 6,
                                padding: '7px 10px',
                                background: '#E1F5EE',
                                borderRadius: 7,
                                border: '0.5px solid #9FE1CB',
                                fontSize: 10,
                                color: '#0F6E56',
                              }}>
                                ✓ Potência:{' '}
                                {powerDiff.from ?? '—'} kWp →{' '}
                                <strong>{powerDiff.to ?? '—'} kWp</strong>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

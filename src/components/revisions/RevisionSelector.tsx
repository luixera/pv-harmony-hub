import { Plus, X } from 'lucide-react';
import { ProjectRevision } from '@/hooks/useProjectRevisions';

interface RevisionSelectorProps {
  revisions: ProjectRevision[];
  selectedRevisionId: string | null;
  onSelectRevision: (id: string) => void;
  onNewRevision: () => void;
  projectStatus: string | undefined;
  userRole: string | undefined;
  rejectionStatusKey?: string;
}

export function RevisionSelector({
  revisions,
  selectedRevisionId,
  onSelectRevision,
  onNewRevision,
  projectStatus,
  userRole,
  rejectionStatusKey,
}: RevisionSelectorProps) {
  const canCreateRevision =
    (userRole === 'admin' || userRole === 'staff') &&
    projectStatus === (rejectionStatusKey ?? 'rejected');

  const getPillStyle = (revision: ProjectRevision, isSelected: boolean) => {
    if (isSelected && revision.is_current) {
      return {
        background: '#F5A800',
        color: '#1A1A1A',
        border: '0.5px solid #F5A800',
        fontWeight: 700,
      };
    }
    if (revision.status === 'rejected') {
      return {
        background: '#FCEBEB',
        color: '#A32D2D',
        border: '0.5px solid #E24B4A',
        fontWeight: 500,
      };
    }
    if (revision.is_current) {
      return {
        background: '#F5A800',
        color: '#1A1A1A',
        border: '0.5px solid #F5A800',
        fontWeight: 700,
      };
    }
    return {
      background: '#E1F5EE',
      color: '#0F6E56',
      border: '0.5px solid #A3D9C5',
      fontWeight: 500,
    };
  };

  return (
    <div
      style={{
        background: '#FEF3D0',
        borderBottom: '0.5px solid rgba(245,168,0,0.3)',
        padding: '10px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#854F0B',
          whiteSpace: 'nowrap',
        }}
      >
        Revisões:
      </span>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {revisions.map(revision => {
          const isSelected = selectedRevisionId === revision.id;
          const pillStyle = getPillStyle(revision, isSelected);
          const isRejected = revision.status === 'rejected';

          const pill = (
            <button
              key={revision.id}
              onClick={() => onSelectRevision(revision.id)}
              title={
                isRejected && revision.rejection_reason
                  ? `Motivo: ${revision.rejection_reason}`
                  : undefined
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 20,
                border: pillStyle.border,
                background: pillStyle.background,
                color: pillStyle.color,
                fontWeight: pillStyle.fontWeight,
                fontSize: 11,
                cursor: 'pointer',
                outline: 'none',
                transition: 'opacity 0.1s',
              }}
            >
              {isRejected && (
                <X size={10} style={{ flexShrink: 0 }} />
              )}
              {revision.is_current && !isRejected && (
                <span style={{ fontSize: 8, lineHeight: 1 }}>●</span>
              )}
              Rev. {revision.revision_number}
              {revision.is_current && !isRejected && ' (atual)'}
              {isRejected && ' — reprovada'}
            </button>
          );

          return pill;
        })}
      </div>

      {canCreateRevision && (
        <button
          onClick={onNewRevision}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            borderRadius: 7,
            border: 'none',
            background: '#1A1A1A',
            color: '#F5A800',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={12} />
          Nova Revisão
        </button>
      )}
    </div>
  );
}

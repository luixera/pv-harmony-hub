import { useState } from 'react';
import { Hash, Info, ShieldAlert, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export interface ProtocolData {
  protocol_number: string | null;
  no_protocol: boolean;
  no_protocol_reason: string | null;
}

interface ProtocolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCode: string;
  concessionaireName: string;
  currentRevisionNumber: number;
  /** Valor inicial para modo edição (opcional) */
  initialProtocolNumber?: string | null;
  onConfirm: (data: ProtocolData) => void;
  onCancel: () => void;
}

export function ProtocolDialog({
  open,
  onOpenChange,
  projectCode,
  concessionaireName,
  currentRevisionNumber,
  initialProtocolNumber,
  onConfirm,
  onCancel,
}: ProtocolDialogProps) {
  const [noProtocol, setNoProtocol] = useState(false);
  const [protocolNumber, setProtocolNumber] = useState(initialProtocolNumber ?? '');
  const [noProtocolReason, setNoProtocolReason] = useState('');

  if (!open) return null;

  const handleConfirm = () => {
    onConfirm({
      protocol_number: noProtocol ? null : (protocolNumber.trim() || null),
      no_protocol: noProtocol,
      no_protocol_reason: noProtocol ? (noProtocolReason.trim() || null) : null,
    });
  };

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(26,26,26,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={handleCancel}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          width: '100%',
          maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ background: '#1A1A1A', padding: '18px 20px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: '#E6F1FB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Hash size={18} color="#185FA5" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>
                Registrar Protocolo
              </p>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {projectCode}{concessionaireName ? ` — ${concessionaireName}` : ''} · Rev. {currentRevisionNumber}
              </p>
            </div>
            <button
              onClick={handleCancel}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, border: 'none', background: 'rgba(255,255,255,0.1)', cursor: 'pointer', flexShrink: 0 }}
            >
              <X size={14} color="rgba(255,255,255,0.7)" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Toggle sem protocolo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Switch
              checked={noProtocol}
              onCheckedChange={setNoProtocol}
            />
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#333', margin: 0 }}>
                Concessionária sem protocolo automático
              </p>
              <p style={{ fontSize: 11, color: '#888', margin: '2px 0 0' }}>
                Esta concessionária não gera número de protocolo (ex: ENEL)
              </p>
            </div>
          </div>

          {/* Campo número de protocolo */}
          {!noProtocol && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Número do protocolo
              </p>
              <input
                type="text"
                value={protocolNumber}
                onChange={e => setProtocolNumber(e.target.value)}
                placeholder="Ex: 7823456 ou 2026/001234"
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: 14,
                  borderRadius: 8,
                  border: '1.5px solid #E0E0E0',
                  outline: 'none',
                  color: '#1A1A1A',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#F5A800';
                  e.target.style.boxShadow = '0 0 0 3px rgba(245,168,0,0.15)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#E0E0E0';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          )}

          {/* Campo motivo (quando sem protocolo) */}
          {noProtocol && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Motivo / Observação <span style={{ fontWeight: 400 }}>(opcional)</span>
              </p>
              <input
                type="text"
                value={noProtocolReason}
                onChange={e => setNoProtocolReason(e.target.value)}
                placeholder="Ex: ENEL não gera protocolo automático — acompanhar pelo portal"
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: 13,
                  borderRadius: 8,
                  border: '1.5px solid #E0E0E0',
                  outline: 'none',
                  color: '#1A1A1A',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* Aviso informativo */}
          <div
            style={{
              background: '#FEF3D0',
              border: '0.5px solid #F5A800',
              borderRadius: 8,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <Info size={13} color="#854F0B" style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 10, color: '#854F0B', margin: 0, lineHeight: 1.5 }}>
              Este número ficará registrado no card do projeto e será atualizado a cada nova revisão ou reprotocolo.
            </p>
          </div>

          {/* Aviso se tentar confirmar sem preencher */}
          {!noProtocol && !protocolNumber.trim() && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={12} color="#EF4444" />
              <p style={{ fontSize: 11, color: '#EF4444', margin: 0 }}>
                Informe o número do protocolo ou marque a opção acima
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px 18px',
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            borderTop: '0.5px solid #F0F0F0',
          }}
        >
          <button
            onClick={handleCancel}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              border: '0.5px solid #E0E0E0',
              background: 'transparent',
              color: '#555',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!noProtocol && !protocolNumber.trim()}
            style={{
              padding: '9px 20px',
              borderRadius: 8,
              border: 'none',
              background: (!noProtocol && !protocolNumber.trim()) ? '#E0E0E0' : '#F5A800',
              color: (!noProtocol && !protocolNumber.trim()) ? '#999' : '#1A1A1A',
              fontWeight: 700,
              fontSize: 13,
              cursor: (!noProtocol && !protocolNumber.trim()) ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            Registrar e Avançar
          </button>
        </div>
      </div>
    </div>
  );
}

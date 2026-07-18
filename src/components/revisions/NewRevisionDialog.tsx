import { useState } from 'react';
import { X, Lock } from 'lucide-react';
import { ProjectRevision, useCreateRevision } from '@/hooks/useProjectRevisions';
import { ProjectWithDetails } from '@/hooks/useProjects';

interface NewRevisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectWithDetails;
  currentRevision: ProjectRevision | undefined;
  nextRevisionNumber: number;
}

export function NewRevisionDialog({
  open,
  onOpenChange,
  project,
  currentRevision,
  nextRevisionNumber,
}: NewRevisionDialogProps) {
  const createRevision = useCreateRevision();

  const gd = currentRevision?.general_data;
  const eq = currentRevision?.equipment;

  const [rejectionReason, setRejectionReason] = useState('');

  const originalEquipment = {
    inverter_brand: eq?.inverter_brand ?? project.equipment?.inverter_brand ?? '',
    inverter_model: eq?.inverter_model ?? project.equipment?.inverter_model ?? '',
    inverter_power: (eq?.inverter_power ?? project.equipment?.inverter_power ?? '').toString(),
    inverter_quantity: (eq?.inverter_quantity ?? project.equipment?.inverter_quantity ?? '').toString(),
    module_brand: eq?.module_brand ?? project.equipment?.module_brand ?? '',
    module_model: eq?.module_model ?? project.equipment?.module_model ?? '',
    module_power: (eq?.module_power ?? project.equipment?.module_power ?? '').toString(),
    module_quantity: (eq?.module_quantity ?? project.equipment?.module_quantity ?? '').toString(),
  };

  const [equipment, setEquipment] = useState({ ...originalEquipment });

  const isEquipmentChanged = (key: keyof typeof equipment) =>
    equipment[key] !== originalEquipment[key];

  const totalPower =
    (parseFloat(equipment.module_power || '0') *
      parseInt(equipment.module_quantity || '0', 10)) /
    1000;

  const holderData = {
    holder_name: gd?.holder_name ?? project.generalData?.holder_name ?? '',
    holder_cpf_cnpj: gd?.holder_cpf_cnpj ?? project.generalData?.holder_cpf_cnpj ?? '',
    holder_phone: gd?.holder_phone ?? project.generalData?.holder_phone ?? '',
    holder_email: gd?.holder_email ?? project.generalData?.holder_email ?? '',
    address: gd?.address ?? project.generalData?.address ?? '',
    address_number: gd?.address_number ?? project.generalData?.address_number ?? '',
    address_complement: gd?.address_complement ?? project.generalData?.address_complement ?? '',
    neighborhood: gd?.neighborhood ?? project.generalData?.neighborhood ?? '',
    city: gd?.city ?? project.generalData?.city ?? '',
    state: gd?.state ?? project.generalData?.state ?? '',
    uc_number: gd?.uc_number ?? project.generalData?.uc_number ?? '',
    circuit_breaker_current: gd?.circuit_breaker_current ?? project.generalData?.circuit_breaker_current ?? '',
    coordinates: gd?.coordinates ?? project.generalData?.coordinates ?? '',
    utility_company: gd?.utility_company ?? project.generalData?.utility_company ?? '',
    phase_type: gd?.phase_type ?? project.generalData?.phase_type ?? '',
    is_rural: gd?.is_rural ?? project.generalData?.is_rural ?? false,
    cep: gd?.cep ?? '',
  };

  const handleConfirm = async () => {
    if (!rejectionReason.trim()) return;

    await createRevision.mutateAsync({
      project_id: project.id,
      rejection_reason: rejectionReason.trim(),
      general_data: {
        holder_name: holderData.holder_name || null,
        holder_cpf_cnpj: holderData.holder_cpf_cnpj || null,
        holder_phone: holderData.holder_phone || null,
        holder_email: holderData.holder_email || null,
        address: holderData.address || null,
        address_number: holderData.address_number || null,
        address_complement: holderData.address_complement || null,
        neighborhood: holderData.neighborhood || null,
        city: holderData.city || null,
        state: holderData.state || null,
        cep: holderData.cep || null,
        uc_number: holderData.uc_number || null,
        utility_company: holderData.utility_company || null,
        circuit_breaker_current: holderData.circuit_breaker_current || null,
        phase_type: holderData.phase_type || null,
        coordinates: holderData.coordinates || null,
        is_rural: holderData.is_rural,
      },
      equipment: {
        inverter_brand: equipment.inverter_brand || null,
        inverter_model: equipment.inverter_model || null,
        inverter_power: parseFloat(equipment.inverter_power) || null,
        inverter_quantity: parseInt(equipment.inverter_quantity, 10) || null,
        module_brand: equipment.module_brand || null,
        module_model: equipment.module_model || null,
        module_power: parseFloat(equipment.module_power) || null,
        module_quantity: parseInt(equipment.module_quantity, 10) || null,
        total_installed_power: totalPower || null,
      },
    });

    onOpenChange(false);
  };

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #E0E0E0',
    fontSize: 12,
    color: '#1A1A1A',
    outline: 'none',
    background: '#fff',
    boxSizing: 'border-box',
  };

  const readonlyInputStyle: React.CSSProperties = {
    ...inputStyle,
    background: '#F8F8F8',
    color: '#888',
    cursor: 'not-allowed',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 3,
  };

  const SectionTitle = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{title}</p>
      {subtitle && (
        <p style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{subtitle}</p>
      )}
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(26,26,26,0.75)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
      onClick={e => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          width: '100%',
          maxWidth: 680,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
          margin: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ background: '#1A1A1A', padding: '18px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>
                Criar Revisão {nextRevisionNumber} — {project.code}
              </p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                Dados pré-preenchidos da revisão anterior. Altere apenas o que mudou.
              </p>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255,255,255,0.1)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: '70vh' }}>

          {/* Seção 1: Motivo da reprovação */}
          <div style={{ marginBottom: 24 }}>
            <SectionTitle title="Motivo da reprovação pela concessionária" />
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="Descreva o motivo informado pela concessionária..."
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
                minHeight: 80,
                fontFamily: 'inherit',
                lineHeight: 1.5,
                border: !rejectionReason.trim() ? '1px solid #E24B4A' : '1px solid #E0E0E0',
              }}
            />
            {!rejectionReason.trim() && (
              <p style={{ fontSize: 10, color: '#E24B4A', marginTop: 4 }}>
                Campo obrigatório
              </p>
            )}
          </div>

          {/* Seção 2: Dados do titular (somente leitura) */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <Lock size={12} style={{ color: '#aaa' }} />
              <p style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
                Dados do Titular — herdados da revisão anterior
              </p>
            </div>
            <div
              style={{
                background: '#F8F8F8',
                borderRadius: 8,
                padding: '14px 16px',
                border: '0.5px solid #EFEFEF',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '10px 14px',
                }}
              >
                {[
                  { label: 'Nome', value: holderData.holder_name },
                  { label: 'CPF / CNPJ', value: holderData.holder_cpf_cnpj },
                  { label: 'Telefone', value: holderData.holder_phone },
                  { label: 'E-mail', value: holderData.holder_email },
                  { label: 'Endereço', value: holderData.address },
                  { label: 'Cidade', value: holderData.city },
                  { label: 'UF', value: holderData.state },
                  { label: 'Nº UC', value: holderData.uc_number },
                  { label: 'Disjuntor (A)', value: holderData.circuit_breaker_current },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p style={labelStyle}>{label}</p>
                    <input
                      readOnly
                      value={value || '—'}
                      style={readonlyInputStyle}
                    />
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10, color: '#aaa', marginTop: 10 }}>
                Para alterar dados do titular, edite diretamente no projeto após criar a revisão.
              </p>
            </div>
          </div>

          {/* Seção 3: Equipamentos (editável) */}
          <div style={{ marginBottom: 8 }}>
            <SectionTitle
              title="Equipamentos — edite o que mudou"
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* Inversor */}
              <div
                style={{
                  background: '#F8F8F8',
                  borderRadius: 8,
                  padding: '14px 16px',
                  border: '0.5px solid #EFEFEF',
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 10 }}>
                  INVERSOR
                </p>
                {(
                  [
                    { key: 'inverter_brand', label: 'Marca' },
                    { key: 'inverter_model', label: 'Modelo' },
                    { key: 'inverter_power', label: 'Potência (kW)' },
                    { key: 'inverter_quantity', label: 'Quantidade' },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <p style={{ ...labelStyle, margin: 0 }}>{label}</p>
                      {isEquipmentChanged(key) && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 10,
                            background: '#FEF3D0',
                            color: '#854F0B',
                          }}
                        >
                          alterado
                        </span>
                      )}
                    </div>
                    <input
                      value={equipment[key]}
                      onChange={e =>
                        setEquipment(prev => ({ ...prev, [key]: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>

              {/* Módulos */}
              <div
                style={{
                  background: '#F8F8F8',
                  borderRadius: 8,
                  padding: '14px 16px',
                  border: '0.5px solid #EFEFEF',
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 10 }}>
                  MÓDULOS
                </p>
                {(
                  [
                    { key: 'module_brand', label: 'Marca' },
                    { key: 'module_model', label: 'Modelo' },
                    { key: 'module_power', label: 'Potência (Wp)' },
                    { key: 'module_quantity', label: 'Quantidade' },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <p style={{ ...labelStyle, margin: 0 }}>{label}</p>
                      {isEquipmentChanged(key) && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 10,
                            background: '#FEF3D0',
                            color: '#854F0B',
                          }}
                        >
                          alterado
                        </span>
                      )}
                    </div>
                    <input
                      value={equipment[key]}
                      onChange={e =>
                        setEquipment(prev => ({ ...prev, [key]: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            </div>

            {totalPower > 0 && (
              <div
                style={{
                  marginTop: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#FEF3D0',
                  borderRadius: 8,
                  padding: '8px 14px',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: '#854F0B' }}>
                  Potência total: {totalPower.toFixed(2)} kWp
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid #F0F0F0',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 10, color: '#aaa' }}>
            ✦ Campos alterados serão destacados vs revisão anterior
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onOpenChange(false)}
              style={{
                padding: '8px 16px',
                borderRadius: 7,
                border: '1px solid #E0E0E0',
                background: '#fff',
                color: '#555',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!rejectionReason.trim() || createRevision.isPending}
              style={{
                padding: '8px 18px',
                borderRadius: 7,
                border: 'none',
                background: rejectionReason.trim() ? '#F5A800' : '#E0E0E0',
                color: rejectionReason.trim() ? '#1A1A1A' : '#999',
                fontSize: 12,
                fontWeight: 700,
                cursor: rejectionReason.trim() ? 'pointer' : 'default',
              }}
            >
              {createRevision.isPending ? 'Criando...' : `Criar Revisão ${nextRevisionNumber}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

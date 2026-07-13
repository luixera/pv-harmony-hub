import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { useEquipmentCatalog, EquipmentType, EquipmentCatalogItem } from '@/hooks/useEquipmentCatalog';
import { EquipmentFormDialog } from './EquipmentFormDialog';
import { Plus, Check, FileText, FileCheck } from 'lucide-react';

interface Selection { brand: string; model: string; power: number | null; catalogId?: string | null }

interface Props {
  type: EquipmentType;
  /** valor atual do campo Modelo */
  value: string;
  /** digitação livre do modelo */
  onType: (model: string) => void;
  /** seleção de um item do catálogo → preenche marca/modelo/potência */
  onSelect: (sel: Selection) => void;
  placeholder?: string;
}

/**
 * Campo Modelo com autocomplete do catálogo compartilhado.
 * Ao selecionar um item, preenche marca/modelo/potência via onSelect.
 * Se o modelo digitado não existir, oferece "Cadastrar novo equipamento".
 */
export function EquipmentModelCombobox({ type, value, onType, onSelect, placeholder }: Props) {
  const { data: items = [] } = useEquipmentCatalog(type);
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = value.trim().toLowerCase();
  const matches = q
    ? items.filter(i => `${i.brand} ${i.model}`.toLowerCase().includes(q))
    : items;
  const exact = items.some(i => i.model.toLowerCase() === q && q !== '');

  const pick = (item: EquipmentCatalogItem) => {
    onSelect({ brand: item.brand, model: item.model, power: item.power, catalogId: item.id });
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Input
        value={value}
        onChange={e => { onType(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4,
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto',
        }}>
          {matches.slice(0, 20).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: '#1A1A1A', overflowWrap: 'anywhere' }}>
                  {item.brand} · {item.model}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                  {item.power != null ? `${item.power} ${type === 'inverter' ? 'kW' : 'Wp'}` : 'sem potência'}
                </div>
              </div>
              {/* indicadores de documentos */}
              <span title={item.datasheet_url ? 'Datasheet anexado' : 'Sem datasheet'} style={{ color: item.datasheet_url ? '#2D6A4F' : '#D1D5DB' }}><FileText size={13} /></span>
              <span title={item.inmetro_url ? 'INMETRO anexado' : 'Sem INMETRO'} style={{ color: item.inmetro_url ? '#2D6A4F' : '#D1D5DB' }}><FileCheck size={13} /></span>
              {value.toLowerCase() === item.model.toLowerCase() && <Check size={14} color="#F5A800" />}
            </button>
          ))}

          {matches.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#9CA3AF' }}>Nenhum modelo no catálogo</div>
          )}

          {/* Cadastrar novo — quando não há correspondência exata */}
          {!exact && (
            <button
              type="button"
              onClick={() => { setAddOpen(true); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '10px 12px', border: 'none', borderTop: '1px solid #F0F0F0',
                background: '#FFFBF0', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#854F0B',
              }}
            >
              <Plus size={15} /> Cadastrar {value.trim() ? `"${value.trim()}"` : 'novo equipamento'} no catálogo
            </button>
          )}
        </div>
      )}

      {addOpen && (
        <EquipmentFormDialog
          type={type}
          initialModel={value.trim()}
          onClose={() => setAddOpen(false)}
          onSaved={(item) => onSelect({ brand: item.brand, model: item.model, power: item.power, catalogId: item.id })}
        />
      )}
    </div>
  );
}

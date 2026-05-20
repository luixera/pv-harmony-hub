import { useState, useRef, useEffect } from 'react';
import { Building2, User, Zap, Clock, ChevronDown, Check, X } from 'lucide-react';

export interface MapFilterState {
  companyId: string | null;
  staffId: string | null;
  concessionaireId: string | null;
  status: string | null;
}

interface ChipOption {
  id: string;
  label: string;
}

interface MapFiltersProps {
  filters: MapFilterState;
  onChange: (filters: MapFilterState) => void;
  companies: ChipOption[];
  staffList: ChipOption[];
  concessionaires: ChipOption[];
  hideCompany?: boolean;
  hideStaff?: boolean;
}

const STATUS_OPTIONS: ChipOption[] = [
  { id: 'pending', label: 'Aguardando' },
  { id: 'analysis', label: 'Em Análise' },
  { id: 'documentation', label: 'Documentação' },
  { id: 'approval', label: 'Aprovação' },
  { id: 'approved', label: 'Aprovado' },
  { id: 'completed', label: 'Concluído' },
];

interface ChipProps {
  label: string;
  icon: React.ReactNode;
  selectedLabel?: string;
  options: ChipOption[];
  onSelect: (id: string | null) => void;
  selectedId: string | null;
}

function Chip({ label, icon, options, onSelect, selectedId }: ChipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = !!selectedId;
  const selectedOption = options.find(o => o.id === selectedId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 11px',
          borderRadius: 20,
          border: `0.5px solid ${isActive ? '#F5A800' : '#E0E0E0'}`,
          background: isActive ? '#FEF3D0' : '#F8F8F8',
          fontSize: 11,
          color: isActive ? '#854F0B' : '#555',
          fontWeight: 500,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'all 0.15s',
        }}
      >
        {isActive && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#F5A800', flexShrink: 0 }} />
        )}
        {icon}
        <span>{selectedOption ? selectedOption.label : label}</span>
        <ChevronDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          background: '#fff',
          borderRadius: 9,
          border: '0.5px solid #E0E0E0',
          boxShadow: '0 8px 20px rgba(0,0,0,0.10)',
          minWidth: 170,
          zIndex: 100,
          overflow: 'hidden',
        }}>
          {options.map(opt => {
            const isSelected = opt.id === selectedId;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  onSelect(isSelected ? null : opt.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 11,
                  color: isSelected ? '#854F0B' : '#333',
                  fontWeight: isSelected ? 500 : 400,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8F8F8')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={11} color="#F5A800" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MapFilters({ filters, onChange, companies, staffList, concessionaires, hideCompany = false, hideStaff = false }: MapFiltersProps) {
  const activeCount = [filters.companyId, filters.staffId, filters.concessionaireId, filters.status].filter(Boolean).length;

  const tags: { key: keyof MapFilterState; label: string; value: string }[] = [];
  if (filters.companyId) {
    const name = companies.find(c => c.id === filters.companyId)?.label || filters.companyId;
    tags.push({ key: 'companyId', label: 'Empresa', value: name });
  }
  if (filters.staffId) {
    const name = staffList.find(s => s.id === filters.staffId)?.label || filters.staffId;
    tags.push({ key: 'staffId', label: 'Projetista', value: name });
  }
  if (filters.concessionaireId) {
    const name = concessionaires.find(c => c.id === filters.concessionaireId)?.label || filters.concessionaireId;
    tags.push({ key: 'concessionaireId', label: 'Concessionária', value: name });
  }
  if (filters.status) {
    const name = STATUS_OPTIONS.find(s => s.id === filters.status)?.label || filters.status;
    tags.push({ key: 'status', label: 'Status', value: name });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Chips row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {!hideCompany && (
          <Chip
            label="Empresa"
            icon={<Building2 size={11} />}
            options={companies}
            selectedId={filters.companyId}
            onSelect={id => onChange({ ...filters, companyId: id })}
          />
        )}
        {!hideStaff && (
          <Chip
            label="Projetista"
            icon={<User size={11} />}
            options={staffList}
            selectedId={filters.staffId}
            onSelect={id => onChange({ ...filters, staffId: id })}
          />
        )}
        <Chip
          label="Concessionária"
          icon={<Zap size={11} />}
          options={concessionaires}
          selectedId={filters.concessionaireId}
          onSelect={id => onChange({ ...filters, concessionaireId: id })}
        />
        <Chip
          label="Status"
          icon={<Clock size={11} />}
          options={STATUS_OPTIONS}
          selectedId={filters.status}
          onSelect={id => onChange({ ...filters, status: id })}
        />
      </div>

      {/* Active tags row */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {tags.map(tag => (
            <span
              key={tag.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#FEF3D0',
                border: '0.5px solid #F5A800',
                borderRadius: 20,
                padding: '3px 8px',
                fontSize: 10,
                color: '#854F0B',
              }}
            >
              {tag.label}: {tag.value}
              <button
                onClick={() => onChange({ ...filters, [tag.key]: null })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#854F0B', padding: 0, lineHeight: 1, display: 'flex' }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            onClick={() => onChange({ companyId: null, staffId: null, concessionaireId: null, status: null })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 10, color: '#999', padding: '2px 4px',
            }}
          >
            <X size={9} /> Limpar tudo
          </button>
        </div>
      )}
    </div>
  );
}

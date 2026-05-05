import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, Filter, User, Zap, X, Check } from 'lucide-react'
import { ReportFilters } from '@/hooks/useReports'

interface FilterOption {
  id: string
  name: string
  count?: number
}

interface ReportFilterBarProps {
  filters: ReportFilters
  onFilterChange: (key: keyof ReportFilters, value: string | null) => void
  onClearFilter: (key: keyof ReportFilters) => void
  onClearAll: () => void
  totalFiltered: number
  totalGeral: number
  companies: FilterOption[]
  concessionaires: FilterOption[]
  staffList: FilterOption[]
}

interface ChipFilterProps {
  id: string
  label: string
  icon: React.ElementType
  options: FilterOption[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  openDropdown: string | null
  setOpenDropdown: (id: string | null) => void
}

function ChipFilter({
  id,
  label,
  icon: Icon,
  options,
  selectedId,
  onSelect,
  openDropdown,
  setOpenDropdown,
}: ChipFilterProps) {
  const isOpen = openDropdown === id
  const isActive = !!selectedId
  const selectedOption = options.find((o) => o.id === selectedId)

  return (
    <div className="chip-filter-wrap" style={{ position: 'relative' }}>
      <button
        onClick={() => setOpenDropdown(isOpen ? null : id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 20,
          border: `0.5px solid ${isActive ? '#F5A800' : '#E0E0E0'}`,
          background: isActive ? '#FEF3D0' : '#F8F8F8',
          fontSize: 11,
          fontWeight: 500,
          color: isActive ? '#854F0B' : '#555',
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {isActive && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#F5A800',
              flexShrink: 0,
            }}
          />
        )}
        <Icon size={12} />
        <span>{isActive ? selectedOption?.name || label : label}</span>
        <ChevronDown size={11} style={{ opacity: 0.5 }} />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            background: '#fff',
            borderRadius: 10,
            border: '0.5px solid #E0E0E0',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            minWidth: 220,
            zIndex: 100,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '0.5px solid #F5F5F5',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: '#333' }}>{label}</span>
            {selectedId && (
              <button
                onClick={() => { onSelect(null); setOpenDropdown(null) }}
                style={{ fontSize: 11, color: '#F5A800', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                Limpar
              </button>
            )}
          </div>

          {/* Options */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {options.length === 0 ? (
              <div style={{ padding: '12px', fontSize: 11, color: '#aaa', textAlign: 'center' }}>
                Nenhuma opção
              </div>
            ) : (
              options.map((opt) => {
                const isSel = selectedId === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => { onSelect(isSel ? null : opt.id); setOpenDropdown(null) }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      width: '100%',
                      background: isSel ? '#FFFBF0' : 'transparent',
                      border: 'none',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = '#F8F8F8' }}
                    onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Checkbox */}
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: `1.5px solid ${isSel ? '#F5A800' : '#E0E0E0'}`,
                        background: isSel ? '#F5A800' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isSel && <Check size={10} color="#fff" strokeWidth={3} />}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: isSel ? '#1A1A1A' : '#333',
                        fontWeight: isSel ? 600 : 400,
                        flex: 1,
                      }}
                    >
                      {opt.name}
                    </span>
                    {opt.count !== undefined && (
                      <span style={{ fontSize: 9, color: '#aaa', marginLeft: 'auto' }}>{opt.count}</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ReportFilterBar({
  filters,
  onFilterChange,
  onClearFilter,
  onClearAll,
  totalFiltered,
  totalGeral,
  companies,
  concessionaires,
  staffList,
}: ReportFilterBarProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.chip-filter-wrap')) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const activeFilters: { key: keyof ReportFilters; label: string; value: string }[] = []
  if (filters.companyId) {
    const name = companies.find((c) => c.id === filters.companyId)?.name || 'Empresa'
    activeFilters.push({ key: 'companyId', label: 'Empresa', value: name })
  }
  if (filters.concessionaireId) {
    const name = concessionaires.find((c) => c.id === filters.concessionaireId)?.name || 'Concessionária'
    activeFilters.push({ key: 'concessionaireId', label: 'Concessionária', value: name })
  }
  if (filters.staffId) {
    const name = staffList.find((s) => s.id === filters.staffId)?.name || 'Projetista'
    activeFilters.push({ key: 'staffId', label: 'Projetista', value: name })
  }

  return (
    <div
      ref={barRef}
      className="filter-bar-hide-print"
      style={{
        background: '#fff',
        borderRadius: 12,
        border: '0.5px solid #E8E8E8',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        marginBottom: 14,
      }}
    >
      {/* Filter icon */}
      <div
        style={{
          width: 32,
          height: 32,
          background: '#F5F5F5',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Filter size={14} color="#888" />
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}
      >
        Filtrar:
      </span>

      {/* Divider */}
      <div style={{ width: '0.5px', height: 24, background: '#EBEBEB', flexShrink: 0 }} />

      {/* Chip: Empresa */}
      <ChipFilter
        id="company"
        label="Empresa"
        icon={Building2}
        options={companies}
        selectedId={filters.companyId}
        onSelect={(v) => onFilterChange('companyId', v)}
        openDropdown={openDropdown}
        setOpenDropdown={setOpenDropdown}
      />

      {/* Divider */}
      <div style={{ width: '0.5px', height: 24, background: '#EBEBEB', flexShrink: 0 }} />

      {/* Chip: Concessionária */}
      <ChipFilter
        id="concessionaire"
        label="Concessionária"
        icon={Zap}
        options={concessionaires}
        selectedId={filters.concessionaireId}
        onSelect={(v) => onFilterChange('concessionaireId', v)}
        openDropdown={openDropdown}
        setOpenDropdown={setOpenDropdown}
      />

      {/* Divider */}
      <div style={{ width: '0.5px', height: 24, background: '#EBEBEB', flexShrink: 0 }} />

      {/* Chip: Projetista */}
      <ChipFilter
        id="staff"
        label="Projetista"
        icon={User}
        options={staffList}
        selectedId={filters.staffId}
        onSelect={(v) => onFilterChange('staffId', v)}
        openDropdown={openDropdown}
        setOpenDropdown={setOpenDropdown}
      />

      {/* Active tags */}
      {activeFilters.length > 0 && (
        <>
          <div style={{ width: '0.5px', height: 24, background: '#EBEBEB', flexShrink: 0 }} />
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {activeFilters.map((af) => (
              <span
                key={af.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  background: '#FEF3D0',
                  border: '0.5px solid #F5A800',
                  borderRadius: 20,
                  fontSize: 10,
                  color: '#854F0B',
                  fontWeight: 500,
                }}
              >
                {af.label}: {af.value}
                <button
                  onClick={() => onClearFilter(af.key)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#854F0B', display: 'flex' }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            <button
              onClick={onClearAll}
              style={{
                fontSize: 10,
                color: '#aaa',
                padding: '3px 8px',
                borderRadius: 20,
                border: '0.5px solid #E0E0E0',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              Limpar tudo
            </button>
          </div>
        </>
      )}

      {/* Counter */}
      <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
        <span
          style={{
            background: '#F0F0F0',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 11,
            display: 'inline-flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          Exibindo{' '}
          <strong style={{ fontWeight: 700, color: '#1A1A1A' }}>{totalFiltered}</strong>{' '}
          <span style={{ color: '#aaa' }}>de {totalGeral} projetos</span>
        </span>
      </div>
    </div>
  )
}

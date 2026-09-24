import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useEquipmentCatalog, EquipmentType } from '@/hooks/useEquipmentCatalog';
import { Check, ChevronDown } from 'lucide-react';
import { filtrarMarcas, marcasDoCatalogo } from './catalogoFiltros';

interface Props {
  type: EquipmentType;
  /** marca atual do formulário */
  value: string;
  /** escolheu uma marca da lista (ou digitou livre) */
  onChange: (brand: string) => void;
  /**
   * Trocou para OUTRA marca do catálogo: quem usa aprova a limpeza do modelo
   * (e da potência), porque o modelo antigo é de outro fabricante.
   */
  onTrocarMarca?: (brand: string) => void;
  placeholder?: string;
}

/**
 * Campo Marca como LISTA do catálogo compartilhado (pedido do usuário,
 * set/2026): escolhida a marca, o campo Modelo ao lado passa a mostrar só os
 * modelos dela — é o par condicional marca → modelo.
 *
 * Continua aceitando digitação livre: o catálogo não é exaustivo e um projeto
 * não pode travar porque a marca ainda não foi cadastrada. A lista filtra pelo
 * que se digita e mostra quantos modelos cada marca tem.
 */
export function EquipmentBrandCombobox({ type, value, onChange, onTrocarMarca, placeholder }: Props) {
  const { data: items = [] } = useEquipmentCatalog(type);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  /** Marcas distintas do catálogo, com quantos modelos cada uma tem. */
  const marcas = useMemo(() => marcasDoCatalogo(items), [items]);

  const q = value.trim().toLowerCase();
  const filtradas = filtrarMarcas(marcas, value);
  const exata = marcas.some(m => m.nome.toLowerCase() === q && q !== '');

  const escolher = (nome: string) => {
    const mudou = nome.trim().toLowerCase() !== value.trim().toLowerCase();
    onChange(nome);
    if (mudou) onTrocarMarca?.(nome);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Escolher no catálogo ou digitar…'}
        autoComplete="off"
        style={{ paddingRight: 28 }}
      />
      <ChevronDown
        size={14}
        onClick={() => setOpen(o => !o)}
        style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', cursor: 'pointer' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4,
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto',
        }}>
          {filtradas.slice(0, 40).map(m => (
            <button
              key={m.nome}
              type="button"
              onClick={() => escolher(m.nome)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: '#1A1A1A', overflowWrap: 'anywhere' }}>{m.nome}</span>
              <span style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                {m.modelos} modelo{m.modelos > 1 ? 's' : ''}
              </span>
              {value.trim().toLowerCase() === m.nome.toLowerCase() && <Check size={14} color="#F5A800" />}
            </button>
          ))}

          {filtradas.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#9CA3AF' }}>
              {marcas.length === 0 ? 'Nenhuma marca no catálogo ainda' : 'Nenhuma marca do catálogo com esse texto'}
            </div>
          )}

          {/* O catálogo não é exaustivo: marca nova não pode travar o projeto. */}
          {!exata && value.trim() !== '' && (
            <div style={{
              padding: '9px 12px', borderTop: '1px solid #F0F0F0', background: '#FFFBF0',
              fontSize: 12, color: '#854F0B',
            }}>
              Usando <strong>{value.trim()}</strong>, que não está no catálogo — o modelo pode ser digitado à mão.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, History, Loader2, Search, SlidersHorizontal,
} from 'lucide-react';
import {
  EngineeringRuleRow, RuleHistoryEntry, useEngineeringRules, useRuleHistory, useUpdateEngineeringRule,
} from '@/hooks/useEngineeringRules';

/**
 * Tela "Regras de Engenharia" — aba do Motor de Templates. Centraliza TODAS
 * as regras de dimensionamento simplificado do GD Manager, organizadas em
 * grupos (cards recolhíveis), com busca, filtro por fonte, edição inline e
 * histórico de alterações. Nenhum valor fica fixo em código: o Rules Engine
 * lê daqui.
 *
 * Feita pra quem tem POUCO conhecimento de engenharia: rótulos e descrições
 * em português simples, e a fonte (NBR/fabricante/interna) sempre à vista.
 */

/** Nome e descrição amigáveis de cada grupo (as regras em si vêm do banco). */
const GROUPS: Record<string, { name: string; description: string }> = {
  strings: { name: 'Strings Fotovoltaicas', description: 'Como montar as strings: módulos por string, MPPTs, faixas de tensão e equilíbrio.' },
  inverter_distribution: { name: 'Distribuição entre Inversores', description: 'Como dividir módulos/strings/potência quando há mais de um inversor.' },
  arrays: { name: 'Arranjos Fotovoltaicos', description: 'Topologias do arranjo (tudo num inversor, dividido, por MPPT).' },
  microinverters: { name: 'Microinversores', description: 'Limites por ramal e por circuito (cadastro completo chega na Fase 3).' },
  dcac: { name: 'Relação DC/AC', description: 'Sobredimensionamento do arranjo em relação ao inversor: mínimo, ideal e máximo.' },
  voltage_drop: { name: 'Queda de Tensão', description: 'Limites de queda CC e CA — alimentam o memorial (Fase 2).' },
  cables: { name: 'Cabos', description: 'Bitolas mínimas, material, fatores de correção — alimentam o memorial (Fase 2).' },
  protections: { name: 'Proteções', description: 'Critérios de disjuntores, DPS, DR, fusíveis e seccionadoras (seleção automática na Fase 2).' },
  grounding: { name: 'Aterramento', description: 'Condutor mínimo, cor e interligações obrigatórias.' },
  norms: { name: 'Normas', description: 'Referências normativas que justificam as regras (NBR 16690, 5410, 5419...).' },
  alerts: { name: 'Alertas', description: 'Avisos do motor — nunca bloqueiam, sempre sugerem correção.' },
  suggestions: { name: 'Sugestões Inteligentes', description: 'Quantas alternativas o motor apresenta e como.' },
};
const GROUP_ORDER = Object.keys(GROUPS);

const SOURCE_COLORS: Record<string, string> = {
  'NBR 16690': '#1D4ED8', 'NBR 5410': '#1D4ED8', 'NBR 5419': '#1D4ED8',
  'Manual do fabricante': '#7C3AED', 'Regra interna': '#B45309',
};

export function EngineeringRulesTab() {
  const { data: rules = [], isLoading } = useEngineeringRules();
  const updateRule = useUpdateEngineeringRule();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['strings', 'dcac']));
  const [historyFor, setHistoryFor] = useState<EngineeringRuleRow | null>(null);

  const sources = useMemo(() => [...new Set(rules.map(r => r.source))].sort(), [rules]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter(r =>
      (!sourceFilter || r.source === sourceFilter)
      && (!q || r.label.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
        || (GROUPS[r.groupKey]?.name ?? r.groupKey).toLowerCase().includes(q)),
    );
  }, [rules, search, sourceFilter]);

  const byGroup = useMemo(() => {
    const map = new Map<string, EngineeringRuleRow[]>();
    for (const r of filtered) {
      if (!map.has(r.groupKey)) map.set(r.groupKey, []);
      map.get(r.groupKey)!.push(r);
    }
    return map;
  }, [filtered]);

  const toggleGroup = (key: string) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  if (isLoading) {
    return <div style={{ padding: 60, textAlign: 'center' }}><Loader2 size={22} className="animate-spin" style={{ color: '#F5A800' }} /></div>;
  }

  return (
    <div>
      {/* explicação + busca + filtro */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, background: '#EAF3FF',
        border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', marginBottom: 14, flexWrap: 'wrap',
      }}>
        <SlidersHorizontal size={15} style={{ color: '#1D4ED8', flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: '#1D4ED8', margin: 0, flex: 1, minWidth: 260 }}>
          <strong>Estas regras comandam o motor de engenharia.</strong> O sistema usa os valores daqui
          pra sugerir strings, dividir inversores e emitir alertas — nada fica fixo em código. Regra
          desabilitada = o motor usa o comportamento neutro e não avisa sobre ela.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#999' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar regra (ex.: DC/AC, bitola, string...)"
            style={{ width: '100%', padding: '7px 10px 7px 30px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 12.5, boxSizing: 'border-box' }}
          />
        </div>
        <select
          value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 12.5, background: '#fff' }}
        >
          <option value="">Todas as fontes</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* cards por grupo */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {GROUP_ORDER.filter(g => byGroup.has(g)).map(groupKey => {
          const groupRules = byGroup.get(groupKey)!;
          const info = GROUPS[groupKey] ?? { name: groupKey, description: '' };
          const enabledCount = groupRules.filter(r => r.enabled).length;
          const open = openGroups.has(groupKey) || !!search.trim();
          return (
            <div key={groupKey} style={{ background: '#fff', border: '1px solid #E8E8E8', borderRadius: 12 }}>
              <button
                onClick={() => toggleGroup(groupKey)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                {open ? <ChevronDown size={15} style={{ color: '#999' }} /> : <ChevronRight size={15} style={{ color: '#999' }} />}
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1A1A', margin: 0 }}>{info.name}</p>
                  <p style={{ fontSize: 11.5, color: '#888', margin: 0 }}>{info.description}</p>
                </div>
                <span style={{ fontSize: 11, color: enabledCount > 0 ? '#2D7A3A' : '#999', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {enabledCount}/{groupRules.length} ativa(s)
                </span>
              </button>
              {open && (
                <div style={{ borderTop: '1px solid #F0F0F0', padding: '4px 16px 12px' }}>
                  {groupRules.map(rule => (
                    <RuleRowEditor
                      key={rule.id}
                      rule={rule}
                      onSave={fields => updateRule.mutate({ id: rule.id, ...fields })}
                      onHistory={() => setHistoryFor(rule)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: 30 }}>Nenhuma regra encontrada com esse filtro.</p>
        )}
      </div>

      {historyFor && <HistoryDialog rule={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

// ── Linha editável de uma regra ──────────────────────────────────────────────
function RuleRowEditor({ rule, onSave, onHistory }: {
  rule: EngineeringRuleRow;
  onSave: (fields: { enabled?: boolean; value_default?: number | null; value_min?: number | null; value_max?: number | null; notes?: string | null }) => void;
  onHistory: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [vDefault, setVDefault] = useState(rule.valueDefault?.toString() ?? '');
  const [vMin, setVMin] = useState(rule.valueMin?.toString() ?? '');
  const [vMax, setVMax] = useState(rule.valueMax?.toString() ?? '');
  const [notes, setNotes] = useState(rule.notes ?? '');

  const num = (s: string): number | null => {
    const v = Number(s.replace(',', '.'));
    return s.trim() === '' || !Number.isFinite(v) ? null : v;
  };
  const save = () => {
    onSave({ value_default: num(vDefault), value_min: num(vMin), value_max: num(vMax), notes: notes.trim() || null });
    setEditing(false);
  };

  const sourceColor = SOURCE_COLORS[rule.source] ?? '#666';
  const isInformational = rule.valueDefault === null && rule.valueMin === null && rule.valueMax === null;

  return (
    <div style={{ borderBottom: '1px solid #F5F5F5', padding: '9px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }} title={rule.enabled ? 'Regra ativa' : 'Regra desativada'}>
          <input type="checkbox" checked={rule.enabled} onChange={e => onSave({ enabled: e.target.checked })} />
        </label>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: rule.enabled ? '#1A1A1A' : '#999', margin: 0 }}>{rule.label}</p>
          {rule.description && <p style={{ fontSize: 11, color: '#999', margin: 0 }}>{rule.description}</p>}
        </div>
        {!isInformational && (
          <span style={{ fontSize: 12, color: rule.enabled ? '#333' : '#bbb', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {rule.valueDefault ?? '—'}{rule.unit ? ` ${rule.unit}` : ''}
            {(rule.valueMin !== null || rule.valueMax !== null) && (
              <span style={{ fontWeight: 400, color: '#999' }}> ({rule.valueMin ?? '−∞'} a {rule.valueMax ?? '+∞'})</span>
            )}
          </span>
        )}
        <span style={{ fontSize: 10, fontWeight: 700, color: sourceColor, border: `1px solid ${sourceColor}33`, background: `${sourceColor}11`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
          {rule.source}
        </span>
        <button onClick={() => setEditing(o => !o)} style={{ border: 'none', background: 'none', color: '#2B8CFF', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
          {editing ? 'Fechar' : 'Editar'}
        </button>
        <button onClick={onHistory} title="Histórico de alterações" style={{ border: 'none', background: 'none', color: '#999', cursor: 'pointer', display: 'flex' }}>
          <History size={13} />
        </button>
      </div>
      {editing && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8, background: '#FAFAFA', borderRadius: 8, padding: 10 }}>
          {!isInformational && ([
            ['Valor padrão', vDefault, setVDefault],
            ['Mínimo', vMin, setVMin],
            ['Máximo', vMax, setVMax],
          ] as const).map(([label, value, setter]) => (
            <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#777', fontWeight: 600 }}>
              {label}{rule.unit ? ` (${rule.unit})` : ''}
              <input value={value} onChange={e => setter(e.target.value)} style={{ width: 90, padding: '6px 8px', borderRadius: 7, border: '1px solid #DDD', fontSize: 12, fontWeight: 400 }} />
            </label>
          ))}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#777', fontWeight: 600, flex: 1, minWidth: 180 }}>
            Observações
            <input value={notes} onChange={e => setNotes(e.target.value)} style={{ padding: '6px 8px', borderRadius: 7, border: '1px solid #DDD', fontSize: 12, fontWeight: 400 }} />
          </label>
          <button onClick={save} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#F5A800', color: '#1A1A1A', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Salvar
          </button>
        </div>
      )}
    </div>
  );
}

// ── Histórico de uma regra ───────────────────────────────────────────────────
function HistoryDialog({ rule, onClose }: { rule: EngineeringRuleRow; onClose: () => void }) {
  const { data: entries = [], isLoading } = useRuleHistory(rule.id);
  const fmt = (v: Record<string, unknown> | null) => {
    if (!v) return '—';
    return ['value_default', 'value_min', 'value_max', 'enabled', 'notes']
      .filter(k => v[k] !== undefined && v[k] !== null && v[k] !== '')
      .map(k => `${k.replace('value_', '')}: ${String(v[k])}`)
      .join(' · ') || '—';
  };
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 70 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 71,
        background: '#fff', borderRadius: 14, padding: 20, width: 'min(560px, 92vw)', maxHeight: '70vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <BookOpen size={15} style={{ color: '#F5A800' }} />
          <p style={{ fontSize: 14, fontWeight: 700, margin: 0, flex: 1 }}>Histórico — {rule.label}</p>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 13, color: '#999', cursor: 'pointer' }}>Fechar</button>
        </div>
        {isLoading && <p style={{ fontSize: 12, color: '#999' }}>Carregando…</p>}
        {!isLoading && entries.length === 0 && <p style={{ fontSize: 12, color: '#999' }}>Nenhuma alteração registrada ainda — esta regra está com os valores originais.</p>}
        {(entries as RuleHistoryEntry[]).map(h => (
          <div key={h.id} style={{ borderBottom: '1px solid #F0F0F0', padding: '8px 0', fontSize: 12 }}>
            <p style={{ margin: 0, color: '#888', fontSize: 11 }}>{new Date(h.changed_at).toLocaleString('pt-BR')}</p>
            <p style={{ margin: '2px 0 0' }}><span style={{ color: '#A32D2D' }}>Antes:</span> {fmt(h.old_values)}</p>
            <p style={{ margin: '2px 0 0' }}><span style={{ color: '#2D7A3A' }}>Depois:</span> {fmt(h.new_values)}</p>
          </div>
        ))}
      </div>
    </>
  );
}

import { ProjectRevision, RevisionEquipment, RevisionGeneralData } from '@/hooks/useProjectRevisions';

export interface FieldDiff {
  field: string;
  label: string;
  from: string | number | null;
  to: string | number | null;
}

export interface RevisionDiff {
  equipment: FieldDiff[];
  generalData: FieldDiff[];
  hasChanges: boolean;
  totalChanges: number;
}

const EQUIP_FIELDS: Array<{ key: keyof RevisionEquipment; label: string }> = [
  { key: 'inverter_brand',        label: 'Inversor — Marca' },
  { key: 'inverter_model',        label: 'Inversor — Modelo' },
  { key: 'inverter_power',        label: 'Inversor — Potência (kW)' },
  { key: 'inverter_quantity',     label: 'Inversor — Quantidade' },
  { key: 'module_brand',          label: 'Módulos — Marca' },
  { key: 'module_model',          label: 'Módulos — Modelo' },
  { key: 'module_power',          label: 'Módulos — Potência (Wp)' },
  { key: 'module_quantity',       label: 'Módulos — Quantidade' },
  { key: 'total_installed_power', label: 'Potência Total (kWp)' },
];

// Only string | null fields to avoid boolean type mismatch
type GeneralStringKey = 'circuit_breaker_current' | 'phase_type' | 'uc_number' | 'utility_company';

const GENERAL_FIELDS: Array<{ key: GeneralStringKey; label: string }> = [
  { key: 'circuit_breaker_current', label: 'Disjuntor (A)' },
  { key: 'phase_type',              label: 'Tipo de Fase' },
  { key: 'uc_number',               label: 'Número UC' },
  { key: 'utility_company',         label: 'Concessionária' },
];

export function computeRevisionDiff(
  prev: ProjectRevision,
  curr: ProjectRevision,
): RevisionDiff {
  const equipDiffs: FieldDiff[] = [];
  const generalDiffs: FieldDiff[] = [];

  const pe = prev.equipment;
  const ce = curr.equipment;
  const pg = prev.general_data;
  const cg = curr.general_data;

  EQUIP_FIELDS.forEach(({ key, label }) => {
    const fromVal = (pe?.[key] ?? null) as string | number | null;
    const toVal   = (ce?.[key] ?? null) as string | number | null;
    if (String(fromVal) !== String(toVal)) {
      equipDiffs.push({ field: key, label, from: fromVal, to: toVal });
    }
  });

  GENERAL_FIELDS.forEach(({ key, label }) => {
    const fromVal = (pg?.[key] ?? null) as string | null;
    const toVal   = (cg?.[key] ?? null) as string | null;
    if (String(fromVal) !== String(toVal)) {
      generalDiffs.push({ field: key, label, from: fromVal, to: toVal });
    }
  });

  const totalChanges = equipDiffs.length + generalDiffs.length;

  return {
    equipment: equipDiffs,
    generalData: generalDiffs,
    hasChanges: totalChanges > 0,
    totalChanges,
  };
}

export function formatDiffValue(
  value: string | number | null,
  field: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field.includes('power') && !field.includes('total')) {
    return `${value} ${field.includes('module') ? 'Wp' : 'kW'}`;
  }
  if (field === 'total_installed_power') {
    return `${value} kWp`;
  }
  return String(value);
}

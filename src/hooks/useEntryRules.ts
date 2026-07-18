import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/** Regra de padrão de entrada de uma concessionária (uma categoria = uma linha). */
export interface EntryRule {
  id: string;
  tenant_id: string | null;
  concessionaire_id: string;
  categoria: string;
  num_fases: number | null;
  bitola: string | null;
  disjuntor: number;
  classe: string | null;
  caixa_medicao: string | null;
  sort_order: number;
  /** Valores das colunas customizadas: { "Rótulo": "valor" }. */
  extra: Record<string, string>;
}

export type EntryRuleDraft = Omit<EntryRule, 'id' | 'tenant_id'> & { id?: string };

/** Transforma um rótulo de coluna em chave de variável: "Ramal de Entrada" → "ramal_de_entrada". */
export function slugifyColumn(label: string): string {
  return label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function useEntryRules(concessionaireId: string | undefined) {
  return useQuery({
    queryKey: ['entry-rules', concessionaireId],
    queryFn: async (): Promise<EntryRule[]> => {
      if (!concessionaireId) return [];
      const { data, error } = await supabase
        .from('concessionaire_entry_rules' as never)
        .select('*')
        .eq('concessionaire_id', concessionaireId)
        .order('sort_order', { ascending: true })
        .order('disjuntor', { ascending: true });
      if (error) throw error;
      return (data ?? []) as EntryRule[];
    },
    enabled: !!concessionaireId,
  });
}

/** Salva o conjunto completo de regras de uma concessionária (upsert + remoção). */
export function useSaveEntryRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      concessionaireId,
      rules,
      deletedIds,
    }: {
      concessionaireId: string;
      rules: EntryRuleDraft[];
      deletedIds: string[];
    }) => {
      if (deletedIds.length > 0) {
        const { error } = await supabase
          .from('concessionaire_entry_rules' as never)
          .delete()
          .in('id', deletedIds);
        if (error) throw error;
      }
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const row = {
          concessionaire_id: concessionaireId,
          categoria: r.categoria.trim(),
          num_fases: r.num_fases,
          bitola: r.bitola?.trim() || null,
          disjuntor: r.disjuntor,
          classe: r.classe?.trim() || null,
          caixa_medicao: r.caixa_medicao?.trim() || null,
          sort_order: i,
          extra: r.extra ?? {},
        };
        if (r.id) {
          const { error } = await supabase
            .from('concessionaire_entry_rules' as never)
            .update(row as never)
            .eq('id', r.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('concessionaire_entry_rules' as never)
            .insert(row as never);
          if (error) throw error;
        }
      }
    },
    onSuccess: (_, { concessionaireId }) => {
      qc.invalidateQueries({ queryKey: ['entry-rules', concessionaireId] });
      toast.success('Regras de padrão de entrada salvas');
    },
    onError: (e) => {
      console.error(e);
      toast.error('Erro ao salvar regras');
    },
  });
}

/** Busca direta (fora do React Query) — usada na geração de documentos. */
export async function fetchEntryRules(concessionaireId: string): Promise<EntryRule[]> {
  const { data, error } = await supabase
    .from('concessionaire_entry_rules' as never)
    .select('*')
    .eq('concessionaire_id', concessionaireId)
    .order('disjuntor', { ascending: true });
  if (error) {
    console.error('[entryRules] erro ao buscar regras', error);
    return [];
  }
  return (data ?? []) as EntryRule[];
}

/** Normaliza texto para comparação (minúsculas, sem acentos). */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Nº de fases implícito no phase_type do projeto (1/2/3, ou null). */
function phasesFromType(phaseType: string | null | undefined): number | null {
  const p = norm(phaseType);
  if (p.includes('tri')) return 3;
  if (p.includes('bi')) return 2;
  if (p.includes('mono')) return 1;
  return null;
}

/**
 * Encontra a categoria do padrão de entrada para um projeto:
 * filtra pela classe (fase) e escolhe a menor categoria cujo disjuntor
 * comporta o disjuntor do projeto (>=). Sem match exato → maior disponível.
 */
export function matchEntryRule(
  rules: EntryRule[],
  phaseType: string | null | undefined,
  breakerCurrent: string | null | undefined,
): EntryRule | null {
  if (rules.length === 0) return null;

  const amps = parseInt((breakerCurrent ?? '').replace(/[^\d]/g, ''), 10);
  const phases = phasesFromType(phaseType);

  // 1) filtra pela classe/fases quando conhecida
  let candidates = rules;
  if (phases != null) {
    const byClass = rules.filter(r =>
      (r.num_fases != null && r.num_fases === phases) ||
      phasesFromType(r.classe) === phases
    );
    if (byClass.length > 0) candidates = byClass;
  }

  const sorted = [...candidates].sort((a, b) => a.disjuntor - b.disjuntor);
  if (isNaN(amps)) return sorted[0] ?? null;

  // 2) menor disjuntor que comporta o do projeto
  const fit = sorted.find(r => r.disjuntor >= amps);
  return fit ?? sorted[sorted.length - 1] ?? null;
}

/** Converte a regra encontrada nas variáveis de template do padrão de entrada. */
export function entryRuleValues(rule: EntryRule | null): Record<string, string> {
  const values: Record<string, string> = {
    categoria_padrao:  rule?.categoria ?? '',
    num_fases_padrao:  rule?.num_fases != null ? String(rule.num_fases) : '',
    bitola_cabo:       rule?.bitola ? `${rule.bitola} mm²` : '',
    disjuntor_padrao:  rule ? `${rule.disjuntor}A` : '',
    classe_padrao:     rule?.classe ?? '',
    caixa_medicao:     rule?.caixa_medicao ?? '',
  };
  // Colunas customizadas viram variáveis pelo rótulo slugificado ({ramal} etc.)
  for (const [label, val] of Object.entries(rule?.extra ?? {})) {
    const key = slugifyColumn(label);
    if (key) values[key] = val ?? '';
  }
  return values;
}

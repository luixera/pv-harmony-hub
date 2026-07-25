import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EngineeringRule, buildRuleMap, RuleMap } from '@/utils/engineering/rulesEngine';

/**
 * Regras de engenharia (`engineering_rules`) — a fonte ÚNICA dos valores que
 * o Rules Engine aplica. Editáveis na tela "Regras de Engenharia" (Motor de
 * Templates); toda alteração vira uma linha de histórico via trigger no
 * banco (`engineering_rule_history`), sem código extra aqui.
 *
 * A tabela ainda não está nos types gerados do Supabase — os casts `as never`
 * seguem o mesmo padrão já usado no console (`ConsoleSections.tsx`).
 */

interface RuleRow {
  id: string;
  group_key: string;
  rule_key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  value_default: number | null;
  value_min: number | null;
  value_max: number | null;
  unit: string | null;
  priority: number;
  source: string;
  notes: string | null;
  updated_at: string;
}

export interface EngineeringRuleRow extends EngineeringRule {
  id: string;
  description: string | null;
  updatedAt: string;
}

function fromRow(r: RuleRow): EngineeringRuleRow {
  return {
    id: r.id,
    groupKey: r.group_key,
    ruleKey: r.rule_key,
    label: r.label,
    description: r.description,
    enabled: r.enabled,
    valueDefault: r.value_default === null ? null : Number(r.value_default),
    valueMin: r.value_min === null ? null : Number(r.value_min),
    valueMax: r.value_max === null ? null : Number(r.value_max),
    unit: r.unit,
    priority: r.priority,
    source: r.source,
    notes: r.notes,
    updatedAt: r.updated_at,
  };
}

export function useEngineeringRules() {
  return useQuery({
    queryKey: ['engineering-rules'],
    queryFn: async (): Promise<EngineeringRuleRow[]> => {
      const { data, error } = await supabase
        .from('engineering_rules' as never)
        .select('*')
        .order('group_key')
        .order('priority', { ascending: false })
        .order('label');
      if (error) throw error;
      return ((data ?? []) as unknown as RuleRow[]).map(fromRow);
    },
    staleTime: 60_000,
  });
}

/** Mapa pronto pro motor consumir (`grupo.chave` → regra). */
export function useEngineeringRuleMap(): { ruleMap: RuleMap; isLoading: boolean } {
  const { data = [], isLoading } = useEngineeringRules();
  return { ruleMap: buildRuleMap(data), isLoading };
}

export interface RuleUpdate {
  id: string;
  enabled?: boolean;
  value_default?: number | null;
  value_min?: number | null;
  value_max?: number | null;
  priority?: number;
  source?: string;
  notes?: string | null;
}

export function useUpdateEngineeringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: RuleUpdate) => {
      const { error } = await supabase
        .from('engineering_rules' as never)
        .update(fields as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engineering-rules'] });
      toast.success('Regra atualizada');
    },
    onError: (e: Error) => toast.error(e.message || 'Erro ao salvar a regra'),
  });
}

export interface RuleHistoryEntry {
  id: string;
  changed_at: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

export function useRuleHistory(ruleId: string | null) {
  return useQuery({
    queryKey: ['engineering-rule-history', ruleId],
    enabled: !!ruleId,
    queryFn: async (): Promise<RuleHistoryEntry[]> => {
      const { data, error } = await supabase
        .from('engineering_rule_history' as never)
        .select('id, changed_at, old_values, new_values')
        .eq('rule_id', ruleId!)
        .order('changed_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as RuleHistoryEntry[];
    },
  });
}

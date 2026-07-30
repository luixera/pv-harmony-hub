import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Assinatura mensal (empresas com `pricing_type = 'monthly'`).
 *
 * Regra combinada com o usuário (jul/2026): a empresa paga a MENSALIDADE uma
 * vez por mês e, em cada projeto, só a RT. Passando da franquia de projetos do
 * mês, o projeto vale RT + excedente.
 *
 * - a mensalidade é uma cobrança de verdade (`company_subscription_charges`),
 *   com vencimento e status de pagamento — aparece no financeiro e no extrato
 *   junto dos projetos;
 * - o valor da RT é ÚNICO do tenant (`tenants.art_value`), ajustado pela RPC
 *   `set_tenant_art_value` (a tabela `tenants` só é editável pelo master).
 *
 * As tabelas/RPCs são novas e não estão nos tipos gerados do Supabase — daí os
 * casts `as never`, mesmo padrão do resto do projeto.
 */

const DASHBOARD_KEY = ['financial-dashboard'] as const;
const ART_KEY = ['tenant-art-value'] as const;

/** Valor da RT cobrado por projeto nas empresas com assinatura. */
export function useArtValue() {
  return useQuery({
    queryKey: ART_KEY,
    queryFn: async (): Promise<number | null> => {
      // o RLS já devolve só o tenant do usuário; `art_value` é coluna nova,
      // fora dos tipos gerados
      const { data, error } = await supabase
        .from('tenants' as never)
        .select('art_value')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const v = (data as { art_value?: number | string } | null)?.art_value;
      return v == null ? null : Number(v);
    },
  });
}

export function useSaveArtValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: number | null) => {
      const { error } = await supabase.rpc('set_tenant_art_value' as never, { _value: value } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ART_KEY });
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
    },
  });
}

/** Gera as mensalidades que faltam (idempotente) e devolve quantas criou. */
export function useGenerateSubscriptionCharges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('ensure_subscription_charges' as never, {} as never);
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  });
}

/** Quita (total) ou estorna a mensalidade de um mês. */
export function useSettleSubscriptionCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, amount, action }: { id: string; amount: number; action: 'settle' | 'reverse' }) => {
      const paid = action === 'settle' ? amount : 0;
      const { error } = await supabase
        .from('company_subscription_charges' as never)
        .update({ amount_paid: paid, status: action === 'settle' ? 'paid' : 'pending' } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  });
}

/**
 * Extrato da assinatura visto pela PRÓPRIA empresa cliente (e também pelo
 * admin, passando `companyId`). Vem da RPC `company_subscription_statement`,
 * que já devolve o consumo da franquia — a tabela guarda o LIMITE do plano em
 * `projects_included`, não quantos projetos foram usados.
 *
 * Sem cobrança gerada no mês, a lista vem vazia: nada é inventado na tela.
 */
export interface SubscriptionStatementRow {
  id: string;
  competence: string;
  amount: number;
  amount_paid: number;
  status: string;
  due_date: string | null;
  project_limit: number | null;
  projects_count: number;
  excess_count: number;
  excess_value: number;
}

export function useCompanySubscriptionStatement(companyId?: string | null) {
  return useQuery({
    queryKey: ['company-subscription-statement', companyId ?? 'own'],
    queryFn: async (): Promise<SubscriptionStatementRow[]> => {
      const { data, error } = await supabase.rpc(
        'company_subscription_statement' as never,
        { _company_id: companyId ?? null } as never,
      );
      if (error) throw error;
      return ((data ?? []) as unknown as SubscriptionStatementRow[]).map(r => ({
        ...r,
        amount: Number(r.amount),
        amount_paid: Number(r.amount_paid),
        projects_count: Number(r.projects_count),
        excess_count: Number(r.excess_count),
        excess_value: Number(r.excess_value),
      }));
    },
  });
}

/** Reaplica a RT nos projetos de assinatura que ficaram com valor zerado. */
export function useRecomputeSubscriptionValues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (companyId?: string): Promise<number> => {
      const { data, error } = await supabase.rpc(
        'recompute_subscription_project_values' as never,
        { _company_id: companyId ?? null } as never,
      );
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  });
}

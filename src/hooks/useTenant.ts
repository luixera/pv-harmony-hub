import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface TenantPlan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  max_projects_per_month: number | null;
  max_users: number | null;
  ai_analyses_per_month: number;
  features: Record<string, boolean>;
  is_active: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  cnpj: string | null;
  logo_url: string | null;
  plan_id: string | null;
  status: 'trial' | 'active' | 'suspended' | 'canceled';
  trial_ends_at: string | null;
  paid_until: string | null;
  notes: string | null;
  created_at: string;
  /** Tenant "biblioteca" — origem das cópias de concessionárias/pacotes pros
   *  demais tenants (ver useConcessionaireLibrary.ts). Hoje é só a GD Manager
   *  — reaproveitado também para restringir o motor de templates de diagrama
   *  (ver useDiagramEngineAccess.ts) enquanto não libera pra todos os tenants. */
  is_library: boolean;
  plan?: TenantPlan;
}

/** Tenant do usuário logado, com o plano embutido. */
export function useTenant() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['tenant', user?.tenantId],
    queryFn: async (): Promise<Tenant | null> => {
      if (!user?.tenantId) return null;
      const { data, error } = await supabase
        .from('tenants' as never)
        .select('*, plan:plans(*)')
        .eq('id', user.tenantId)
        .maybeSingle();
      if (error) throw error;
      return data as Tenant | null;
    },
    enabled: !!user?.tenantId,
    staleTime: 1000 * 60 * 5,
  });
}

/** Motivo de bloqueio do tenant, ou null se o acesso está liberado. */
export function tenantBlockReason(t: Tenant | null | undefined): 'suspended' | 'canceled' | 'expired' | 'trial_ended' | null {
  if (!t) return null;
  if (t.status === 'suspended') return 'suspended';
  if (t.status === 'canceled') return 'canceled';
  if (t.status === 'active' && t.paid_until && new Date(t.paid_until + 'T23:59:59') < new Date()) return 'expired';
  if (t.status === 'trial' && (!t.trial_ends_at || new Date(t.trial_ends_at) < new Date())) return 'trial_ended';
  return null;
}

/** Flags de recursos do plano do tenant (default: tudo liberado se não carregado). */
export function useTenantFeatures(): Record<string, boolean> {
  const { data: tenant } = useTenant();
  return tenant?.plan?.features ?? { claudinho: true, email_agent: true, map: true, reports: true };
}

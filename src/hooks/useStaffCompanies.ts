import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Vínculo PROJETISTA ↔ EMPRESAS.
 *
 * O projetista com acesso "apenas atribuídos" enxerga os projetos atribuídos a
 * ele **mais** os das empresas ligadas a ele — inclusive os projetos que
 * chegarem depois, que era exatamente a dor: não ter que atribuir um a um
 * (pedido do usuário, ago/2026).
 *
 * `staff_companies` é tabela nova, fora dos tipos gerados do Supabase → casts
 * `as never`, padrão do projeto.
 *
 * **Tolerante a falha de leitura**: se a consulta falhar (tabela ainda não
 * criada no ambiente, RLS negando), devolve lista vazia em vez de estourar. Sem
 * vínculo o comportamento é idêntico ao de hoje, então uma falha aqui nunca
 * ABRE acesso — no máximo mantém o que já existia.
 */

export interface StaffCompanyLink {
  id: string;
  staff_user_id: string;
  company_id: string;
}

const CHAVE = ['staff-companies'] as const;

async function buscarVinculos(staffUserId?: string | null): Promise<StaffCompanyLink[]> {
  if (!staffUserId) return [];
  const { data, error } = await supabase
    .from('staff_companies' as never)
    .select('id, staff_user_id, company_id')
    .eq('staff_user_id', staffUserId);
  if (error) {
    console.warn('staff_companies indisponível:', error.message);
    return [];
  }
  return (data ?? []) as unknown as StaffCompanyLink[];
}

/** Empresas ligadas a um projetista (tela de usuários, visão do admin). */
export function useStaffCompanies(staffUserId?: string | null) {
  return useQuery({
    queryKey: [...CHAVE, staffUserId ?? 'nenhum'],
    queryFn: () => buscarVinculos(staffUserId),
    enabled: !!staffUserId,
  });
}

/** Empresas do projetista LOGADO — usado pra filtrar projetos e a criação. */
export function useMinhasEmpresasDeStaff() {
  const { user } = useAuth();
  const ehStaffRestrito = user?.role === 'staff' && user?.staffAccessMode === 'assigned_only';
  return useQuery({
    queryKey: [...CHAVE, 'minhas', user?.id ?? 'anon'],
    queryFn: () => buscarVinculos(user?.id),
    enabled: !!user?.id && ehStaffRestrito,
    // o vínculo muda pouco, mas quando muda o projetista precisa ver na hora
    refetchOnMount: 'always',
  });
}

/** Substitui a lista de empresas de um projetista pela informada. */
export function useSaveStaffCompanies() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ staffUserId, companyIds }: { staffUserId: string; companyIds: string[] }) => {
      const atuais = await buscarVinculos(staffUserId);
      const atuaisIds = new Set(atuais.map(v => v.company_id));
      const novosIds = new Set(companyIds);

      const remover = atuais.filter(v => !novosIds.has(v.company_id)).map(v => v.id);
      const inserir = companyIds.filter(id => !atuaisIds.has(id));

      if (remover.length > 0) {
        const { error } = await supabase.from('staff_companies' as never).delete().in('id', remover);
        if (error) throw error;
      }
      if (inserir.length > 0) {
        // `tenant_id` vai explícito: o gatilho que o preencheria pode não estar
        // no ambiente, e aí o insert quebrava com "null value in column
        // tenant_id violates not-null" (ago/2026). O admin e o projetista são
        // sempre do mesmo tenant, e o gatilho de conferência no banco garante
        // que a empresa também é.
        const { error } = await supabase.from('staff_companies' as never)
          .insert(inserir.map(company_id => ({
            staff_user_id: staffUserId,
            company_id,
            tenant_id: user?.tenantId ?? null,
          })) as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAVE });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

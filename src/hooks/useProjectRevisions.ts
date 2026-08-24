import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { toProjectStatus } from '@/lib/statusMapping';

export interface RevisionGeneralData {
  id: string;
  revision_id: string;
  holder_name: string | null;
  holder_cpf_cnpj: string | null;
  holder_phone: string | null;
  holder_email: string | null;
  address: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  uc_number: string | null;
  utility_company: string | null;
  circuit_breaker_current: string | null;
  phase_type: string | null;
  coordinates: string | null;
  is_rural: boolean;
}

export interface RevisionEquipment {
  id: string;
  revision_id: string;
  inverter_brand: string | null;
  inverter_model: string | null;
  inverter_power: number | null;
  inverter_quantity: number | null;
  module_brand: string | null;
  module_model: string | null;
  module_power: number | null;
  module_quantity: number | null;
  total_installed_power: number | null;
}

export interface ProjectRevision {
  id: string;
  project_id: string;
  revision_number: number;
  status: string;
  is_current: boolean;
  rejection_reason: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  general_data?: RevisionGeneralData;
  equipment?: RevisionEquipment;
}

export interface CreateRevisionPayload {
  project_id: string;
  rejection_reason: string;
  general_data: Partial<Omit<RevisionGeneralData, 'id' | 'revision_id'>>;
  equipment: Partial<Omit<RevisionEquipment, 'id' | 'revision_id'>>;
}

// Returns false to stop retrying when the table doesn't exist yet (migration pending)
function shouldRetry(failureCount: number, error: any): boolean {
  if (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    error?.message?.includes('schema cache') ||
    error?.message?.includes('does not exist')
  ) {
    return false;
  }
  return failureCount < 2;
}

// ── Lightweight summary (only revision_number + is_current, no heavy joins) ──
// Used by RevisionBadge on kanban cards: avoids firing N heavy queries on mount.
export interface RevisionSummary {
  id: string;
  revision_number: number;
  is_current: boolean;
}

export function useProjectRevisionSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-revision-summary', projectId],
    queryFn: async (): Promise<RevisionSummary[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_revisions')
        .select('id, revision_number, is_current')
        .eq('project_id', projectId)
        .order('revision_number', { ascending: true });
      if (error) throw error;
      return (data || []) as RevisionSummary[];
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useProjectRevisions(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-revisions', projectId],
    queryFn: async (): Promise<ProjectRevision[]> => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from('project_revisions')
        .select(`
          *,
          general_data:revision_general_data(*),
          equipment:revision_equipment(*)
        `)
        .eq('project_id', projectId)
        .order('revision_number', { ascending: true });

      if (error) throw error;

      return (data || []).map(row => ({
        ...row,
        general_data: Array.isArray(row.general_data)
          ? row.general_data[0]
          : row.general_data,
        equipment: Array.isArray(row.equipment)
          ? row.equipment[0]
          : row.equipment,
      })) as ProjectRevision[];
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // cache for 5 min — explicit invalidation still works
    retry: shouldRetry,
    retryDelay: 1000,
  });
}

export function useCurrentRevision(projectId: string | undefined) {
  return useQuery({
    queryKey: ['current-revision', projectId],
    queryFn: async (): Promise<ProjectRevision | null> => {
      if (!projectId) return null;

      const { data, error } = await supabase
        .from('project_revisions')
        .select(`
          *,
          general_data:revision_general_data(*),
          equipment:revision_equipment(*)
        `)
        .eq('project_id', projectId)
        .eq('is_current', true)
        .maybeSingle();

      if (error) return null;
      if (!data) return null;

      return {
        ...data,
        general_data: Array.isArray(data.general_data)
          ? data.general_data[0]
          : data.general_data,
        equipment: Array.isArray(data.equipment)
          ? data.equipment[0]
          : data.equipment,
      } as ProjectRevision;
    },
    enabled: !!projectId,
    retry: shouldRetry,
    retryDelay: 1000,
  });
}

export function useCreateRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateRevisionPayload) => {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Buscar última revisão para obter número
      const { data: lastRevision } = await supabase
        .from('project_revisions')
        .select('revision_number')
        .eq('project_id', payload.project_id)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextNumber = (lastRevision?.revision_number || 0) + 1;

      // 2. Marcar revisão atual como não-atual
      await supabase
        .from('project_revisions')
        .update({ is_current: false })
        .eq('project_id', payload.project_id)
        .eq('is_current', true);

      // 3. Atualizar motivo de reprovação na revisão anterior
      const { data: prevRevision } = await supabase
        .from('project_revisions')
        .select('id')
        .eq('project_id', payload.project_id)
        .eq('revision_number', nextNumber - 1)
        .maybeSingle();

      if (prevRevision) {
        await supabase
          .from('project_revisions')
          .update({
            rejection_reason: payload.rejection_reason,
            status: 'rejected',
            rejected_at: new Date().toISOString(),
          })
          .eq('id', prevRevision.id);
      }

      // 4. Buscar status_key da coluna de reprovação e atualizar projeto
      const { data: rejCol } = await supabase
        .from('kanban_columns')
        .select('status_key, status_label')
        .eq('is_rejection_stage', true)
        .limit(1)
        .maybeSingle();

      if (rejCol?.status_key) {
        const safeStatus = toProjectStatus(rejCol.status_key);
        if (safeStatus) {
          const { error: statusError } = await supabase
            .from('projects')
            .update({ status: safeStatus })
            .eq('id', payload.project_id);

          if (statusError) {
            console.warn('Aviso: não foi possível atualizar status:', statusError);
            // NÃO lançar erro — a revisão já foi criada com sucesso, status é secundário
          }
        }
      }

      // 5. Criar nova revisão
      const { data: newRevision, error: revError } = await supabase
        .from('project_revisions')
        .insert({
          project_id: payload.project_id,
          revision_number: nextNumber,
          status: 'pending',
          is_current: true,
          created_by: user?.id ?? null,
        })
        .select()
        .single();

      if (revError) throw revError;

      // 6/7. A revisão guarda o estado ANTERIOR; a base recebe o NOVO.
      //
      // Antes era o contrário: os valores digitados no formulário iam para a
      // revisão e `project_equipment` nunca era tocado. Resultado: a base
      // ficava defasada e o diagrama/formulários saíam com o equipamento
      // velho, mesmo depois da revisão trocar tudo (relato do usuário,
      // ago/2026 — PRJ-45053).
      //
      // Regra do negócio: o projeto sempre tem o equipamento VIGENTE na base;
      // a revisão é o registro do que existia antes dela.
      const limpar = (linha: Record<string, unknown> | null | undefined) => {
        if (!linha) return null;
        const { id: _id, project_id: _p, created_at: _c, updated_at: _u, ...resto } = linha;
        return resto;
      };

      const [{ data: baseGeral }, { data: baseEquip }] = await Promise.all([
        supabase.from('project_general_data').select('*').eq('project_id', payload.project_id).maybeSingle(),
        supabase.from('project_equipment').select('*').eq('project_id', payload.project_id).maybeSingle(),
      ]);

      const geralAnterior = limpar(baseGeral as Record<string, unknown> | null);
      if (geralAnterior) {
        await supabase.from('revision_general_data')
          .insert({ revision_id: newRevision.id, ...geralAnterior } as never);
      }
      const equipAnterior = limpar(baseEquip as Record<string, unknown> | null);
      if (equipAnterior) {
        await supabase.from('revision_equipment')
          .insert({ revision_id: newRevision.id, ...equipAnterior } as never);
      }

      // ...e o que foi digitado na revisão passa a ser o vigente do projeto
      if (payload.general_data && Object.keys(payload.general_data).length > 0) {
        await supabase.from('project_general_data')
          .update(payload.general_data as never)
          .eq('project_id', payload.project_id);
      }
      if (payload.equipment && Object.keys(payload.equipment).length > 0) {
        await supabase.from('project_equipment')
          .update(payload.equipment as never)
          .eq('project_id', payload.project_id);
      }

      // 8. Registrar no histórico do projeto (não-crítico — não falha a operação)
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user?.id ?? '')
          .maybeSingle();

        await supabase
          .from('project_history')
          .insert({
            project_id: payload.project_id,
            action: 'Revisão criada',
            description: `Revisão ${nextNumber} criada. Motivo: ${payload.rejection_reason}`,
            user_id: user?.id ?? null,
            user_name: profile?.name ?? user?.email ?? null,
          });
      } catch {
        // histórico é não-crítico
      }

      // 9. Inserir comentário automático (não-crítico)
      if (user) {
        try {
          await supabase
            .from('comments')
            .insert({
              project_id: payload.project_id,
              message: `🔄 Revisão ${nextNumber} criada. Motivo da reprovação: ${payload.rejection_reason}`,
              type: 'revision',
              user_id: user.id,
            });
        } catch {
          // comentário é não-crítico
        }
      }

      return { revision: newRevision };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['project-revisions', variables.project_id] });
      queryClient.invalidateQueries({ queryKey: ['current-revision', variables.project_id] });
      queryClient.invalidateQueries({ queryKey: ['project', variables.project_id] });
      queryClient.invalidateQueries({ queryKey: ['comments', variables.project_id] });
      queryClient.invalidateQueries({ queryKey: ['project-history', variables.project_id] });
      toast.success('Revisão criada com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao criar revisão');
    },
  });
}

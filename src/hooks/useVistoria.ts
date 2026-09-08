import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Solicitação de vistoria feita pela EMPRESA integradora.
 *
 * Quem decide tudo é o servidor (`solicitar_vistoria`, SECURITY DEFINER): a
 * empresa não tem permissão para criar tarefa para outra pessoa, e não deveria
 * ter. A função confere a etapa, confere que o projeto é dela, impede pedido
 * repetido, cria a tarefa para o admin e para o projetista responsável, avisa
 * os dois e registra em comentários e histórico.
 *
 * `vistoria_status` existe porque a empresa não enxerga as tarefas dos outros:
 * sem ele, o front não teria como saber que já há um pedido em aberto.
 */

export interface VistoriaStatus {
  permitido: boolean;
  /** Projeto está na etapa Aprovado? */
  etapa_ok?: boolean;
  status?: string;
  /** Já existe pedido em aberto? */
  aberta?: boolean;
  em?: string | null;
}

export function useVistoriaStatus(projectId: string | undefined, habilitado = true) {
  return useQuery({
    queryKey: ['vistoria-status', projectId],
    queryFn: async (): Promise<VistoriaStatus> => {
      if (!projectId) return { permitido: false };
      const { data, error } = await supabase
        .rpc('vistoria_status' as never, { _project_id: projectId } as never);
      if (error) throw error;
      return (data ?? { permitido: false }) as VistoriaStatus;
    },
    enabled: !!projectId && habilitado,
    staleTime: 30_000,
  });
}

/**
 * Projetos com pedido de vistoria EM ABERTO — uma consulta para o quadro
 * inteiro, não uma por card (o quadro já teve esse problema: 194 requisições
 * para uma tabela minúscula, set/2026).
 *
 * Quem vê o quê sai do próprio RLS de `tasks`: o admin enxerga todas, e o
 * projetista só as que criou ou que lhe foram atribuídas. Ou seja, o destaque
 * aparece para o admin e para o projetista responsável — decisão do usuário.
 * Por isso não há função no banco aqui: a permissão que já existe basta.
 */
export function useVistoriasPendentes() {
  return useQuery({
    queryKey: ['vistorias-pendentes'],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('tasks' as never)
        .select('project_id')
        .eq('origin', 'vistoria_request')
        .in('status', ['pending', 'in_progress']);
      if (error) throw error;
      const ids = new Set<string>();
      for (const t of (data ?? []) as { project_id: string | null }[]) {
        if (t.project_id) ids.add(t.project_id);
      }
      return ids;
    },
    staleTime: 60_000,
  });
}

export function useSolicitarVistoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data, error } = await supabase
        .rpc('solicitar_vistoria' as never, { _project_id: projectId } as never);
      if (error) throw error;
      return data as { ok: boolean; motivo?: string; tarefas?: number; status?: string };
    },
    onSuccess: (r, projectId) => {
      qc.invalidateQueries({ queryKey: ['vistoria-status', projectId] });
      // o quadro destaca os projetos com pedido em aberto
      qc.invalidateQueries({ queryKey: ['vistorias-pendentes'] });
      qc.invalidateQueries({ queryKey: ['tasks'], exact: false });
      qc.invalidateQueries({ queryKey: ['comments', projectId] });
      qc.invalidateQueries({ queryKey: ['project-history', projectId] });

      if (r?.ok) {
        toast.success(
          r.tarefas && r.tarefas > 1
            ? 'Vistoria solicitada! A equipe foi avisada.'
            : 'Vistoria solicitada! O responsável foi avisado.',
        );
        return;
      }
      // O servidor recusou — cada motivo merece uma frase que se entenda.
      const recados: Record<string, string> = {
        ja_solicitada: 'Já existe uma solicitação de vistoria em aberto para este projeto.',
        etapa_invalida: 'A vistoria só pode ser solicitada com o projeto na etapa Aprovado.',
        sem_permissao: 'Este projeto não pertence à sua empresa.',
        projeto_nao_encontrado: 'Projeto não encontrado.',
        sem_sessao: 'Faça login novamente para solicitar a vistoria.',
      };
      toast.error(recados[r?.motivo ?? ''] ?? 'Não foi possível solicitar a vistoria.');
    },
    onError: (e) => {
      console.error('[vistoria] falha ao solicitar', e);
      toast.error('Não foi possível solicitar a vistoria.');
    },
  });
}

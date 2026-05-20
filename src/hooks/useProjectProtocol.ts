import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProjectProtocol {
  id: string;
  project_id: string;
  revision_number: number;
  protocol_number: string | null;
  no_protocol: boolean;
  no_protocol_reason: string | null;
  registered_by: string | null;
  registered_at: string;
  registrar?: { name: string | null } | null;
}

export function useProjectProtocols(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-protocols', projectId],
    queryFn: async (): Promise<ProjectProtocol[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_protocols' as any)
        .select(`
          *,
          registrar:profiles!registered_by(name)
        `)
        .eq('project_id', projectId)
        .order('registered_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ProjectProtocol[];
    },
    enabled: !!projectId,
  });
}

export function useRegisterProtocol() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      revisionNumber,
      protocolNumber,
      noProtocol,
      noProtocolReason,
      newStatus,
    }: {
      projectId: string;
      revisionNumber: number;
      protocolNumber: string | null;
      noProtocol: boolean;
      noProtocolReason: string | null;
      newStatus: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      // Valor a exibir no card
      const displayNumber = noProtocol
        ? (noProtocolReason?.trim() || 'Sem protocolo')
        : (protocolNumber?.trim() || null);

      // 1. Atualizar project: protocol_number + status
      const { error: projError } = await supabase
        .from('projects')
        .update({ protocol_number: displayNumber, status: newStatus as any })
        .eq('id', projectId);
      if (projError) throw projError;

      // 2. Inserir no histórico
      const { error: histError } = await supabase
        .from('project_protocols' as any)
        .insert({
          project_id: projectId,
          revision_number: revisionNumber,
          protocol_number: noProtocol ? null : (protocolNumber?.trim() || null),
          no_protocol: noProtocol,
          no_protocol_reason: noProtocolReason?.trim() || null,
          registered_by: user?.id ?? null,
        });
      if (histError) throw histError;

      // 3. Comentário automático (não-crítico)
      if (user) {
        try {
          const msg = noProtocol
            ? `Protocolo sem número registrado: ${noProtocolReason || 'sem motivo informado'}`
            : `Protocolo registrado: ${protocolNumber}`;
          await supabase.from('comments').insert({
            project_id: projectId,
            message: `📋 ${msg}`,
            type: 'protocol',
            user_id: user.id,
          });
        } catch { /* comentário é não-crítico */ }
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['projects'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['project', vars.projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-protocols', vars.projectId] });
      queryClient.invalidateQueries({ queryKey: ['comments', vars.projectId] });
      toast.success('Protocolo registrado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao registrar protocolo. Tente novamente.');
    },
  });
}

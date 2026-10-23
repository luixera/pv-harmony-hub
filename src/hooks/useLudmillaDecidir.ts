import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  useAplicarUpdate, useIgnorarUpdate, useLudmillaDisponivel, type MensagemEmail,
} from '@/hooks/useLudmilla';
import type { Afazer, SituacaoDoFiltro } from '@/lib/ludmillaCaixa';
import type {
  AnexoDoPortal, EventoDoProjeto, ParecerDoPortal, ProjetoDaCriacao, ProjetoDoDetalhe,
} from '@/lib/ludmillaPainel';

/**
 * O QUE A PÁGINA NOVA DA LUDMILLA LÊ ALÉM DO QUE JÁ LIA (spec 2026-10-22 §4).
 * As recomendações continuam vindo de `usePortalUpdates` (useLudmilla.ts); aqui
 * moram o A fazer, o "Feito" e o que o painel de detalhe precisa. Tudo passa pela
 * RLS de quem lê. Os selects são constantes para a verificação contra o PostgREST.
 */

export const SELECT_AFAZER =
  '*, project:projects(id, code, status, title, companies:company_id(name), project_general_data(holder_name)), feito:feito_por(name)';
export const SELECT_MENSAGEM = '*';
export const SELECT_PROJETO_DO_DETALHE = 'id, code, status, protocol_number, project_general_data(uc_number)';
export const SELECT_ANEXOS_DO_PROJETO =
  'id, protocolo, nome_arquivo, situacao, motivo, enviado_em, created_at, document:documents(file_url, file_name)';
export const SELECT_PARECERES_DO_PROJETO = 'id, protocolo, data, analise, status, created_at';
export const SELECT_PROJETO_DA_CRIACAO = 'id, code, cpfl_node_id';

/** URL assinada de 5 min para abrir um documento do card (bucket privado). */
export async function urlDoDocumento(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(caminho, 300);
  if (error) return null;
  return data.signedUrl;
}

/** O A fazer da equipe. "Aplicadas" = os feitos; "Ignoradas" não existe para A fazer. */
export function useAfazeres(situacao: SituacaoDoFiltro) {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['portal-afazeres', situacao],
    queryFn: async (): Promise<Afazer[]> => {
      if (situacao === 'ignorada') return [];
      let q = supabase
        .from('portal_afazeres' as never)
        .select(SELECT_AFAZER)
        .order('criado_em', { ascending: false })
        .limit(200);
      if (situacao === 'pendente') q = q.is('feito_em', null);
      if (situacao === 'aplicada') q = q.not('feito_em', 'is', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Afazer[];
    },
    enabled: disponivel,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** "Marcar como feito": vale para a equipe toda. `false` = alguém já tinha marcado. */
export function useMarcarAfazerFeito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const { data, error } = await supabase.rpc('ludmilla_afazer_feito' as never, { p_afazer_id: id } as never);
      if (error) throw error;
      return data as unknown as boolean;
    },
    onSuccess: marcou => {
      qc.invalidateQueries({ queryKey: ['portal-afazeres'], exact: false });
      qc.invalidateQueries({ queryKey: ['ludmilla-linha-do-tempo'], exact: false });
      if (!marcou) toast.info('Alguém da equipe já tinha marcado como feito.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * As três decisões da caixa (Aplicar, Ignorar, Feito) como a página as chama. Cada uma
 * ESPERA a mutação (`mutateAsync` REJEITA na falha: é assim que a fila de decisões
 * sabe que o banco recusou) e só então atualiza o que o painel de detalhe mostra.
 * Aplicar e Ignorar (useLudmilla.ts) só invalidam `portal-updates` e `projects`; sem
 * isto a "linha do tempo" e o "Quem" (UC/protocolo) do projeto ficavam com o que
 * havia antes da decisão. A atualização não é esperada: a decisão já está gravada.
 */
export function useAcoesDaCaixa() {
  const qc = useQueryClient();
  const { mutateAsync: aplicarAsync } = useAplicarUpdate();
  const { mutateAsync: ignorarAsync } = useIgnorarUpdate();
  const { mutateAsync: feitoAsync } = useMarcarAfazerFeito();

  return useMemo(() => {
    const atualizarDetalhe = () => {
      void qc.invalidateQueries({ queryKey: ['ludmilla-linha-do-tempo'] });
      void qc.invalidateQueries({ queryKey: ['projeto-do-detalhe'] });
    };
    return {
      aplicar: async (id: string, etapa: string | null): Promise<void> => {
        await aplicarAsync({ id, status: etapa ?? undefined });
        atualizarDetalhe();
      },
      ignorar: async (id: string): Promise<void> => {
        await ignorarAsync(id);
        atualizarDetalhe();
      },
      /** `false` = alguém da equipe já tinha marcado (o aviso já saiu em `useMarcarAfazerFeito`) */
      feito: async (id: string): Promise<boolean> => {
        const marcou = await feitoAsync(id);
        atualizarDetalhe();
        return marcou;
      },
    };
  }, [qc, aplicarAsync, ignorarAsync, feitoAsync]);
}

/** "Este projeto na Ludmilla". */
export function useLinhaDoTempo(projectId: string | null) {
  const disponivel = useLudmillaDisponivel();
  return useQuery({
    queryKey: ['ludmilla-linha-do-tempo', projectId],
    queryFn: async (): Promise<EventoDoProjeto[]> => {
      const { data, error } = await supabase.rpc('ludmilla_linha_do_tempo' as never, {
        p_project_id: projectId, p_limite: 60,
      } as never);
      if (error) throw error;
      return (data ?? []) as EventoDoProjeto[];
    },
    enabled: disponivel && !!projectId,
    staleTime: 30_000,
  });
}

/** A mensagem de e-mail que abriu o cartão (assunto, remetente, veredito, data). */
export function useMensagemDaRecomendacao(updateId: string | null) {
  return useQuery({
    queryKey: ['mensagem-da-recomendacao', updateId],
    queryFn: async (): Promise<MensagemEmail | null> => {
      const { data, error } = await supabase
        .from('portal_email_mensagens' as never)
        .select(SELECT_MENSAGEM)
        .eq('update_id', updateId as string)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as unknown as MensagemEmail[])[0] ?? null;
    },
    enabled: !!updateId,
    staleTime: 60_000,
  });
}

/** UC e protocolo do cadastro, para o "Quem". */
export function useProjetoDoDetalhe(projectId: string | null) {
  return useQuery({
    queryKey: ['projeto-do-detalhe', projectId],
    queryFn: async (): Promise<ProjetoDoDetalhe | null> => {
      const { data, error } = await supabase
        .from('projects' as never)
        .select(SELECT_PROJETO_DO_DETALHE)
        .eq('id', projectId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ProjetoDoDetalhe | null) ?? null;
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/** Anexos e pareceres que a Ludmilla levou a este projeto (os 10 mais novos de cada). */
export function useDocumentosDoProjeto(projectId: string | null) {
  return useQuery({
    queryKey: ['documentos-do-projeto-ludmilla', projectId],
    queryFn: async (): Promise<{ anexos: AnexoDoPortal[]; pareceres: ParecerDoPortal[] }> => {
      const [anexos, pareceres] = await Promise.all([
        supabase.from('portal_anexos' as never).select(SELECT_ANEXOS_DO_PROJETO)
          .eq('project_id', projectId as string).order('created_at', { ascending: false }).limit(10),
        supabase.from('portal_pareceres' as never).select(SELECT_PARECERES_DO_PROJETO)
          .eq('project_id', projectId as string).order('created_at', { ascending: false }).limit(10),
      ]);
      if (anexos.error) throw anexos.error;
      if (pareceres.error) throw pareceres.error;
      return {
        anexos: (anexos.data ?? []) as unknown as AnexoDoPortal[],
        pareceres: (pareceres.data ?? []) as unknown as ParecerDoPortal[],
      };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/** Código e número da CPFL dos projetos das criações (aba Criações na CPFL). */
export function useProjetosDasCriacoes(ids: string[]) {
  const chave = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['projetos-das-criacoes', chave],
    queryFn: async (): Promise<ProjetoDaCriacao[]> => {
      const { data, error } = await supabase
        .from('projects' as never)
        .select(SELECT_PROJETO_DA_CRIACAO)
        .in('id', chave);
      if (error) throw error;
      return (data ?? []) as unknown as ProjetoDaCriacao[];
    },
    enabled: chave.length > 0,
    staleTime: 60_000,
  });
}

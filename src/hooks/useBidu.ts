import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/hooks/useTenant';
import { toast } from 'sonner';
import type { ProjectWithDetails } from '@/hooks/useProjects';
import { downloadTemplateBuffer } from '@/hooks/useConcessionaireTemplates';
import { ehFormularioCemig, gerarFormularioCemig, type ResultadoCemig } from '@/utils/formFill/gerarFormularioCemig';
import type { RespostasCemig } from '@/utils/formFill/cemigForm';
import { sanitizeFileName } from '@/lib/utils';

/**
 * ENGENHEIRO BIDU — o projetista automático.
 *
 * Ele é duas coisas ao mesmo tempo (escopo combinado com o usuário, set/2026):
 * um usuário `staff` de verdade, a quem se atribui projeto e tarefa, e um
 * painel com chat dentro do projeto, onde recebe treinamento.
 *
 * O treinamento vive no BANCO (`bidu_skills`), nunca fixo em código — mesmo
 * princípio do Motor de Engenharia. Ensinar pelo chat cria uma linha lá.
 *
 * Restrito ao tenant GD Manager (`is_library`), como o motor de diagramas.
 */

/** Id fixo do Bidu (ver migration). Vale para atribuir projeto e tarefa a ele. */
export const BIDU_USER_ID = '00000000-b1d0-4000-8000-000000000001';

export interface BiduSkill {
  id: string;
  titulo: string;
  instrucao: string;
  concessionaire_id: string | null;
  enabled: boolean;
  created_at: string;
}

export interface BiduMessage {
  id: string;
  project_id: string | null;
  autor: 'user' | 'bidu';
  conteudo: string;
  skill_id: string | null;
  created_at: string;
}

/** O Bidu existe para este usuário? Só no tenant biblioteca (GD Manager). */
export function useBiduDisponivel(): boolean {
  const { user } = useAuth();
  const { data: tenant } = useTenant();
  if (!user) return false;
  return (user.role === 'admin' || user.role === 'staff') && !!tenant?.is_library;
}

export function useBiduSkills() {
  const disponivel = useBiduDisponivel();
  return useQuery({
    queryKey: ['bidu-skills'],
    queryFn: async (): Promise<BiduSkill[]> => {
      const { data, error } = await supabase
        .from('bidu_skills' as never)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as BiduSkill[];
    },
    enabled: disponivel,
    staleTime: 60_000,
  });
}

export function useBiduMessages(projectId: string | undefined) {
  const disponivel = useBiduDisponivel();
  return useQuery({
    queryKey: ['bidu-messages', projectId ?? 'geral'],
    queryFn: async (): Promise<BiduMessage[]> => {
      let q = supabase.from('bidu_messages' as never).select('*')
        .order('created_at', { ascending: true }).limit(100);
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as BiduMessage[];
    },
    enabled: disponivel,
    staleTime: 30_000,
  });
}

export function useDeleteBiduSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bidu_skills' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bidu-skills'] });
      toast.success('Habilidade removida do Bidu');
    },
    onError: () => toast.error('Não consegui remover a habilidade'),
  });
}

/**
 * Manda a mensagem, guarda os dois lados da conversa e, quando o Bidu entende
 * que foi um ensinamento, grava a habilidade.
 *
 * A gravação é feita AQUI e não na edge function porque assim tudo passa pelo
 * RLS com a sessão de quem está falando — o Bidu não escreve nada em nome de
 * ninguém.
 */
export function useFalarComBidu(projectId: string | undefined) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: tenant } = useTenant();

  return useMutation({
    mutationFn: async ({ mensagem, historico }: {
      mensagem: string;
      historico: { autor: 'user' | 'bidu'; conteudo: string }[];
    }) => {
      const base = { tenant_id: tenant?.id, project_id: projectId ?? null };

      // 1. registra o que foi dito
      await supabase.from('bidu_messages' as never).insert({
        ...base, autor: 'user', conteudo: mensagem, user_id: user?.id,
      } as never);

      // 2. pergunta ao Bidu
      const { data, error } = await supabase.functions.invoke('bidu-chat', {
        body: { mensagem, projectId: projectId ?? null, historico },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'O Bidu não conseguiu responder');

      // 3. virou habilidade? grava e amarra à mensagem
      let skillId: string | null = null;
      if (data.habilidade?.titulo && data.habilidade?.instrucao) {
        const { data: nova, error: errSkill } = await supabase
          .from('bidu_skills' as never)
          .insert({
            tenant_id: tenant?.id,
            titulo: data.habilidade.titulo,
            instrucao: data.habilidade.instrucao,
            created_by: user?.id,
          } as never)
          .select('id').maybeSingle();
        if (errSkill) console.error('[bidu] falha ao gravar habilidade', errSkill);
        else skillId = (nova as { id?: string } | null)?.id ?? null;
      }

      // 4. registra a resposta
      await supabase.from('bidu_messages' as never).insert({
        ...base, autor: 'bidu', conteudo: data.resposta, skill_id: skillId,
      } as never);

      return {
        resposta: data.resposta as string,
        aprendeu: !!skillId,
        // ação que o Bidu entendeu no pedido (a tela executa: hoje, o formulário da CEMIG)
        acao: (data.acao ?? null) as 'preencher_formulario_cemig' | null,
        parametros: (data.parametros ?? null) as { fastTrack?: string; gridZero?: string; tipoSolicitacao?: string | number } | null,
      };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['bidu-messages', projectId ?? 'geral'] });
      if (r.aprendeu) {
        qc.invalidateQueries({ queryKey: ['bidu-skills'] });
        toast.success('O Bidu aprendeu uma habilidade nova');
      }
    },
    onError: (e) => {
      console.error('[bidu]', e);
      toast.error(e instanceof Error ? e.message : 'O Bidu não respondeu');
    },
  });
}

// ── Entregas do Bidu: o formulário da CEMIG ──────────────────────────────────

/** O projeto é da CEMIG? (é para ela que o Bidu sabe preencher o formulário) */
export const projetoDaCemig = (p: { concessionaireName?: string | null } | null | undefined) =>
  /cemig/i.test(p?.concessionaireName ?? '');

/**
 * O Bidu preenche o Formulário MicroGD e ANEXA no projeto — é a diferença
 * entre "gerar um arquivo para download" (aba Documentos) e um projetista
 * entregar o trabalho no card.
 *
 * 1. acha o modelo em branco na pasta da concessionária (semeado por
 *    `seed-cemig-forms`), 2. preenche com os valores do projeto e as respostas
 *    confirmadas, 3. sobe no bucket dos documentos do projeto (sessão de quem
 *    pediu), 4. registra documento + comentário em nome do Bidu (RPC),
 *    5. escreve no chat o que fez. O arquivo volta para download também.
 */
export function useBiduPreencherCemig(project: ProjectWithDetails | null | undefined) {
  const qc = useQueryClient();
  const { data: tenant } = useTenant();

  return useMutation({
    mutationFn: async ({ valores, respostas }: { valores: Record<string, string>; respostas: RespostasCemig }): Promise<ResultadoCemig> => {
      if (!project?.concessionaire_id) throw new Error('O projeto está sem concessionária.');
      if (!project.company_id) throw new Error('O projeto está sem empresa.');

      // 1. o modelo da concessionária
      const { data: arquivos, error: errLista } = await supabase.storage
        .from('concessionaire-templates').list(project.concessionaire_id, { limit: 200 });
      if (errLista) throw new Error(`Não consegui listar os modelos da concessionária: ${errLista.message}`);
      const modelo = (arquivos ?? []).find(f => f.id && ehFormularioCemig(f.name));
      if (!modelo) throw new Error('A concessionária não tem o Formulário MicroGD cadastrado. Peça a um administrador para subir o modelo em Concessionárias.');
      const buffer = await downloadTemplateBuffer(`${project.concessionaire_id}/${modelo.name}`);

      // 2. preenche
      const gerado = gerarFormularioCemig(buffer, valores, respostas);

      // 3. sobe no projeto
      const nome = sanitizeFileName(gerado.nomeArquivo);
      const path = `${project.company_id}/${project.id}/extra_attachment/${Date.now()}_${nome}`;
      const { error: errUp } = await supabase.storage.from('project-documents')
        .upload(path, new Blob([gerado.bytes], { type: gerado.mime }), { contentType: gerado.mime, upsert: false });
      if (errUp) throw new Error(`Não consegui anexar o formulário no projeto: ${errUp.message}`);

      // 4. documento + comentário como Bidu
      const resumo = `📐 Preenchi o Formulário MicroGD da CEMIG com os dados do projeto — `
        + `FAST TRACK: ${respostas.fastTrack}; Grid Zero: ${respostas.gridZero}; solicitação: ${respostas.tipoSolicitacao}.`
        + (gerado.avisos.length > 0 ? `\n⚠ ${gerado.avisos.join('\n⚠ ')}` : '');
      const { error: errRpc } = await supabase.rpc('bidu_anexar_documento' as never, {
        p_project_id: project.id, p_file_path: path, p_file_name: nome, p_file_type: gerado.mime, p_resumo: resumo,
      } as never);
      if (errRpc) throw new Error(`O arquivo subiu, mas não consegui registrar no projeto: ${errRpc.message}`);

      // 5. no chat
      await supabase.from('bidu_messages' as never).insert({
        tenant_id: tenant?.id, project_id: project.id, autor: 'bidu',
        conteudo: `${resumo}\n📎 ${nome} — está nos documentos do projeto.`,
      } as never);

      return { ...gerado, nomeArquivo: nome };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['documents', project?.id] });
      qc.invalidateQueries({ queryKey: ['comments', project?.id] });
      qc.invalidateQueries({ queryKey: ['bidu-messages', project?.id ?? 'geral'] });
      if (r.avisos.length === 0) toast.success('Formulário MicroGD preenchido e anexado no projeto.');
      else toast.warning('Formulário anexado, mas com pendências — veja os avisos.', { duration: 8000 });
    },
    onError: (e) => {
      console.error('[bidu] formulário CEMIG', e);
      toast.error(e instanceof Error ? e.message : 'Não consegui preencher o formulário da CEMIG.');
    },
  });
}

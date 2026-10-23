-- ============================================================================
-- LUDMILLA — ajustes da linha do tempo do projeto (22/10/2026), rodada de revisão 1
-- Corpo copiado do prosrc VIVO de ludmilla_linha_do_tempo (md5
-- fed272d669d9d6eea400e6c6b9d9e0af, criada na 20261022200000). Muda SÓ:
--   1. e-mail ainda em tentativa (portal_email_mensagens.concluida = false) deixa
--      de aparecer como "E-mail lido": vira "E-mail recebido (leitura em
--      andamento)". A linha continua aparecendo, só o título é honesto;
--   2. desempate na ordem: ORDER BY quando DESC, acao, titulo, detalhe. A varredura
--      grava update, anexo e parecer com o MESMO carimbo, e os anexos do mesmo
--      carimbo têm o mesmo título (só o detalhe, com o nome do arquivo, difere);
--      sem isso a ordem e o LIMIT mudavam de uma chamada para outra;
--   3. STABLE: a função só lê.
-- Assinatura, retorno, SECURITY DEFINER, search_path, REVOKE e GRANT iguais.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ludmilla_linha_do_tempo(p_project_id UUID, p_limite INTEGER DEFAULT 60)
RETURNS TABLE(quando timestamptz, ator text, quem text, acao text, titulo text, detalhe text,
              situacao text, project_id uuid, projeto text, protocolo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _tenant UUID; _codigo TEXT;
BEGIN
  IF NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id((SELECT auth.uid()));
  SELECT pr.code INTO _codigo FROM public.projects pr WHERE pr.id = p_project_id AND pr.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;

  RETURN QUERY
  WITH eventos AS (
    -- recomendações que ela levantou (ramo de ludmilla_registro, filtrado pelo projeto)
    SELECT u.detectado_em AS quando, 'ludmilla'::text AS ator, 'Ludmilla'::text AS quem,
           'recomendacao'::text AS acao,
           ('Mudança no portal: ' || u.status_portal)::text AS titulo,
           ('Protocolo ' || u.protocolo || coalesce(' · ' || u.titular_portal, '')
             || coalesce(' · sugere ' || u.recomendacao, ' · sem etapa sugerida')
             || CASE WHEN u.casamento IS NOT NULL AND u.casamento <> 'protocolo' THEN ' · casado por ' || u.casamento ELSE '' END)::text AS detalhe,
           'ok'::text AS situacao, u.protocolo::text AS protocolo
      FROM public.portal_updates u
     WHERE u.tenant_id = _tenant AND u.project_id = p_project_id

    UNION ALL
    -- o que a equipe decidiu sobre cada recomendação
    SELECT u.aplicada_em, 'equipe', coalesce(p.name, 'equipe'),
           CASE WHEN u.situacao = 'aplicada' THEN 'aplicada' ELSE 'ignorada' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'Recomendação aplicada' ELSE 'Recomendação ignorada' END,
           'Protocolo ' || u.protocolo
             || CASE WHEN u.situacao = 'aplicada' THEN coalesce(' → ' || u.recomendacao, '') ELSE '' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'ok' ELSE 'aviso' END,
           u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.profiles p ON p.id = u.aplicada_por
     WHERE u.tenant_id = _tenant AND u.project_id = p_project_id
       AND u.situacao IN ('aplicada', 'ignorada') AND u.aplicada_em IS NOT NULL

    UNION ALL
    -- anexos que ela trouxe para o card
    SELECT coalesce(x.enviado_em, x.created_at), 'ludmilla', 'Ludmilla', 'anexo',
           CASE x.situacao WHEN 'enviado' THEN 'Anexo da concessionária no card'
                           WHEN 'bloqueado' THEN 'Anexo bloqueado (titular/UC não conferem)'
                           WHEN 'erro' THEN 'Anexo falhou' ELSE 'Anexo pendente' END,
           x.nome_arquivo || ' · protocolo ' || x.protocolo || coalesce(' · ' || x.motivo, '')
             || coalesce(' · conferido por ' || x.conferido_por, ''),
           CASE x.situacao WHEN 'enviado' THEN 'ok' WHEN 'erro' THEN 'erro' ELSE 'aviso' END,
           x.protocolo
      FROM public.portal_anexos x
     WHERE x.tenant_id = _tenant AND x.project_id = p_project_id

    UNION ALL
    -- pareceres do portal virando comentário no card
    SELECT pa.created_at, 'ludmilla', 'Ludmilla', 'parecer', 'Parecer da concessionária no card',
           coalesce(pa.analise || ' · ', '') || coalesce(pa.status, '') || ' · protocolo ' || pa.protocolo,
           'ok', pa.protocolo
      FROM public.portal_pareceres pa
     WHERE pa.tenant_id = _tenant AND pa.project_id = p_project_id

    UNION ALL
    -- tarefas encerradas porque o projeto mudou de etapa
    SELECT k.completed_at,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'ludmilla' ELSE 'equipe' END,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'Ludmilla' ELSE coalesce(p.name, 'equipe') END,
           'tarefa_encerrada', 'Tarefa encerrada: ' || k.title,
           regexp_replace(split_part(k.description, '✅ ', 2), E'\\s+', ' ', 'g'),
           'ok', NULL::text
      FROM public.tasks k
      LEFT JOIN public.profiles p ON p.id = k.completed_by
     WHERE k.tenant_id = _tenant AND k.project_id = p_project_id AND k.status = 'completed'
       AND k.completed_at IS NOT NULL AND k.description LIKE '%✅ Encerrada%'

    UNION ALL
    -- NOVO: e-mails lidos deste projeto (EDP e ENEL)
    SELECT coalesce(m.recebido_em, m.created_at), 'ludmilla', 'Ludmilla', 'email',
           CASE WHEN m.concluida THEN 'E-mail lido: ' ELSE 'E-mail recebido (leitura em andamento): ' END
             || coalesce(nullif(btrim(m.assunto), ''), '(sem assunto)'),
           nullif(concat_ws(' · ', nullif(btrim(m.remetente), ''), nullif(btrim(m.resumo), ''), nullif(btrim(m.motivo), '')), ''),
           CASE WHEN m.motivo IS NOT NULL THEN 'aviso' ELSE 'ok' END,
           nullif(m.protocolo, '')
      FROM public.portal_email_mensagens m
     WHERE m.tenant_id = _tenant AND m.project_id = p_project_id

    UNION ALL
    -- NOVO: o A fazer que ela levantou
    SELECT f.criado_em, 'ludmilla', 'Ludmilla', 'afazer', 'A fazer: ' || f.titulo, f.mensagem, 'aviso', NULL::text
      FROM public.portal_afazeres f
     WHERE f.tenant_id = _tenant AND f.project_id = p_project_id

    UNION ALL
    -- NOVO: quem marcou como feito
    SELECT f.feito_em, 'equipe', coalesce(p.name, 'equipe'), 'afazer_feito', 'Feito: ' || f.titulo, NULL::text, 'ok', NULL::text
      FROM public.portal_afazeres f
      LEFT JOIN public.profiles p ON p.id = f.feito_por
     WHERE f.tenant_id = _tenant AND f.project_id = p_project_id AND f.feito_em IS NOT NULL
  )
  SELECT e.quando, e.ator, e.quem, e.acao, e.titulo, e.detalhe, e.situacao, p_project_id, _codigo, e.protocolo
    FROM eventos e
   WHERE e.quando IS NOT NULL
   ORDER BY e.quando DESC, e.acao, e.titulo, e.detalhe
   LIMIT greatest(1, least(coalesce(p_limite, 60), 200));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_linha_do_tempo(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_linha_do_tempo(UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

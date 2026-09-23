-- ============================================================================
-- LUDMILLA — varre as tarefas já criadas e ganha um REGISTRO (23/09/2026)
--
-- Dois pedidos do usuário:
--
-- 1. O encerramento de 22/09 só age na hora em que o card muda de etapa, então
--    as tarefas que JÁ estavam abertas em projetos que saíram da etapa
--    continuavam vencendo. Agora a Ludmilla varre essas pendências a cada
--    visita ao portal (e há a função para a limpeza inicial).
--
-- 2. A aba da Ludmilla precisa de um REGISTRO do que ela fez e do que foi
--    feito através dela. Em vez de uma tabela nova de log (que só começaria a
--    contar de hoje e duplicaria escrita), o registro é uma LEITURA unificada
--    do que já está gravado: visitas, recomendações, aplicações, anexos,
--    pareceres, códigos de imagem e tarefas encerradas.
-- ============================================================================

-- ── 1. Tarefas de etapa vencida ─────────────────────────────────────────────

-- ganha `p_avisar`: a limpeza inicial de um lote antigo não deve disparar
-- dezenas de sinos de uma vez; no dia a dia (uma ou duas por visita) avisa.
CREATE OR REPLACE FUNCTION public.encerrar_tarefas_da_etapa(
  p_project_id UUID, p_novo_status TEXT, p_quem UUID, p_motivo TEXT, p_avisar BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _t RECORD; _n INTEGER := 0;
BEGIN
  FOR _t IN
    SELECT k.id, k.title, k.assigned_to, k.tenant_id, k.description
      FROM public.tasks k
      JOIN public.task_automations a ON a.id = k.automation_id
     WHERE k.project_id = p_project_id
       AND k.status IN ('pending', 'in_progress')
       AND a.to_status IS DISTINCT FROM p_novo_status
  LOOP
    UPDATE public.tasks
       SET status = 'completed',
           completed_at = now(),
           completed_by = p_quem,
           description = coalesce(nullif(_t.description, '') || E'\n\n', '') || '✅ ' || p_motivo
     WHERE id = _t.id;
    _n := _n + 1;

    -- quem tinha a tarefa precisa saber que ela saiu da sua lista, e por quê
    IF p_avisar AND _t.assigned_to IS NOT NULL AND _t.assigned_to IS DISTINCT FROM p_quem THEN
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_t.tenant_id, _t.assigned_to, '✅ Tarefa encerrada automaticamente',
              _t.title || ' · ' || p_motivo, 'status', p_project_id, FALSE);
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.encerrar_tarefas_da_etapa(UUID, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
-- a de 4 argumentos sai de cena: com as duas, a chamada de 4 fica ambígua
DROP FUNCTION IF EXISTS public.encerrar_tarefas_da_etapa(UUID, TEXT, UUID, TEXT);

/**
 * Varre TODAS as tarefas de automação abertas do tenant e encerra as que
 * pertencem a uma etapa que o projeto já deixou — inclusive as criadas antes
 * de o encerramento automático existir. Devolve quantas foram encerradas.
 *
 * É a Ludmilla quem assina (`completed_by`), porque é ela quem confere.
 */
CREATE OR REPLACE FUNCTION public.ludmilla_encerrar_tarefas_vencidas(
  p_tenant_id UUID, p_avisar BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
  _p RECORD; _n INTEGER := 0;
BEGIN
  FOR _p IN
    SELECT DISTINCT pr.id, pr.status::text AS status_atual,
           coalesce(col.status_label, pr.status::text) AS etapa
      FROM public.tasks k
      JOIN public.task_automations a ON a.id = k.automation_id
      JOIN public.projects pr ON pr.id = k.project_id
      LEFT JOIN public.kanban_models mo ON mo.tenant_id = pr.tenant_id AND mo.is_active
      LEFT JOIN public.kanban_columns col ON col.kanban_model_id = mo.id AND col.status_key = pr.status::text
     WHERE k.tenant_id = p_tenant_id
       AND k.status IN ('pending', 'in_progress')
       AND a.to_status IS DISTINCT FROM pr.status::text
       AND NOT pr.is_deleted
  LOOP
    _n := _n + public.encerrar_tarefas_da_etapa(
      _p.id, _p.status_atual, _ludmilla,
      'Encerrada pela Ludmilla: a tarefa era de outra etapa e o projeto está em ' || _p.etapa || '.',
      p_avisar);
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_encerrar_tarefas_vencidas(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.ludmilla_encerrar_tarefas_vencidas(UUID, BOOLEAN) IS
  'Encerra tarefas de automação abertas cujo projeto já saiu da etapa. Chamada a cada varredura da Ludmilla.';

-- Toda varredura que termina bem passa a varrer também as tarefas vencidas
-- (corpo de 20260915170000 + 20260916…, com a chamada nova).
CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run_impl(
  p_run_id UUID, p_situacao TEXT, p_erro TEXT, p_resultado JSONB, p_print_path TEXT,
  p_protocolos INTEGER, p_mudancas INTEGER, p_situacao_conta TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID; _tipo TEXT; _conta public.portal_accounts%ROWTYPE; _dest UUID; _login_falhou BOOLEAN;
BEGIN
  UPDATE public.portal_sync_runs
     SET situacao = p_situacao, terminado_em = now(), erro = p_erro, resultado = p_resultado,
         print_path = p_print_path, protocolos_lidos = p_protocolos, mudancas = p_mudancas
   WHERE id = p_run_id
   RETURNING account_id, tipo INTO _account, _tipo;
  IF _account IS NULL THEN RETURN; END IF;

  _login_falhou := p_situacao_conta IN ('erro', 'sessao_expirada');

  IF _tipo = 'criar_projeto' AND NOT _login_falhou THEN
    -- criação falhou por causa do formulário: a conta continua como estava
    SELECT * INTO _conta FROM public.portal_accounts WHERE id = _account;
  ELSE
    UPDATE public.portal_accounts
       SET situacao = coalesce(p_situacao_conta, situacao),
           ultimo_erro = CASE WHEN p_situacao = 'erro' THEN p_erro ELSE NULL END,
           ultima_varredura_em = CASE WHEN _tipo = 'varredura' AND p_situacao = 'ok' THEN now() ELSE ultima_varredura_em END
     WHERE id = _account
     RETURNING * INTO _conta;
  END IF;

  IF _tipo = 'varredura' AND p_situacao = 'ok' THEN
    PERFORM public.ludmilla_registrar_varredura(p_run_id);
    -- …e confere as tarefas de etapa que ficaram para trás (inclusive as
    -- criadas antes de o encerramento automático existir).
    PERFORM public.ludmilla_encerrar_tarefas_vencidas(_conta.tenant_id, TRUE);
  END IF;

  -- Estação local sem ninguém para o login: avisa os admins pelo sino.
  IF _conta.modo = 'local' AND p_situacao_conta = 'sessao_expirada' THEN
    FOR _dest IN SELECT p.id FROM public.profiles p WHERE p.tenant_id = _conta.tenant_id AND p.role = 'admin' LOOP
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_conta.tenant_id, _dest, '📡 Ludmilla precisa de login na Elektro',
              coalesce(p_erro, 'A estação abriu o portal, mas ninguém digitou o CAPTCHA.') || ' Ela tenta de novo no próximo horário.',
              'ludmilla', NULL, FALSE);
    END LOOP;
  END IF;
END;
$$;

-- ── 2. Registro: o que a Ludmilla fez e o que foi feito através dela ────────
/**
 * Leitura unificada das tabelas do módulo. Sem tabela de log própria: assim o
 * registro já nasce com todo o histórico, e cada rotina continua gravando num
 * lugar só.
 *
 * `ator`: 'ludmilla' (ela fez) ou 'equipe' (a pessoa fez através dela).
 */
CREATE OR REPLACE FUNCTION public.ludmilla_registro(p_limite INTEGER DEFAULT 120, p_ator TEXT DEFAULT NULL)
RETURNS TABLE (
  quando TIMESTAMPTZ, ator TEXT, quem TEXT, acao TEXT, titulo TEXT, detalhe TEXT,
  situacao TEXT, project_id UUID, projeto TEXT, protocolo TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID;
BEGIN
  IF NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id((select auth.uid()));

  RETURN QUERY
  WITH portais AS (
    SELECT a.id, coalesce(c.name, upper(a.connector)) AS nome
      FROM public.portal_accounts a
      LEFT JOIN public.energy_concessionaires c ON c.id = a.concessionaire_id
     WHERE a.tenant_id = _tenant
  ),
  eventos AS (
    -- visitas ao portal
    SELECT coalesce(r.terminado_em, r.iniciado_em, r.pedido_em) AS quando,
           'ludmilla'::text AS ator,
           coalesce(p.name, 'agendamento') AS quem,
           'visita'::text AS acao,
           CASE r.tipo
             WHEN 'varredura' THEN 'Varredura no portal ' || po.nome
             WHEN 'criar_projeto' THEN 'Criação de projeto no portal ' || po.nome
             WHEN 'teste_login' THEN 'Teste de acesso ao portal ' || po.nome
             WHEN 'descoberta' THEN 'Descoberta das telas do portal ' || po.nome
             ELSE 'Reconhecimento da tela do portal ' || po.nome END AS titulo,
           CASE WHEN r.situacao = 'erro' THEN r.erro
                WHEN r.tipo = 'varredura' THEN r.protocolos_lidos || ' protocolos lidos · ' || r.mudancas || ' recomendação(ões)'
                ELSE 'Situação: ' || r.situacao END AS detalhe,
           CASE WHEN r.situacao = 'erro' THEN 'erro' WHEN r.situacao = 'ok' THEN 'ok' ELSE 'aviso' END AS situacao,
           NULL::uuid AS project_id, NULL::text AS projeto, NULL::text AS protocolo
      FROM public.portal_sync_runs r
      JOIN portais po ON po.id = r.account_id
      LEFT JOIN public.profiles p ON p.id = r.pedido_por
     WHERE r.tenant_id = _tenant AND r.situacao IN ('ok', 'erro')

    UNION ALL
    -- recomendações que ela levantou
    SELECT u.detectado_em, 'ludmilla', 'Ludmilla', 'recomendacao',
           'Mudança no portal: ' || u.status_portal,
           'Protocolo ' || u.protocolo || coalesce(' · ' || u.titular_portal, '')
             || coalesce(' · sugere ' || u.recomendacao, ' · sem etapa sugerida')
             || CASE WHEN u.casamento IS NOT NULL AND u.casamento <> 'protocolo' THEN ' · casado por ' || u.casamento ELSE '' END,
           CASE WHEN u.project_id IS NULL THEN 'aviso' ELSE 'ok' END,
           u.project_id, pr.code, u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.projects pr ON pr.id = u.project_id
     WHERE u.tenant_id = _tenant

    UNION ALL
    -- o que a equipe decidiu sobre cada recomendação
    SELECT u.aplicada_em, 'equipe', coalesce(p.name, 'equipe'),
           CASE WHEN u.situacao = 'aplicada' THEN 'aplicada' ELSE 'ignorada' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'Recomendação aplicada' ELSE 'Recomendação ignorada' END,
           'Protocolo ' || u.protocolo || coalesce(' · ' || pr.code, '')
             || CASE WHEN u.situacao = 'aplicada' THEN coalesce(' → ' || u.recomendacao, '') ELSE '' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'ok' ELSE 'aviso' END,
           u.project_id, pr.code, u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.projects pr ON pr.id = u.project_id
      LEFT JOIN public.profiles p ON p.id = u.aplicada_por
     WHERE u.tenant_id = _tenant AND u.situacao IN ('aplicada', 'ignorada') AND u.aplicada_em IS NOT NULL

    UNION ALL
    -- anexos que ela trouxe do portal para o card
    SELECT coalesce(x.enviado_em, x.created_at), 'ludmilla', 'Ludmilla', 'anexo',
           CASE x.situacao WHEN 'enviado' THEN 'Anexo da concessionária no card'
                           WHEN 'bloqueado' THEN 'Anexo bloqueado (titular/UC não conferem)'
                           WHEN 'erro' THEN 'Anexo falhou' ELSE 'Anexo pendente' END,
           x.nome_arquivo || ' · protocolo ' || x.protocolo || coalesce(' · ' || x.motivo, '')
             || coalesce(' · conferido por ' || x.conferido_por, ''),
           CASE x.situacao WHEN 'enviado' THEN 'ok' WHEN 'erro' THEN 'erro' ELSE 'aviso' END,
           x.project_id, pr.code, x.protocolo
      FROM public.portal_anexos x
      LEFT JOIN public.projects pr ON pr.id = x.project_id
     WHERE x.tenant_id = _tenant

    UNION ALL
    -- pareceres do portal virando comentário no card
    SELECT pa.created_at, 'ludmilla', 'Ludmilla', 'parecer',
           'Parecer da concessionária no card',
           coalesce(pa.analise || ' · ', '') || coalesce(pa.status, '') || ' · protocolo ' || pa.protocolo,
           'ok', pa.project_id, pr.code, pa.protocolo
      FROM public.portal_pareceres pa
      LEFT JOIN public.projects pr ON pr.id = pa.project_id
     WHERE pa.tenant_id = _tenant

    UNION ALL
    -- código da imagem: ela pediu
    SELECT ca.criado_em, 'ludmilla', 'Ludmilla', 'captcha_pedido',
           'Pediu o código da imagem (' || po.nome || ')',
           'Tentativa ' || ca.tentativa || coalesce(' · ' || ca.mensagem, '') || ' · ' || ca.situacao,
           CASE ca.situacao WHEN 'usado' THEN 'ok' WHEN 'expirado' THEN 'erro' ELSE 'aviso' END,
           NULL::uuid, NULL::text, NULL::text
      FROM public.portal_captchas ca
      JOIN portais po ON po.id = ca.account_id
     WHERE ca.tenant_id = _tenant

    UNION ALL
    -- código da imagem: alguém respondeu
    SELECT ca.respondido_em, 'equipe', coalesce(p.name, 'equipe'), 'captcha_respondido',
           'Código da imagem respondido (' || po.nome || ')',
           'Tentativa ' || ca.tentativa, 'ok', NULL::uuid, NULL::text, NULL::text
      FROM public.portal_captchas ca
      JOIN portais po ON po.id = ca.account_id
      LEFT JOIN public.profiles p ON p.id = ca.respondido_por
     WHERE ca.tenant_id = _tenant AND ca.respondido_em IS NOT NULL

    UNION ALL
    -- tarefas encerradas porque o projeto mudou de etapa
    SELECT k.completed_at,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'ludmilla' ELSE 'equipe' END,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'Ludmilla' ELSE coalesce(p.name, 'equipe') END,
           'tarefa_encerrada', 'Tarefa encerrada: ' || k.title,
           regexp_replace(split_part(k.description, '✅ ', 2), E'\\s+', ' ', 'g'),
           'ok', k.project_id, pr.code, NULL::text
      FROM public.tasks k
      LEFT JOIN public.projects pr ON pr.id = k.project_id
      LEFT JOIN public.profiles p ON p.id = k.completed_by
     WHERE k.tenant_id = _tenant AND k.status = 'completed' AND k.completed_at IS NOT NULL
       AND k.description LIKE '%✅ Encerrada%'
  )
  SELECT e.quando, e.ator, e.quem, e.acao, e.titulo, e.detalhe, e.situacao, e.project_id, e.projeto, e.protocolo
    FROM eventos e
   WHERE e.quando IS NOT NULL
     AND (p_ator IS NULL OR e.ator = p_ator)
   ORDER BY e.quando DESC
   LIMIT greatest(1, least(coalesce(p_limite, 120), 500));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) TO authenticated;
COMMENT ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) IS
  'Registro da Ludmilla: leitura unificada de visitas, recomendações, decisões da equipe, anexos, pareceres, códigos de imagem e tarefas encerradas.';

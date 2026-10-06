-- supabase/migrations/20261005130000_ludmilla_email_run.sql
-- Ludmilla (e-mail): os dois ajustes que o run `varredura_email` precisa.
-- Spec: docs/superpowers/specs/2026-10-02-ludmilla-edp-email-design.md (§8)
--
-- 1. `ultima_varredura_em` tem de subir também no run de e-mail — a tela quer
--    "última verificação" no cartão da EDP, e a EDP só tem o run de e-mail.
-- 2. O histórico da Ludmilla não conhece o tipo `varredura_email`: cai no ELSE e
--    sai rotulado como "Reconhecimento da tela do portal …".
--
-- As duas funções são copiadas INTEIRAS da definição mais recente
-- (20260923100000_ludmilla_tarefas_vencidas_e_registro.sql), porque
-- CREATE OR REPLACE substitui o corpo todo; só as linhas comentadas mudam.

-- ── 1. A data da última verificação vale para os dois meios ──────────────────
-- Único ajuste: `ultima_varredura_em` passa a subir com _tipo IN ('varredura',
-- 'varredura_email'). O bloco de `ludmilla_registrar_varredura` +
-- `ludmilla_encerrar_tarefas_vencidas` continua SÓ para 'varredura': aquela
-- função devolve 0 na hora se o tipo não for 'varredura' e espera
-- `resultado->'protocolos'` como lista de protocolos do portal — forma que o run
-- de e-mail não escreve.
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
           -- os dois meios de acompanhamento marcam a data: portal e e-mail
           ultima_varredura_em = CASE WHEN _tipo IN ('varredura', 'varredura_email') AND p_situacao = 'ok' THEN now() ELSE ultima_varredura_em END
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

-- ── 2. O run de e-mail com nome próprio no histórico ─────────────────────────
-- Dois ajustes, ambos no bloco "visitas ao portal":
--   · título: 'Leitura dos e-mails da <concessionária>' (antes caía no ELSE e
--     saía como "Reconhecimento da tela do portal …");
--   · detalhe: "N projetos conferidos · N documento(s) anexado(s)" — o run de
--     e-mail não lê protocolo no portal, ele confere projeto por projeto.
-- O resto da função é cópia literal.
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
    -- visitas ao portal (e, desde out/2026, leituras da caixa de e-mail)
    SELECT coalesce(r.terminado_em, r.iniciado_em, r.pedido_em) AS quando,
           'ludmilla'::text AS ator,
           coalesce(p.name, 'agendamento') AS quem,
           'visita'::text AS acao,
           CASE r.tipo
             WHEN 'varredura' THEN 'Varredura no portal ' || po.nome
             WHEN 'varredura_email' THEN 'Leitura dos e-mails da ' || po.nome
             WHEN 'criar_projeto' THEN 'Criação de projeto no portal ' || po.nome
             WHEN 'teste_login' THEN 'Teste de acesso ao portal ' || po.nome
             WHEN 'descoberta' THEN 'Descoberta das telas do portal ' || po.nome
             ELSE 'Reconhecimento da tela do portal ' || po.nome END AS titulo,
           CASE WHEN r.situacao = 'erro' THEN r.erro
                WHEN r.tipo = 'varredura' THEN r.protocolos_lidos || ' protocolos lidos · ' || r.mudancas || ' recomendação(ões)'
                WHEN r.tipo = 'varredura_email' THEN r.protocolos_lidos || ' projetos conferidos · ' || r.mudancas || ' documento(s) anexado(s)'
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
  'Registro da Ludmilla: leitura unificada de visitas (portal e e-mail), recomendações, decisões da equipe, anexos, pareceres, códigos de imagem e tarefas encerradas.';

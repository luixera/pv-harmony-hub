-- ============================================================================
-- TAREFA DE ETAPA VENCIDA — encerra sempre que o projeto sai da etapa
-- (22/09/2026, decisão do usuário)
--
-- Em 20260922100000 o encerramento nasceu preso ao "Aplicar" da Ludmilla.
-- Mas o card também sai da etapa arrastado no quadro, pelo seletor do modal e
-- pela aplicação de etapa do /email-updates — e nesses casos a tarefa
-- "Verificar vistoria" continuava aberta, vencendo o prazo.
--
-- Agora quem encerra é o MESMO gatilho que cria (`trg_task_automations`,
-- AFTER UPDATE OF status): todo caminho passa por ele. A função de
-- encerramento deixa de ter nome de Ludmilla — ela vale para o sistema todo.
-- ============================================================================

/**
 * Encerra as tarefas de automação de etapa que não correspondem mais à etapa
 * atual do projeto. Devolve quantas foram encerradas.
 *
 * Interna: chamada pelo gatilho das automações (e por quem mais precisar,
 * dentro do servidor) — por isso nenhum GRANT para `authenticated`.
 */
CREATE OR REPLACE FUNCTION public.encerrar_tarefas_da_etapa(
  p_project_id UUID, p_novo_status TEXT, p_quem UUID, p_motivo TEXT
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
    IF _t.assigned_to IS NOT NULL AND _t.assigned_to IS DISTINCT FROM p_quem THEN
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_t.tenant_id, _t.assigned_to, '✅ Tarefa encerrada automaticamente',
              _t.title || ' · ' || p_motivo, 'status', p_project_id, FALSE);
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.encerrar_tarefas_da_etapa(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.encerrar_tarefas_da_etapa(UUID, TEXT, UUID, TEXT) IS
  'Encerra tarefas de automação de etapa que o projeto já deixou. Chamada pelo gatilho trg_task_automations.';

-- ── O gatilho das automações passa a fechar antes de abrir ──────────────────
-- (corpo de 20260901120000, com o bloco novo logo depois dos rótulos)
CREATE OR REPLACE FUNCTION public.fn_run_task_automations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_titular    TEXT;
  v_empresa    TEXT;
  v_etapa      TEXT;
  v_etapa_ant  TEXT;
  v_titulo     TEXT;
  v_desc       TEXT;
  v_autor      UUID;
BEGIN
  -- "UPDATE OF status" dispara mesmo quando o SET repete o valor atual.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Rótulos legíveis vêm do template de Kanban; se a coluna não existir mais
  -- no template, cai para a própria chave.
  SELECT c.status_label INTO v_etapa
    FROM public.kanban_columns c
    JOIN public.kanban_models m ON m.id = c.kanban_model_id
   WHERE m.is_active AND c.status_key = NEW.status::TEXT
   LIMIT 1;
  v_etapa := COALESCE(v_etapa, NEW.status::TEXT);

  SELECT c.status_label INTO v_etapa_ant
    FROM public.kanban_columns c
    JOIN public.kanban_models m ON m.id = c.kanban_model_id
   WHERE m.is_active AND c.status_key = OLD.status::TEXT
   LIMIT 1;
  v_etapa_ant := COALESCE(v_etapa_ant, OLD.status::TEXT);

  -- FECHA ANTES DE ABRIR: a tarefa que existia por causa da etapa anterior
  -- (ex.: "Verificar vistoria") perdeu o objeto quando o card saiu dela. Vale
  -- para todo caminho — arrastar no quadro, modal, /email-updates e o
  -- "Aplicar" da Ludmilla. A tarefa da etapa NOVA é criada no laço abaixo e
  -- não é tocada, porque a comparação é com NEW.status.
  PERFORM public.encerrar_tarefas_da_etapa(
    NEW.id, NEW.status::TEXT, auth.uid(),
    'Encerrada automaticamente: o projeto saiu de ' || v_etapa_ant || ' para ' || v_etapa || '.');

  SELECT g.holder_name INTO v_titular
    FROM public.project_general_data g WHERE g.project_id = NEW.id LIMIT 1;
  SELECT co.name INTO v_empresa
    FROM public.companies co WHERE co.id = NEW.company_id LIMIT 1;

  FOR r IN
    SELECT * FROM public.task_automations
     WHERE tenant_id = NEW.tenant_id
       AND enabled
       AND to_status = NEW.status::TEXT
       AND (from_status IS NULL OR from_status = OLD.status::TEXT)
     ORDER BY created_at
  LOOP
    -- Defesa: o responsável tem de ser admin/projetista DO MESMO tenant. Sem
    -- isto, uma regra órfã (usuário removido ou movido de tenant) criaria
    -- tarefa para fora do tenant.
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = r.assigned_to
         AND p.tenant_id = NEW.tenant_id
         AND p.role IN ('admin','staff')
    ) THEN
      CONTINUE;
    END IF;

    -- Não empilha: se a tarefa anterior da mesma regra para este projeto ainda
    -- está aberta, o card voltando e entrando de novo não gera outra.
    IF EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.project_id = NEW.id
         AND t.automation_id = r.id
         AND t.status IN ('pending','in_progress')
    ) THEN
      CONTINUE;
    END IF;

    v_titulo := r.title;
    v_desc   := COALESCE(r.description, '');

    v_titulo := replace(v_titulo, '{codigo}',        COALESCE(NEW.code, ''));
    v_titulo := replace(v_titulo, '{titular}',       COALESCE(v_titular, ''));
    v_titulo := replace(v_titulo, '{empresa}',       COALESCE(v_empresa, ''));
    v_titulo := replace(v_titulo, '{etapa}',         v_etapa);
    v_titulo := replace(v_titulo, '{etapa_anterior}', v_etapa_ant);
    v_titulo := replace(v_titulo, '{dias}',          r.days_to_complete::TEXT);

    v_desc := replace(v_desc, '{codigo}',        COALESCE(NEW.code, ''));
    v_desc := replace(v_desc, '{titular}',       COALESCE(v_titular, ''));
    v_desc := replace(v_desc, '{empresa}',       COALESCE(v_empresa, ''));
    v_desc := replace(v_desc, '{etapa}',         v_etapa);
    v_desc := replace(v_desc, '{etapa_anterior}', v_etapa_ant);
    v_desc := replace(v_desc, '{dias}',          r.days_to_complete::TEXT);

    -- created_by é NOT NULL. auth.uid() é nulo quando a etapa muda por uma
    -- rotina de servidor (ex.: aplicação de etapa vinda do e-mail), então cai
    -- para quem criou a regra e, por último, para o próprio responsável.
    v_autor := COALESCE(auth.uid(), r.created_by, r.assigned_to);

    INSERT INTO public.tasks
      (tenant_id, title, description, status, priority, due_date,
       project_id, created_by, assigned_to, automation_id)
    VALUES
      (NEW.tenant_id, v_titulo, NULLIF(v_desc, ''), 'pending', r.priority,
       (CURRENT_DATE + r.days_to_complete),
       NEW.id, v_autor, r.assigned_to, r.id);

    INSERT INTO public.notifications
      (tenant_id, user_id, title, message, type, project_id, read)
    VALUES
      (NEW.tenant_id, r.assigned_to, '📋 Nova tarefa automática',
       v_titulo || ' · Prazo: ' ||
         to_char(CURRENT_DATE + r.days_to_complete, 'DD/MM/YYYY'),
       'task_assigned', NEW.id, FALSE);
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── Aplicar a recomendação da Ludmilla: só conta, quem fecha é o gatilho ─────
CREATE OR REPLACE FUNCTION public.ludmilla_aplicar_update(p_update_id UUID, p_status TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid      UUID := (select auth.uid());
  _u        public.portal_updates%ROWTYPE;
  _novo     TEXT;
  _nome     TEXT;
  _anterior TEXT;
  _fechadas INTEGER := 0;
  _aviso    TEXT := '';
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  SELECT * INTO _u FROM public.portal_updates
   WHERE id = p_update_id AND tenant_id = public.get_user_tenant_id(_uid);
  IF _u.id IS NULL THEN RAISE EXCEPTION 'Recomendação não encontrada.'; END IF;
  IF _u.situacao <> 'pendente' THEN RAISE EXCEPTION 'Esta recomendação já foi %.', _u.situacao; END IF;
  IF _u.project_id IS NULL THEN RAISE EXCEPTION 'Recomendação sem projeto casado — não há o que mover.'; END IF;

  -- a pessoa pode escolher outra etapa que não a recomendada
  _novo := coalesce(nullif(trim(p_status), ''), _u.recomendacao);
  IF _novo IS NULL THEN RAISE EXCEPTION 'Escolha a etapa para onde mover o projeto.'; END IF;

  SELECT status::text INTO _anterior FROM public.projects WHERE id = _u.project_id;

  -- quantas tarefas de etapa o gatilho vai encerrar com esta mudança — contadas
  -- ANTES, porque depois do UPDATE elas já estarão fechadas
  IF _novo IS DISTINCT FROM _anterior THEN
    SELECT count(*) INTO _fechadas
      FROM public.tasks k JOIN public.task_automations a ON a.id = k.automation_id
     WHERE k.project_id = _u.project_id AND k.status IN ('pending', 'in_progress')
       AND a.to_status IS DISTINCT FROM _novo;
  END IF;

  UPDATE public.projects SET status = _novo::public.project_status WHERE id = _u.project_id;

  UPDATE public.portal_updates
     SET situacao = 'aplicada', aplicada_por = _uid, aplicada_em = now()
   WHERE id = _u.id;

  IF _fechadas > 0 THEN
    _aviso := E'\n✅ ' || _fechadas || ' tarefa' || CASE WHEN _fechadas > 1 THEN 's automáticas encerradas' ELSE ' automática encerrada' END
            || ' — a etapa que a gerou ficou para trás.';
  END IF;

  SELECT name INTO _nome FROM public.profiles WHERE id = _uid;
  INSERT INTO public.comments (project_id, user_id, message, type)
  VALUES (_u.project_id, _uid,
          '📡 Status atualizado a partir do portal (Ludmilla): "' || _u.status_portal || '" → ' || _novo || '.' || _aviso,
          'comment');
  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (_u.project_id, 'Status atualizado pelo portal',
          'Protocolo ' || _u.protocolo || ' está "' || _u.status_portal || '" no portal; ' ||
          coalesce(_nome, 'a equipe') || ' aplicou a recomendação da Ludmilla e moveu para ' || _novo || '.' || _aviso,
          _uid, coalesce(_nome, 'Equipe'));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_aplicar_update(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_aplicar_update(UUID, TEXT) TO authenticated;

-- a versão com nome de Ludmilla some: o encerramento é do sistema, não dela
DROP FUNCTION IF EXISTS public.ludmilla_encerrar_tarefas_da_etapa(UUID, TEXT, UUID, TEXT);

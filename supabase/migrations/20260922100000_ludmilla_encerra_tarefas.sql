-- ============================================================================
-- LUDMILLA — encerra a tarefa da etapa que o projeto deixou (22/09/2026)
--
-- Pedido do usuário: a regra "entrou em Vistoria solicitada → criar tarefa
-- VERIFICAR VISTORIA" cumpre o papel enquanto o projeto está lá. Quando a
-- Ludmilla traz do portal a atualização seguinte (vistoria aprovada →
-- Concluído, reprovada → Vistoria reprovada, indeferido → Pendência) e a
-- equipe aplica, a tarefa perde o sentido — mas ficava aberta, vencendo.
--
-- Agora, ao aplicar uma recomendação da Ludmilla, toda tarefa AUTOMÁTICA (de
-- regra de etapa) que ainda está aberta e pertence a uma etapa que o projeto
-- já deixou é encerrada, com nota na descrição e aviso ao responsável.
--
-- O que NÃO é tocado: tarefa criada à mão, pedido de vistoria da empresa
-- (`origin = 'vistoria_request'`) e a tarefa da etapa NOVA — que o gatilho
-- `trg_task_automations` acaba de criar nesta mesma transação.
-- ============================================================================

/**
 * Encerra as tarefas de automação de etapa que não correspondem mais à etapa
 * atual do projeto. Devolve quantas foram encerradas.
 *
 * Interna: só é chamada de dentro de funções SECURITY DEFINER da Ludmilla —
 * por isso nenhum GRANT para `authenticated`.
 */
CREATE OR REPLACE FUNCTION public.ludmilla_encerrar_tarefas_da_etapa(
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
    IF _t.assigned_to IS NOT NULL THEN
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_t.tenant_id, _t.assigned_to, '✅ Tarefa encerrada pela Ludmilla',
              _t.title || ' · ' || p_motivo, 'status', p_project_id, FALSE);
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_encerrar_tarefas_da_etapa(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── Aplicar a recomendação passa a encerrar as tarefas da etapa anterior ─────
-- (corpo de 20260914210000, com o trecho novo ao fim)
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

  UPDATE public.projects SET status = _novo::public.project_status WHERE id = _u.project_id;

  UPDATE public.portal_updates
     SET situacao = 'aplicada', aplicada_por = _uid, aplicada_em = now()
   WHERE id = _u.id;

  -- A etapa mudou: a tarefa que existia por causa da etapa anterior (ex.:
  -- "Verificar vistoria") não tem mais o que verificar. O gatilho de
  -- automações já rodou e criou a tarefa da etapa NOVA, que não é tocada.
  IF _novo IS DISTINCT FROM _anterior THEN
    _fechadas := public.ludmilla_encerrar_tarefas_da_etapa(
      _u.project_id, _novo, _uid,
      'Encerrada automaticamente: a Ludmilla leu "' || _u.status_portal || '" no portal e o projeto saiu de '
      || coalesce(_anterior, '—') || ' para ' || _novo || '.');
    IF _fechadas > 0 THEN
      _aviso := E'\n✅ ' || _fechadas || ' tarefa' || CASE WHEN _fechadas > 1 THEN 's automáticas encerradas' ELSE ' automática encerrada' END
              || ' — a etapa que a gerou ficou para trás.';
    END IF;
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

COMMENT ON FUNCTION public.ludmilla_encerrar_tarefas_da_etapa(UUID, TEXT, UUID, TEXT) IS
  'Encerra tarefas de automação de etapa que o projeto já deixou. Chamada ao aplicar uma recomendação da Ludmilla.';

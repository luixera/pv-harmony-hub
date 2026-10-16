-- ============================================================================
-- LUDMILLA — o "Aplicar" volta a gravar o protocolo novo (16/10/2026)
--
-- O defeito: 20260915130000 ensinou `ludmilla_aplicar_update` a trocar o
-- protocolo do cadastro quando o cartão traz `atualizar_protocolo` (projeto
-- reprovado e reenviado sob protocolo NOVO, casado por CPF/UC/titular).
-- 20260922100000 reescreveu a função a partir do corpo de 20260914210000 —
-- anterior a esse ramo — e 20260922140000 herdou a reescrita. Desde 22/09 o
-- "Aplicar" move a etapa mas não grava o protocolo, e o botão "Atualizar
-- protocolo" (cartão sem etapa) cai em "Escolha a etapa".
--
-- A correção, autorizada pelo usuário, é SÓ repor esse ramo. O corpo abaixo é
-- o de 20260922140000 inteiro (contagem de tarefas encerradas, aviso e textos
-- intactos), com o que se perdeu de volta:
--   · a checagem `_novo IS NULL AND NOT _u.atualizar_protocolo`;
--   · o UPDATE de `projects.protocol_number` e o trecho do texto da troca,
--     no comentário e no histórico;
--   · sem etapa, nada de etapa: não conta tarefa, não move o card, e o
--     histórico registra "Protocolo atualizado pelo portal".
-- Cartão SEM troca de protocolo sai exatamente como antes.
--
-- Os cartões já aplicados sem gravar o protocolo NÃO são reprocessados aqui:
-- o usuário decide isso à parte.
-- ============================================================================

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
  _troca    TEXT := '';
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
  -- cartão de troca de protocolo pode ser aplicado sem etapa: só o protocolo muda
  IF _novo IS NULL AND NOT _u.atualizar_protocolo THEN
    RAISE EXCEPTION 'Escolha a etapa para onde mover o projeto.';
  END IF;

  -- protocolo novo de um projeto conhecido (reprovado reenviado): grava no cadastro
  IF _u.atualizar_protocolo THEN
    UPDATE public.projects SET protocol_number = _u.protocolo WHERE id = _u.project_id;
    _troca := '; protocolo do cadastro atualizado de ' || coalesce(_u.protocolo_anterior, '(vazio)')
           || ' para ' || _u.protocolo || ' (casado por ' || coalesce(_u.casamento, '?') || ')';
  END IF;

  SELECT status::text INTO _anterior FROM public.projects WHERE id = _u.project_id;

  -- quantas tarefas de etapa o gatilho vai encerrar com esta mudança — contadas
  -- ANTES, porque depois do UPDATE elas já estarão fechadas
  IF _novo IS NOT NULL AND _novo IS DISTINCT FROM _anterior THEN
    SELECT count(*) INTO _fechadas
      FROM public.tasks k JOIN public.task_automations a ON a.id = k.automation_id
     WHERE k.project_id = _u.project_id AND k.status IN ('pending', 'in_progress')
       AND a.to_status IS DISTINCT FROM _novo;
  END IF;

  IF _novo IS NOT NULL THEN
    UPDATE public.projects SET status = _novo::public.project_status WHERE id = _u.project_id;
  END IF;

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
          CASE WHEN _novo IS NOT NULL
               THEN '📡 Status atualizado a partir do portal (Ludmilla): "' || _u.status_portal || '" → ' || _novo || _troca || '.' || _aviso
               ELSE '📡 Ludmilla: Protocolo ' || _u.protocolo || ' está "' || _u.status_portal || '" no portal' || _troca || '.'
          END,
          'comment');
  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (_u.project_id, CASE WHEN _novo IS NOT NULL THEN 'Status atualizado pelo portal' ELSE 'Protocolo atualizado pelo portal' END,
          'Protocolo ' || _u.protocolo || ' está "' || _u.status_portal || '" no portal' || _troca ||
          CASE WHEN _novo IS NOT NULL
               THEN '; ' || coalesce(_nome, 'a equipe') || ' aplicou a recomendação da Ludmilla e moveu para ' || _novo
               ELSE '' END || '.' || _aviso,
          _uid, coalesce(_nome, 'Equipe'));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_aplicar_update(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_aplicar_update(UUID, TEXT) TO authenticated;

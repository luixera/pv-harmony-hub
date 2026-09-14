-- Ludmilla: aplicar/ignorar uma recomendação e avisar quem cuida do projeto.
--
-- Decisão do usuário: a Ludmilla só RECOMENDA. Quem move o card é uma
-- pessoa, e o histórico registra a pessoa como autora e a Ludmilla como
-- origem. O aviso é o sino (notificação interna) para o projetista do
-- projeto — sem projetista, para os admins.

-- ── Sino: nova recomendação → notificação ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ludmilla_notificar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _proj   public.projects%ROWTYPE;
  _dest   UUID;
  _titulo TEXT;
  _msg    TEXT;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _proj FROM public.projects WHERE id = NEW.project_id;

  _titulo := '📡 Ludmilla: ' || coalesce(_proj.code, 'projeto') || ' mudou no portal';
  _msg := 'No portal o protocolo ' || NEW.protocolo || ' está "' || NEW.status_portal || '"'
       || CASE WHEN NEW.status_anterior IS NOT NULL THEN ' (antes "' || NEW.status_anterior || '")' ELSE '' END
       || CASE WHEN NEW.recomendacao IS NOT NULL THEN '. Recomendação: mover para ' || NEW.recomendacao ELSE '' END
       || '. Confira no relatório da Ludmilla.';

  FOR _dest IN
    SELECT a.staff_user_id FROM public.project_assignments a
      JOIN public.profiles p ON p.id = a.staff_user_id AND p.tenant_id = NEW.tenant_id
     WHERE a.project_id = NEW.project_id
    UNION
    SELECT p.id FROM public.profiles p
     WHERE p.tenant_id = NEW.tenant_id AND p.role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM public.project_assignments a WHERE a.project_id = NEW.project_id)
  LOOP
    INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
    VALUES (NEW.tenant_id, _dest, _titulo, _msg, 'ludmilla', NEW.project_id, FALSE);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ludmilla_notificar ON public.portal_updates;
CREATE TRIGGER trg_ludmilla_notificar
  AFTER INSERT ON public.portal_updates
  FOR EACH ROW EXECUTE FUNCTION public.fn_ludmilla_notificar();

-- ── Aplicar: a pessoa confirma, o card move ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_aplicar_update(p_update_id UUID, p_status TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid    UUID := (select auth.uid());
  _u      public.portal_updates%ROWTYPE;
  _novo   TEXT;
  _nome   TEXT;
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

  UPDATE public.projects SET status = _novo::public.project_status WHERE id = _u.project_id;

  UPDATE public.portal_updates
     SET situacao = 'aplicada', aplicada_por = _uid, aplicada_em = now()
   WHERE id = _u.id;

  SELECT name INTO _nome FROM public.profiles WHERE id = _uid;
  INSERT INTO public.comments (project_id, user_id, message, type)
  VALUES (_u.project_id, _uid,
          '📡 Status atualizado a partir do portal (Ludmilla): "' || _u.status_portal || '" → ' || _novo || '.',
          'comment');
  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (_u.project_id, 'Status atualizado pelo portal',
          'Protocolo ' || _u.protocolo || ' está "' || _u.status_portal || '" no portal; ' ||
          coalesce(_nome, 'a equipe') || ' aplicou a recomendação da Ludmilla e moveu para ' || _novo || '.',
          _uid, coalesce(_nome, 'Equipe'));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_aplicar_update(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_aplicar_update(UUID, TEXT) TO authenticated;

-- ── Ignorar ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_ignorar_update(p_update_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid());
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  UPDATE public.portal_updates
     SET situacao = 'ignorada', aplicada_por = _uid, aplicada_em = now()
   WHERE id = p_update_id AND tenant_id = public.get_user_tenant_id(_uid) AND situacao = 'pendente';
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_ignorar_update(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_ignorar_update(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════
-- Trigger: enforce server-side identity in project_history
-- Date: 2026-05-26
-- Reason: client-side inserts allow spoofing user_id/user_name
--         even with current RLS, since policies only validate
--         row visibility, not column values. This trigger
--         overwrites both fields with auth.uid() + profile name
--         for any authenticated insert. Anonymous (public form)
--         inserts keep nulls / caller-supplied values for
--         backward compatibility with PublicProjectForm.
-- ══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_project_history_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NOT NULL THEN
    NEW.user_id := v_uid;
    SELECT name INTO v_name FROM public.profiles WHERE id = v_uid;
    NEW.user_name := COALESCE(
      v_name,
      (SELECT email FROM auth.users WHERE id = v_uid)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_identity ON public.project_history;
CREATE TRIGGER enforce_identity
  BEFORE INSERT ON public.project_history
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_project_history_identity();

COMMENT ON FUNCTION public.enforce_project_history_identity() IS
'Overwrites user_id and user_name with the authenticated user identity. Closes audit-log spoofing path opened by client-side inserts in src/hooks/useProjects.ts and src/pages/NewProject.tsx.';

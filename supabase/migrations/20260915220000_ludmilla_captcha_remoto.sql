-- ============================================================================
-- LUDMILLA — CAPTCHA remoto pela equipe e sessão viva (15/09/2026)
--
-- O Portal GD da Elektro pede um código de imagem no login. A Ludmilla NÃO
-- resolve o código: uma pessoa resolve. O que muda aqui é ONDE a pessoa
-- está — a estação fotografa o código, sobe no bucket, avisa a equipe pelo
-- sino, e quem responder primeiro (na /ludmilla, do celular que seja) digita
-- os caracteres; a estação lê a resposta e envia o formulário.
--
-- Sessão viva: a estação mantém o Chrome aberto e toca o portal a cada
-- 10 min; `sessao_viva_desde` mostra na página desde quando está logada.
--
-- Spec: docs/superpowers/specs/2026-09-15-ludmilla-captcha-remoto-design.md
-- ============================================================================

-- ── Tabela ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_captchas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  run_id         UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  -- bucket `ludmilla`: {tenant}/captcha/{id}.png
  imagem_path    TEXT NOT NULL,
  situacao       TEXT NOT NULL DEFAULT 'aguardando'
                 CHECK (situacao IN ('aguardando', 'respondido', 'usado', 'recusado', 'expirado', 'cancelado')),
  -- o que a pessoa digitou: 4–8 caracteres de uma imagem descartável, não é segredo
  resposta       TEXT,
  respondido_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  respondido_em  TIMESTAMPTZ,
  -- 1ª, 2ª, 3ª foto da mesma visita (o portal recusou as anteriores)
  tentativa      INTEGER NOT NULL DEFAULT 1 CHECK (tentativa BETWEEN 1 AND 5),
  -- o que o portal disse da rodada anterior ("Código inválido")
  mensagem       TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes'
);
CREATE INDEX IF NOT EXISTS idx_portal_captchas_aguardando
  ON public.portal_captchas (tenant_id, criado_em DESC) WHERE situacao = 'aguardando';
CREATE INDEX IF NOT EXISTS idx_portal_captchas_account ON public.portal_captchas (account_id, criado_em DESC);

ALTER TABLE public.portal_captchas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.portal_captchas;
CREATE POLICY tenant_isolation ON public.portal_captchas AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
-- a equipe lê (é quem responde); escrita só por RPC
DROP POLICY IF EXISTS equipe_le_captchas ON public.portal_captchas;
CREATE POLICY equipe_le_captchas ON public.portal_captchas FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));
GRANT SELECT ON public.portal_captchas TO authenticated;

-- ── Sessão viva na conta ─────────────────────────────────────────────────────
ALTER TABLE public.portal_accounts ADD COLUMN IF NOT EXISTS sessao_viva_desde TIMESTAMPTZ;

-- service role (VPS) OU operador da estação desta conta
CREATE OR REPLACE FUNCTION public.ludmilla_robo_ok(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (select auth.role()) = 'service_role' OR public.ludmilla_operador_ok(p_account_id);
$$;

CREATE OR REPLACE FUNCTION public.ludmilla_sessao_viva(p_account_id UUID, p_viva BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.ludmilla_robo_ok(p_account_id) THEN
    RAISE EXCEPTION 'permission denied: só o robô desta conta marca a sessão';
  END IF;
  UPDATE public.portal_accounts
     SET sessao_viva_desde = CASE WHEN p_viva THEN coalesce(sessao_viva_desde, now()) ELSE NULL END
   WHERE id = p_account_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_sessao_viva(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_sessao_viva(UUID, BOOLEAN) TO authenticated, service_role;

-- ── Robô: pedir, ler, fechar ─────────────────────────────────────────────────
-- Cria o pedido e avisa a equipe do tenant (admin + staff) pelo sino.
CREATE OR REPLACE FUNCTION public.ludmilla_captcha_pedir(
  p_run_id UUID, p_imagem_path TEXT, p_tentativa INTEGER DEFAULT 1, p_mensagem TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _run public.portal_sync_runs%ROWTYPE; _id UUID; _dest UUID; _portal TEXT;
BEGIN
  SELECT * INTO _run FROM public.portal_sync_runs WHERE id = p_run_id;
  IF _run.id IS NULL OR NOT public.ludmilla_robo_ok(_run.account_id) THEN
    RAISE EXCEPTION 'permission denied: só o robô desta conta pede código';
  END IF;
  -- um pedido aberto por vez por conta: o anterior fecha como cancelado
  UPDATE public.portal_captchas SET situacao = 'cancelado'
   WHERE account_id = _run.account_id AND situacao = 'aguardando';

  INSERT INTO public.portal_captchas (tenant_id, account_id, run_id, imagem_path, tentativa, mensagem)
  VALUES (_run.tenant_id, _run.account_id, p_run_id, p_imagem_path, greatest(1, least(5, coalesce(p_tentativa, 1))), p_mensagem)
  RETURNING id INTO _id;

  SELECT upper(a.connector) INTO _portal FROM public.portal_accounts a WHERE a.id = _run.account_id;
  -- sino só na 1ª foto da visita: nas seguintes a pessoa já está na página
  IF coalesce(p_tentativa, 1) = 1 THEN
    FOR _dest IN SELECT p.id FROM public.profiles p WHERE p.tenant_id = _run.tenant_id AND p.role IN ('admin', 'staff') AND p.active LOOP
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_run.tenant_id, _dest, '📡 Ludmilla precisa do código da ' || coalesce(_portal, 'concessionária'),
              'Abra a Ludmilla e digite o código da imagem — vale 5 minutos. Quem responder primeiro libera a visita.',
              'ludmilla', NULL, FALSE);
    END LOOP;
  END IF;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_captcha_pedir(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_captcha_pedir(UUID, TEXT, INTEGER, TEXT) TO authenticated, service_role;

-- Situação e (quando houver) a resposta. Vencido sem resposta → marca expirado.
CREATE OR REPLACE FUNCTION public.ludmilla_captcha_ler(p_captcha_id UUID)
RETURNS TABLE (situacao TEXT, resposta TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _c public.portal_captchas%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.portal_captchas WHERE id = p_captcha_id;
  IF _c.id IS NULL OR NOT public.ludmilla_robo_ok(_c.account_id) THEN
    RAISE EXCEPTION 'permission denied: só o robô desta conta lê o código';
  END IF;
  IF _c.situacao = 'aguardando' AND _c.expira_em < now() THEN
    UPDATE public.portal_captchas SET situacao = 'expirado' WHERE id = _c.id;
    _c.situacao := 'expirado';
  END IF;
  RETURN QUERY SELECT _c.situacao, CASE WHEN _c.situacao = 'respondido' THEN _c.resposta END;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_captcha_ler(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_captcha_ler(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ludmilla_captcha_fechar(p_captcha_id UUID, p_situacao TEXT, p_mensagem TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID;
BEGIN
  SELECT account_id INTO _account FROM public.portal_captchas WHERE id = p_captcha_id;
  IF _account IS NULL OR NOT public.ludmilla_robo_ok(_account) THEN
    RAISE EXCEPTION 'permission denied: só o robô desta conta fecha o código';
  END IF;
  IF p_situacao NOT IN ('usado', 'recusado', 'expirado', 'cancelado') THEN
    RAISE EXCEPTION 'situação inválida: %', p_situacao;
  END IF;
  UPDATE public.portal_captchas SET situacao = p_situacao, mensagem = coalesce(p_mensagem, mensagem)
   WHERE id = p_captcha_id AND situacao IN ('aguardando', 'respondido');
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_captcha_fechar(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_captcha_fechar(UUID, TEXT, TEXT) TO authenticated, service_role;

-- ── Equipe: responder ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_captcha_responder(p_captcha_id UUID, p_resposta TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _c public.portal_captchas%ROWTYPE; _resp TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  _resp := regexp_replace(coalesce(p_resposta, ''), '\s', '', 'g');
  IF length(_resp) < 2 OR length(_resp) > 12 THEN
    RAISE EXCEPTION 'Digite os caracteres da imagem (2 a 12).';
  END IF;
  SELECT * INTO _c FROM public.portal_captchas
   WHERE id = p_captcha_id AND tenant_id = public.get_user_tenant_id(_uid)
   FOR UPDATE;
  IF _c.id IS NULL THEN
    RAISE EXCEPTION 'Pedido de código não encontrado.';
  END IF;
  IF _c.situacao <> 'aguardando' THEN
    RAISE EXCEPTION 'Este código já foi respondido ou não vale mais.';
  END IF;
  IF _c.expira_em < now() THEN
    UPDATE public.portal_captchas SET situacao = 'expirado' WHERE id = _c.id;
    RAISE EXCEPTION 'O prazo deste código passou (5 min). A Ludmilla pede outro na próxima visita.';
  END IF;
  UPDATE public.portal_captchas
     SET situacao = 'respondido', resposta = _resp, respondido_por = _uid, respondido_em = now()
   WHERE id = _c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_captcha_responder(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_captcha_responder(UUID, TEXT) TO authenticated;

-- ── Bucket: o operador apaga a foto do código depois de usar ─────────────────
DROP POLICY IF EXISTS ludmilla_estacao_apaga_captcha ON storage.objects;
CREATE POLICY ludmilla_estacao_apaga_captcha ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ludmilla'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::text
    AND (storage.foldername(name))[2] = 'captcha'
    AND EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.modo = 'local' AND a.operador_local = (select auth.uid()))
  );

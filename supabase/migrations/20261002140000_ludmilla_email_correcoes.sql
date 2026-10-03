-- supabase/migrations/20261002140000_ludmilla_email_correcoes.sql
-- Ludmilla (e-mail): correções da revisão sobre 20261002120000 e 20261002130000
-- (as duas já estão aplicadas em produção — por isso uma migração nova).

-- ── C1. O isolamento de tenant lê o tenant do PERFIL, não do JWT ──────────────
-- As políticas RESTRICTIVE `*_tenant` filtravam por
-- auth.jwt() -> 'app_metadata' ->> 'tenant_id'. Mas 11 dos 19 usuários do tenant
-- GD Manager — inclusive o único admin — não têm `tenant_id` em
-- raw_app_meta_data (só `provider`/`providers`). Para eles a política virava
-- `tenant_id = NULL` e negava tudo em silêncio: a tela de regras nasceria vazia
-- e o admin não conseguiria editar nada.
-- As irmãs (portal_accounts, portal_updates, portal_anexos) usam
-- get_user_tenant_id((select auth.uid())), que lê profiles.tenant_id. É a forma
-- copiada aqui, sem cláusula TO, como nelas. O tenant continua vindo de fonte
-- confiável (o perfil), nunca de user_metadata.
DROP POLICY IF EXISTS portal_email_regras_tenant ON public.portal_email_regras;
CREATE POLICY portal_email_regras_tenant ON public.portal_email_regras AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));

DROP POLICY IF EXISTS portal_email_mensagens_tenant ON public.portal_email_mensagens;
CREATE POLICY portal_email_mensagens_tenant ON public.portal_email_mensagens AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));

-- ── I1. ludmilla_email_anexo_novo não pode estourar em anexo repetido ─────────
-- portal_anexos tem UNIQUE (account_id, id_arquivo). Sem tratar o conflito, o
-- INSERT dava 23505 e derrubava o run inteiro — e de novo em todo run seguinte —
-- quando (a) o worker caía depois de criar o anexo e antes de registrar a
-- mensagem, ou (b) um e-mail trazia dois anexos de mesmo nome (image001.png de
-- assinatura). Agora o conflito vira "nada a fazer": a função devolve vazio e o
-- worker pula o anexo. Mesma assinatura, mesma ordem de parâmetros, mesmo retorno.
CREATE OR REPLACE FUNCTION public.ludmilla_email_anexo_novo(
  p_account_id UUID, p_protocolo TEXT, p_project_id UUID,
  p_message_id TEXT, p_nome_arquivo TEXT, p_conferido_por TEXT
) RETURNS TABLE (anexo_id UUID, company_id UUID, codigo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _proj public.projects%ROWTYPE; _id UUID;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra anexos de e-mail';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  SELECT * INTO _proj  FROM public.projects WHERE id = p_project_id AND tenant_id = _conta.tenant_id;
  IF _proj.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.portal_anexos
    (tenant_id, account_id, protocolo, project_id, id_arquivo, nome_arquivo, situacao, conferido_por)
  VALUES
    (_conta.tenant_id, p_account_id, p_protocolo, p_project_id,
     p_message_id || '#' || p_nome_arquivo, p_nome_arquivo, 'pendente', p_conferido_por)
  ON CONFLICT (account_id, id_arquivo) DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NULL THEN RETURN; END IF;

  RETURN QUERY SELECT _id, _proj.company_id, _proj.code;
END;
$$;

-- ── M1. O motivo da divergência vai no `raw` da recomendação ──────────────────
-- A spec diz que divergência de conferência "levanta a mão na /ludmilla", mas o
-- motivo só ficava em portal_email_mensagens, que a tela não mostra. Agora também
-- vai em portal_updates.raw (acrescenta 'motivo'; resto da função inalterado;
-- mesma assinatura).
CREATE OR REPLACE FUNCTION public.ludmilla_email_registrar(
  p_run_id UUID, p_account_id UUID, p_message_id TEXT, p_protocolo TEXT,
  p_project_id UUID, p_assunto TEXT, p_remetente TEXT, p_recebido_em TIMESTAMPTZ,
  p_tipo_documento TEXT, p_veredito TEXT, p_resumo TEXT, p_anexos INTEGER,
  p_motivo TEXT, p_recomendacao TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _msg UUID; _proj public.projects%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra e-mails lidos';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;

  INSERT INTO public.portal_email_mensagens
    (tenant_id, account_id, run_id, message_id, protocolo, project_id, assunto, remetente,
     recebido_em, tipo_documento, veredito, resumo, anexos, motivo)
  VALUES
    (_conta.tenant_id, p_account_id, p_run_id, p_message_id, p_protocolo, p_project_id,
     left(p_assunto, 300), left(p_remetente, 200), p_recebido_em, p_tipo_documento,
     p_veredito, left(p_resumo, 2000), coalesce(p_anexos, 0), left(p_motivo, 500))
  ON CONFLICT (account_id, message_id) DO NOTHING
  RETURNING id INTO _msg;
  IF _msg IS NULL THEN RETURN NULL; END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT * INTO _proj FROM public.projects WHERE id = p_project_id;
    INSERT INTO public.portal_updates
      (tenant_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
       project_id, casamento, recomendacao, situacao, detectado_em, raw)
    VALUES
      (_conta.tenant_id, p_account_id, p_protocolo, NULL,
       upper(coalesce(p_tipo_documento, 'e-mail')) ||
         coalesce(' · ' || upper(p_veredito), ''),
       _proj.status::text, p_project_id, 'protocolo', p_recomendacao, 'pendente', now(),
       jsonb_build_object('assunto', p_assunto, 'remetente', p_remetente,
                          'resumo', p_resumo, 'anexos', coalesce(p_anexos, 0),
                          'motivo', p_motivo));
  END IF;
  RETURN _msg;
END;
$$;

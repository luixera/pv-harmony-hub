-- supabase/migrations/20261002120000_ludmilla_email_edp.sql
-- Ludmilla: segundo meio de acompanhamento — o E-MAIL — estreando na EDP.
-- Spec: docs/superpowers/specs/2026-10-02-ludmilla-edp-email-design.md

-- ── 1. Como a conta é acompanhada (ortogonal a `modo`, que diz ONDE roda) ─────
ALTER TABLE public.portal_accounts
  ADD COLUMN IF NOT EXISTS acompanhamento TEXT NOT NULL DEFAULT 'portal';
ALTER TABLE public.portal_accounts
  DROP CONSTRAINT IF EXISTS portal_accounts_acompanhamento_check;
ALTER TABLE public.portal_accounts
  ADD CONSTRAINT portal_accounts_acompanhamento_check
  CHECK (acompanhamento IN ('portal', 'email'));
COMMENT ON COLUMN public.portal_accounts.acompanhamento IS
  'portal = a Ludmilla entra no site; email = ela lê a caixa. CPFL portal+vps, EDP email+vps, Elektro portal+local.';

-- ── 2. A EDP é um conector válido ────────────────────────────────────────────
ALTER TABLE public.portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_connector_check;
ALTER TABLE public.portal_accounts
  ADD CONSTRAINT portal_accounts_connector_check
  CHECK (connector IN ('cpfl', 'elektro', 'edp'));

-- ── 3. O novo tipo de run ────────────────────────────────────────────────────
ALTER TABLE public.portal_sync_runs DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;
ALTER TABLE public.portal_sync_runs
  ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'descoberta', 'varredura', 'criar_projeto', 'varredura_email'));

-- ── 4. Conferência por protocolo/titular/endereço, além de cpf/uc ────────────
ALTER TABLE public.portal_anexos DROP CONSTRAINT IF EXISTS portal_anexos_conferido_por_check;
ALTER TABLE public.portal_anexos
  ADD CONSTRAINT portal_anexos_conferido_por_check
  CHECK (conferido_por IS NULL OR conferido_por IN ('cpf', 'uc', 'protocolo', 'titular', 'endereco'));

-- ── 5. Regras de leitura por concessionária (editáveis na tela) ──────────────
CREATE TABLE IF NOT EXISTS public.portal_email_regras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  remetente      TEXT,
  assunto        TEXT NOT NULL,
  tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('parecer', 'carta_obras', 'nota', 'outro')),
  anexar         BOOLEAN NOT NULL DEFAULT TRUE,
  ler_pdf        BOOLEAN NOT NULL DEFAULT FALSE,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  ordem          INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_email_regras_conta ON public.portal_email_regras (account_id) WHERE ativo;

-- ── 6. O que já foi lido — nunca reprocessar o mesmo e-mail ──────────────────
CREATE TABLE IF NOT EXISTS public.portal_email_mensagens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  run_id         UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  message_id     TEXT NOT NULL,
  protocolo      TEXT NOT NULL,
  project_id     UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  assunto        TEXT,
  remetente      TEXT,
  recebido_em    TIMESTAMPTZ,
  tipo_documento TEXT,
  veredito       TEXT CHECK (veredito IS NULL OR veredito IN ('favoravel', 'pendencia', 'inconclusivo')),
  resumo         TEXT,
  anexos         INTEGER NOT NULL DEFAULT 0,
  motivo         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_email_mensagens_unica UNIQUE (account_id, message_id)
);

-- ── 7. RLS: só a equipe do tenant vê; o robô entra por service role ──────────
ALTER TABLE public.portal_email_regras    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_email_mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_email_regras_tenant ON public.portal_email_regras
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
CREATE POLICY portal_email_regras_leitura ON public.portal_email_regras
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY portal_email_mensagens_tenant ON public.portal_email_mensagens
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));
CREATE POLICY portal_email_mensagens_leitura ON public.portal_email_mensagens
  FOR SELECT TO authenticated USING (TRUE);

-- ── 8. RPCs do robô (só service role) ────────────────────────────────────────

-- credencial da caixa: a MESMA do Claudinho (agent_config do tenant da conta)
CREATE OR REPLACE FUNCTION public.ludmilla_email_credencial(p_account_id UUID)
RETURNS TABLE (email TEXT, senha TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.gmail_email, c.gmail_app_password
    FROM public.portal_accounts a
    JOIN public.agent_config c ON c.tenant_id = a.tenant_id
   WHERE a.id = p_account_id
     AND c.config_key = 'email_agent' AND c.is_active
     AND (SELECT auth.role()) = 'service_role'
   LIMIT 1;
$$;

-- protocolos a procurar, com o que serve de conferência.
-- Protocolo repetido em dois projetos do mesmo tenant fica DE FORA: com dois
-- candidatos não dá para saber de quem é o parecer (spec §6, ambiguidade).
CREATE OR REPLACE FUNCTION public.ludmilla_email_protocolos(p_account_id UUID)
RETURNS TABLE (protocolo TEXT, project_id UUID, company_id UUID, codigo TEXT, titular TEXT, endereco TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  WITH ativos AS (
    SELECT p.id, p.code, p.company_id, p.protocol_number, p.created_at, p.tenant_id,
           regexp_replace(ltrim(regexp_replace(p.protocol_number, '\D', '', 'g'), '0'), '^$', 'x') AS chave
      FROM public.portal_accounts a
      JOIN public.projects p
        ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
     WHERE a.id = p_account_id
       AND (SELECT auth.role()) = 'service_role'
       AND NOT p.is_deleted AND p.archived_at IS NULL
       AND p.status::text <> 'completed'
       AND coalesce(p.protocol_number, '') <> ''
  ),
  unicos AS (
    SELECT chave FROM ativos GROUP BY chave HAVING count(*) = 1
  )
  SELECT t.protocol_number, t.id, t.company_id, t.code, g.holder_name,
         trim(coalesce(g.address, '') || ' ' || coalesce(g.address_number, ''))
    FROM ativos t
    JOIN unicos u ON u.chave = t.chave
    LEFT JOIN public.project_general_data g ON g.project_id = t.id
   ORDER BY t.created_at DESC
   LIMIT 80;
$$;

CREATE OR REPLACE FUNCTION public.ludmilla_email_regras(p_account_id UUID)
RETURNS TABLE (id UUID, remetente TEXT, assunto TEXT, tipo_documento TEXT, anexar BOOLEAN, ler_pdf BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT r.id, r.remetente, r.assunto, r.tipo_documento, r.anexar, r.ler_pdf
    FROM public.portal_email_regras r
   WHERE r.account_id = p_account_id AND r.ativo
     AND (SELECT auth.role()) = 'service_role'
   ORDER BY r.ordem, r.created_at;
$$;

CREATE OR REPLACE FUNCTION public.ludmilla_email_mensagem_nova(p_account_id UUID, p_message_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT (SELECT auth.role()) = 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.portal_email_mensagens m
        WHERE m.account_id = p_account_id AND m.message_id = p_message_id);
$$;

-- abre o anexo como pendente e devolve o que subirDocumento precisa
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
  RETURNING id INTO _id;

  RETURN QUERY SELECT _id, _proj.company_id, _proj.code;
END;
$$;

-- registra o e-mail lido e, quando houver etapa recomendada, a recomendação
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
                          'resumo', p_resumo, 'anexos', coalesce(p_anexos, 0)));
  END IF;
  RETURN _msg;
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_email_credencial(UUID)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_protocolos(UUID)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_regras(UUID)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_mensagem_nova(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ludmilla_email_registrar(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ludmilla_email_credencial(UUID)      TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_protocolos(UUID)      TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_regras(UUID)          TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_mensagem_nova(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_registrar(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO service_role;

-- ── 9. A conta da EDP e as regras observadas em set–out/2026 ─────────────────
-- A concessionária EDP com projetos é a que tem mais projetos ativos no tenant.
INSERT INTO public.portal_accounts (tenant_id, concessionaire_id, connector, acompanhamento, modo, situacao, enabled)
SELECT c.tenant_id, c.id, 'edp', 'email', 'vps', 'ok', TRUE
  FROM public.energy_concessionaires c
 WHERE c.name ILIKE '%elektro%' IS NOT TRUE AND c.name ILIKE 'EDP%'
   AND (SELECT count(*) FROM public.projects p
         WHERE p.concessionaire_id = c.id AND NOT p.is_deleted AND p.archived_at IS NULL) > 0
   AND NOT EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.concessionaire_id = c.id)
 ORDER BY (SELECT count(*) FROM public.projects p WHERE p.concessionaire_id = c.id) DESC
 LIMIT 1;

INSERT INTO public.portal_email_regras (tenant_id, account_id, remetente, assunto, tipo_documento, anexar, ler_pdf, ordem)
SELECT a.tenant_id, a.id, r.remetente, r.assunto, r.tipo, r.anexar, r.ler, r.ordem
  FROM public.portal_accounts a
 CROSS JOIN (VALUES
   ('relacionamento.edp',   'ENVIO DE PARECER', 'parecer',     TRUE,  TRUE,  1),
   ('edpdocumentoporemail', 'CARTA DE OBRAS',   'carta_obras', TRUE,  FALSE, 2),
   (NULL,                   'NOTA -',           'nota',        TRUE,  FALSE, 3)
 ) AS r(remetente, assunto, tipo, anexar, ler, ordem)
 WHERE a.connector = 'edp'
   AND NOT EXISTS (SELECT 1 FROM public.portal_email_regras x WHERE x.account_id = a.id);

-- Ludmilla: run do tipo `criar_projeto` + tabela de passos + node ID.
--
-- Alterações neste arquivo:
--   1. Adiciona `dados jsonb` a portal_sync_runs (project_id e demais extras do run)
--   2. Amplia CHECK de tipo para incluir 'criar_projeto'
--   3. Atualiza ludmilla_pedir_run para aceitar p_dados
--   4. Nova tabela portal_criacao_passos
--   5. Nova coluna projects.cpfl_node_id
--   6. RPCs: ludmilla_registrar_passo_criacao, ludmilla_salvar_node_cpfl,
--            ludmilla_dados_criacao_cpfl

-- ── 1. Campo dados em portal_sync_runs ────────────────────────────────────────
ALTER TABLE public.portal_sync_runs
  ADD COLUMN IF NOT EXISTS dados JSONB;

-- ── 2. CHECK de tipo ──────────────────────────────────────────────────────────
ALTER TABLE public.portal_sync_runs
  DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;

ALTER TABLE public.portal_sync_runs
  ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'descoberta', 'varredura', 'criar_projeto'));

COMMENT ON COLUMN public.portal_sync_runs.tipo IS
  'reconhecimento=mapeia o login | teste_login=testa credencial | descoberta=explora HTML | varredura=lê protocolos | criar_projeto=cria projeto no portal';

-- ── 3. ludmilla_pedir_run com p_dados ────────────────────────────────────────
-- Remove assinatura antiga e recria com o parâmetro novo.
-- A assinatura antiga (p_account_id, p_tipo) não empilhava por tipo+conta;
-- a nova também não empilha, mas guarda dados extras (ex. project_id).
DROP FUNCTION IF EXISTS public.ludmilla_pedir_run(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.ludmilla_pedir_run(
  p_account_id UUID,
  p_tipo       TEXT DEFAULT 'varredura',
  p_dados      JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid    UUID := (SELECT auth.uid());
  _tenant UUID;
  _run    UUID;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;

  _tenant := public.get_user_tenant_id(_uid);

  IF NOT EXISTS (
    SELECT 1 FROM public.portal_accounts
    WHERE id = p_account_id AND tenant_id = _tenant
  ) THEN
    RAISE EXCEPTION 'Conta de portal não encontrada.';
  END IF;

  -- Não empilha: run igual já na fila é o mesmo pedido.
  -- Para criar_projeto, considera também o project_id para não duplicar.
  IF p_tipo = 'criar_projeto' AND p_dados IS NOT NULL THEN
    SELECT id INTO _run
    FROM public.portal_sync_runs
    WHERE account_id = p_account_id
      AND tipo       = p_tipo
      AND situacao   IN ('na_fila', 'rodando')
      AND dados->>'project_id' = p_dados->>'project_id'
    LIMIT 1;
  ELSE
    SELECT id INTO _run
    FROM public.portal_sync_runs
    WHERE account_id = p_account_id
      AND tipo       = p_tipo
      AND situacao   IN ('na_fila', 'rodando')
    LIMIT 1;
  END IF;

  IF _run IS NOT NULL THEN RETURN _run; END IF;

  INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo, pedido_por, dados)
  VALUES (_tenant, p_account_id, p_tipo, _uid, p_dados)
  RETURNING id INTO _run;

  RETURN _run;
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_pedir_run(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedir_run(UUID, TEXT, JSONB)
  TO authenticated, service_role;

-- ── 4. Tabela portal_criacao_passos ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_criacao_passos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES public.portal_sync_runs(id) ON DELETE CASCADE,
  passo       INTEGER NOT NULL,   -- 1..6
  nome        TEXT NOT NULL,      -- 'introducao'|'dados_uc'|'dados_projeto'|'dados_cliente'|'revisao'|'concluido'
  status      TEXT NOT NULL CHECK (status IN ('rodando', 'ok', 'erro')),
  screenshot  TEXT,               -- caminho no bucket ludmilla
  erro        TEXT,               -- mensagem em português
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_criacao_passos_run_passo_unique UNIQUE (run_id, passo)
);

CREATE INDEX IF NOT EXISTS idx_criacao_passos_run
  ON public.portal_criacao_passos (run_id, passo);

-- RLS: equipe lê; INSERT/UPDATE só service_role (sem policy pública = bloqueado)
ALTER TABLE public.portal_criacao_passos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipe le passos de criacao"
  ON public.portal_criacao_passos FOR SELECT
  USING (public.ludmilla_equipe_ok());

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_criacao_passos;

-- ── 5. projects.cpfl_node_id ──────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cpfl_node_id TEXT;

-- ── 6a. RPC registrar passo ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_registrar_passo_criacao(
  p_run_id     UUID,
  p_passo      INTEGER,
  p_nome       TEXT,
  p_status     TEXT,
  p_screenshot TEXT DEFAULT NULL,
  p_erro       TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.portal_criacao_passos
    (run_id, passo, nome, status, screenshot, erro)
  VALUES
    (p_run_id, p_passo, p_nome, p_status, p_screenshot, p_erro)
  ON CONFLICT (run_id, passo) DO UPDATE
    SET status     = EXCLUDED.status,
        screenshot = EXCLUDED.screenshot,
        erro       = EXCLUDED.erro;
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_registrar_passo_criacao(UUID,INTEGER,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_registrar_passo_criacao(UUID,INTEGER,TEXT,TEXT,TEXT,TEXT)
  TO service_role;

-- ── 6b. RPC salvar node ID ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_salvar_node_cpfl(
  p_project_id UUID,
  p_node_id    TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.projects
  SET    cpfl_node_id = p_node_id
  WHERE  id = p_project_id
    AND  tenant_id = (
      SELECT pa.tenant_id
      FROM   public.portal_sync_runs psr
      JOIN   public.portal_accounts  pa ON pa.id = psr.account_id
      WHERE  psr.dados->>'project_id' = p_project_id::TEXT
      ORDER  BY psr.created_at DESC
      LIMIT  1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_salvar_node_cpfl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_salvar_node_cpfl(UUID, TEXT)
  TO service_role;

-- ── 6c. RPC ler dados para criação ───────────────────────────────────────────
-- Chamada pelo worker para montar DadosCriacaoCpfl antes de acionar cpfl-criar.
CREATE OR REPLACE FUNCTION public.ludmilla_dados_criacao_cpfl(
  p_run_id     UUID,
  p_project_id UUID
) RETURNS TABLE (
  uc_number     TEXT,
  coordinates   TEXT,
  customer_name TEXT,
  customer_cpf  TEXT,
  project_title TEXT,
  modulos       JSONB,
  entry_phase   TEXT,
  entry_breaker TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    pgd.uc_number                                          AS uc_number,
    pgd.coordinates                                        AS coordinates,
    pgd.holder_name                                        AS customer_name,
    pgd.holder_cpf_cnpj                                    AS customer_cpf,
    COALESCE('UFV ' || pgd.holder_name, p.code)           AS project_title,
    COALESCE(
      jsonb_build_array(
        jsonb_build_object(
          'quantidade',  pe.module_quantity,
          'potencia_wp', pe.module_power
        )
      ),
      '[]'::jsonb
    )                                                      AS modulos,
    pgd.phase_type                                         AS entry_phase,
    pgd.circuit_breaker_current                            AS entry_breaker
  FROM  public.portal_sync_runs      psr
  JOIN  public.projects              p   ON p.id  = p_project_id
  JOIN  public.project_general_data  pgd ON pgd.project_id = p.id
  LEFT JOIN public.project_equipment pe  ON pe.project_id  = p.id
  WHERE psr.id = p_run_id
    AND (SELECT auth.role()) = 'service_role'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_dados_criacao_cpfl(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_dados_criacao_cpfl(UUID, UUID)
  TO service_role;

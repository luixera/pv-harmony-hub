-- ============================================================================
-- UNIDADES BENEFICIÁRIAS COMO DADO (22/10/2026)
--
-- Spec: docs/superpowers/specs/2026-10-22-beneficiarias-autoconsumo-remoto-design.md
--
-- Até aqui beneficiária era um booleano (`project_general_data.has_beneficiaries`)
-- e um upload múltiplo de contas. Para a Ludmilla criar o projeto na CPFL em
-- AUTOCONSUMO REMOTO o portal pede, por beneficiária, o número da UC e o
-- percentual de rateio — e recusa UC de outro titular e soma que não fecha
-- em 100%. Tudo isso passa a ser conferido AQUI, antes de o robô começar.
--
-- O dado é genérico (não sabe de CPFL — "estamos deixando preparado para
-- outras concessionárias", usuário 22/10). Só a RPC da Ludmilla é CPFL.
--
-- Decisões do usuário: a empresa integradora edita até o projeto entrar em
-- análise; a equipe edita até a criação na CPFL (`projects.cpfl_node_id`);
-- depois, ninguém — a trava é do banco, a tela só a reflete.
-- ============================================================================

-- ── 1. A tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_beneficiaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- normalizado: só dígitos. A tela formata; o portal da CPFL mostra assim.
  uc_number       TEXT NOT NULL CHECK (uc_number ~ '^[0-9]+$'),
  -- 4 casas, como o portal ("70,0000%"). A geradora NÃO é linha: é o resto.
  percent         NUMERIC(7,4) NOT NULL CHECK (percent > 0 AND percent <= 100),
  holder_name     TEXT,
  holder_doc      TEXT,
  address         TEXT,
  -- a foto da conta, opcional (decisão do usuário)
  document_id     UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  -- digitado | lido_da_conta | confirmado_no_portal
  origin          TEXT NOT NULL DEFAULT 'digitado'
                  CHECK (origin IN ('digitado', 'lido_da_conta', 'confirmado_no_portal')),
  -- o titular lido da conta difere do titular da geradora: o portal recusa
  holder_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  -- ordem de cadastro = ordem em que a Ludmilla digita
  position        SMALLINT NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, uc_number)
);
CREATE INDEX IF NOT EXISTS project_beneficiaries_project_idx
  ON public.project_beneficiaries (project_id, position);
CREATE INDEX IF NOT EXISTS project_beneficiaries_tenant_idx
  ON public.project_beneficiaries (tenant_id);

COMMENT ON TABLE public.project_beneficiaries IS
  'Unidades beneficiárias do autoconsumo remoto. Uma linha por UC; a geradora '
  'não é linha (ela fica com 100 − soma). Formato da UC validado no front por '
  'concessionária; aqui só dígitos.';

-- ── 2. Gatilhos ─────────────────────────────────────────────────────────────
-- (a) tenant vem do projeto, sempre — o formulário público não tem sessão
--     para informá-lo, e ninguém pode escolher outro.
CREATE OR REPLACE FUNCTION public.fn_beneficiaria_antes()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _tenant UUID;
  _soma   NUMERIC;
BEGIN
  SELECT p.tenant_id INTO _tenant FROM public.projects p WHERE p.id = NEW.project_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'Projeto não encontrado para a beneficiária.';
  END IF;
  NEW.tenant_id := _tenant;
  NEW.uc_number := regexp_replace(coalesce(NEW.uc_number, ''), '\D', '', 'g');
  IF NEW.uc_number = '' THEN
    RAISE EXCEPTION 'A UC da beneficiária precisa ter ao menos um dígito.';
  END IF;
  NEW.updated_at := now();

  -- (b) soma das beneficiárias ≤ 100: o resto é da geradora. Rows já
  --     inseridas pelo MESMO comando são visíveis aqui (snapshot do comando).
  SELECT coalesce(sum(b.percent), 0) INTO _soma
    FROM public.project_beneficiaries b
   WHERE b.project_id = NEW.project_id
     AND b.id IS DISTINCT FROM NEW.id;
  IF _soma + NEW.percent > 100 THEN
    RAISE EXCEPTION
      'A soma dos percentuais das beneficiárias passaria de 100%% (ficaria em %). O resto é da geradora e não pode ser negativo.',
      to_char(_soma + NEW.percent, 'FM990.0000');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_beneficiaria_antes ON public.project_beneficiaries;
CREATE TRIGGER trg_beneficiaria_antes
  BEFORE INSERT OR UPDATE ON public.project_beneficiaries
  FOR EACH ROW EXECUTE FUNCTION public.fn_beneficiaria_antes();

-- (c) `has_beneficiaries` continua existindo (dez lugares o leem) e passa a
--     ser derivado: true se há ≥ 1 linha. Ninguém mais o escreve com sentido
--     — quem escrever é sobreposto na próxima mudança de linha.
CREATE OR REPLACE FUNCTION public.fn_beneficiaria_sincroniza_flag()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _project UUID := coalesce(NEW.project_id, OLD.project_id);
BEGIN
  UPDATE public.project_general_data g
     SET has_beneficiaries = EXISTS (
           SELECT 1 FROM public.project_beneficiaries b WHERE b.project_id = _project)
   WHERE g.project_id = _project;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_beneficiaria_flag ON public.project_beneficiaries;
CREATE TRIGGER trg_beneficiaria_flag
  AFTER INSERT OR UPDATE OR DELETE ON public.project_beneficiaries
  FOR EACH ROW EXECUTE FUNCTION public.fn_beneficiaria_sincroniza_flag();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.project_beneficiaries ENABLE ROW LEVEL SECURITY;

-- isolamento por tenant (RESTRICTIVE): a última linha de defesa
DROP POLICY IF EXISTS tenant_isolation ON public.project_beneficiaries;
CREATE POLICY tenant_isolation ON public.project_beneficiaries AS RESTRICTIVE FOR ALL
  TO authenticated
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));

-- quem pode editar o projeto (equipe): admin, ou staff com acesso ao projeto
CREATE OR REPLACE FUNCTION public.beneficiaria_equipe_ok(_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.has_role((select auth.uid()), 'admin'::public.user_role)
      OR public.is_master((select auth.uid()))
      OR (public.has_role((select auth.uid()), 'staff'::public.user_role)
          AND public.staff_can_access_project((select auth.uid()), _project_id));
$$;
REVOKE ALL ON FUNCTION public.beneficiaria_equipe_ok(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beneficiaria_equipe_ok(UUID) TO authenticated, service_role;

-- a trava do portal: depois de criado na CPFL, ninguém escreve
CREATE OR REPLACE FUNCTION public.beneficiaria_projeto_editavel(_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = _project_id AND p.cpfl_node_id IS NULL);
$$;
REVOKE ALL ON FUNCTION public.beneficiaria_projeto_editavel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beneficiaria_projeto_editavel(UUID) TO authenticated, service_role;

-- a empresa só mexe antes da análise (decisão do usuário)
CREATE OR REPLACE FUNCTION public.beneficiaria_empresa_ok(_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = _project_id
                    AND p.company_id = public.get_user_company_id((select auth.uid()))
                    AND p.status = 'pending'::public.project_status
                    AND p.cpfl_node_id IS NULL);
$$;
REVOKE ALL ON FUNCTION public.beneficiaria_empresa_ok(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beneficiaria_empresa_ok(UUID) TO authenticated, service_role;

-- leitura: equipe com acesso ao projeto, ou a própria empresa
DROP POLICY IF EXISTS beneficiaria_le ON public.project_beneficiaries;
CREATE POLICY beneficiaria_le ON public.project_beneficiaries FOR SELECT
  TO authenticated
  USING (
    public.beneficiaria_equipe_ok(project_id)
    OR EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = project_id
                  AND p.company_id = public.get_user_company_id((select auth.uid())))
  );

-- escrita da equipe: até a criação na CPFL
DROP POLICY IF EXISTS beneficiaria_equipe_escreve ON public.project_beneficiaries;
CREATE POLICY beneficiaria_equipe_escreve ON public.project_beneficiaries FOR ALL
  TO authenticated
  USING      (public.beneficiaria_equipe_ok(project_id) AND public.beneficiaria_projeto_editavel(project_id))
  WITH CHECK (public.beneficiaria_equipe_ok(project_id) AND public.beneficiaria_projeto_editavel(project_id));

-- escrita da empresa: antes da análise e antes da CPFL
DROP POLICY IF EXISTS beneficiaria_empresa_escreve ON public.project_beneficiaries;
CREATE POLICY beneficiaria_empresa_escreve ON public.project_beneficiaries FOR ALL
  TO authenticated
  USING      (public.beneficiaria_empresa_ok(project_id))
  WITH CHECK (public.beneficiaria_empresa_ok(project_id));

-- envio público (sem sessão): só INSERT, só em projeto recém-criado pelo
-- formulário público — espelho da política que project_general_data já tem
DROP POLICY IF EXISTS beneficiaria_anon_insere ON public.project_beneficiaries;
CREATE POLICY beneficiaria_anon_insere ON public.project_beneficiaries FOR INSERT
  TO anon
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p
                       WHERE p.id = project_id
                         AND p.source = 'public_form'::public.project_source
                         AND p.status = 'pending'::public.project_status));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_beneficiaries TO authenticated;
GRANT INSERT (project_id, uc_number, percent, holder_name, holder_doc, address,
              document_id, origin, holder_mismatch, position)
  ON public.project_beneficiaries TO anon;
GRANT ALL ON public.project_beneficiaries TO service_role;

-- ── 4. A Ludmilla escreve de volta o que o portal confirmou ─────────────────
-- Só o robô (service_role). Casa pela UC em dígitos; a run tem de ser deste
-- projeto (mesma guarda de ludmilla_salvar_node_cpfl).
CREATE OR REPLACE FUNCTION public.ludmilla_beneficiarias_confirmar(
  p_run_id     UUID,
  p_project_id UUID,
  p_linhas     JSONB
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _l   JSONB;
  _n   INTEGER := 0;
  _uc  TEXT;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_sync_runs psr
                  WHERE psr.id = p_run_id AND psr.dados->>'project_id' = p_project_id::TEXT) THEN
    RAISE EXCEPTION 'A run % não é deste projeto.', p_run_id;
  END IF;

  FOR _l IN SELECT * FROM jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) LOOP
    _uc := regexp_replace(coalesce(_l->>'uc', ''), '\D', '', 'g');
    UPDATE public.project_beneficiaries b
       SET holder_name = coalesce(nullif(btrim(_l->>'titular'), ''), b.holder_name),
           holder_doc  = coalesce(nullif(regexp_replace(coalesce(_l->>'documento', ''), '\D', '', 'g'), ''), b.holder_doc),
           address     = coalesce(nullif(btrim(_l->>'endereco'), ''), b.address),
           origin      = 'confirmado_no_portal',
           holder_mismatch = FALSE
     WHERE b.project_id = p_project_id AND b.uc_number = _uc;
    IF FOUND THEN _n := _n + 1; END IF;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.ludmilla_beneficiarias_confirmar(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_beneficiarias_confirmar(UUID, UUID, JSONB) TO service_role;

-- ── 5. Os dados da criação na CPFL, v3 ──────────────────────────────────────
-- Cópia fiel da v2 (16/09/2026) com DUAS colunas a mais e uma pré-checagem:
--   sistema_compensacao: 'autoconsumo_remoto' se há beneficiária, senão
--                        'geracao_local' — deixa de ser o 2771 fixo do worker;
--   beneficiarias:       [{uc, percentual}] na ordem de cadastro.
-- Recusa (com a UC no texto) se há titular diferente ou soma > 100: a
-- Ludmilla nem começa, e a mensagem aparece no painel do modal.
DROP FUNCTION IF EXISTS public.ludmilla_dados_criacao_cpfl(UUID, UUID);

CREATE OR REPLACE FUNCTION public.ludmilla_dados_criacao_cpfl(
  p_run_id     UUID,
  p_project_id UUID
) RETURNS TABLE (
  uc_number          TEXT,
  coordinates        TEXT,
  customer_name      TEXT,
  customer_cpf       TEXT,
  customer_email     TEXT,
  customer_phone     TEXT,
  project_title      TEXT,
  is_rural           BOOLEAN,
  concessionaire     TEXT,
  entry_phase        TEXT,
  entry_breaker      TEXT,
  module_brand       TEXT,
  module_model       TEXT,
  module_quantity    INTEGER,
  module_power_wp    NUMERIC,
  inverter_brand     TEXT,
  inverter_model     TEXT,
  inverter_quantity  INTEGER,
  inverter_power_kw  NUMERIC,
  rule_categoria     TEXT,
  rule_num_fases     SMALLINT,
  rule_bitola        TEXT,
  rule_disjuntor     INTEGER,
  rule_caixa         TEXT,
  rule_extra         JSONB,
  sistema_compensacao TEXT,
  beneficiarias      JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _ruim TEXT;
  _soma NUMERIC;
BEGIN
  -- pré-checagem: o que o portal recusaria
  SELECT b.uc_number INTO _ruim
    FROM public.project_beneficiaries b
   WHERE b.project_id = p_project_id AND b.holder_mismatch
   ORDER BY b.position LIMIT 1;
  IF _ruim IS NOT NULL THEN
    RAISE EXCEPTION 'A beneficiária UC % é de outro titular — o portal da CPFL recusa. Remova a linha ou confirme o titular pela conta.', _ruim;
  END IF;
  SELECT coalesce(sum(b.percent), 0) INTO _soma
    FROM public.project_beneficiaries b WHERE b.project_id = p_project_id;
  IF _soma > 100 THEN
    RAISE EXCEPTION 'As beneficiárias somam % por cento — passa de 100. Ajuste os percentuais.', to_char(_soma, 'FM990.0000');
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.id, p.code, p.title, p.concessionaire_id,
           pgd.uc_number, pgd.coordinates, pgd.holder_name, pgd.holder_cpf_cnpj, pgd.holder_email, pgd.holder_phone,
           pgd.is_rural, pgd.phase_type, pgd.circuit_breaker_current, pgd.entry_rule_id,
           CASE lower(coalesce(pgd.phase_type, ''))
             WHEN 'monofasico' THEN 1 WHEN 'bifasico' THEN 2 WHEN 'trifasico' THEN 3 ELSE NULL END AS fases,
           NULLIF(regexp_replace(coalesce(pgd.circuit_breaker_current, ''), '\D', '', 'g'), '')::INTEGER AS amps
      FROM public.portal_sync_runs psr
      JOIN public.projects p ON p.id = p_project_id
      JOIN public.project_general_data pgd ON pgd.project_id = p.id
     WHERE psr.id = p_run_id
       AND (SELECT auth.role()) = 'service_role'
     LIMIT 1
  ),
  regra AS (
    SELECT r.*
      FROM base b
      JOIN public.concessionaire_entry_rules r ON r.id = b.entry_rule_id
    UNION ALL
    SELECT r.*
      FROM base b
      JOIN LATERAL (
        SELECT r.* FROM public.concessionaire_entry_rules r
         WHERE r.concessionaire_id = b.concessionaire_id
           AND b.entry_rule_id IS NULL
           AND (b.fases IS NULL OR r.num_fases = b.fases)
         ORDER BY
           CASE WHEN b.amps IS NULL OR r.disjuntor >= b.amps THEN 0 ELSE 1 END,
           CASE WHEN b.amps IS NULL OR r.disjuntor >= b.amps THEN r.disjuntor ELSE -r.disjuntor END
         LIMIT 1
      ) r ON TRUE
    LIMIT 1
  ),
  benef AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('uc', x.uc_number, 'percentual', x.percent)
                              ORDER BY x.position, x.created_at), '[]'::jsonb) AS lista,
           count(*) AS n
      FROM public.project_beneficiaries x
     WHERE x.project_id = p_project_id
  )
  SELECT
    b.uc_number, b.coordinates, b.holder_name, b.holder_cpf_cnpj, b.holder_email, b.holder_phone,
    COALESCE(NULLIF(trim(b.title), ''), 'UFV ' || b.holder_name, b.code),
    COALESCE(b.is_rural, FALSE),
    ec.name,
    b.phase_type, b.circuit_breaker_current,
    pe.module_brand, pe.module_model, pe.module_quantity, pe.module_power,
    pe.inverter_brand, pe.inverter_model, pe.inverter_quantity, pe.inverter_power,
    r.categoria, r.num_fases, r.bitola, r.disjuntor, r.caixa_medicao, r.extra,
    CASE WHEN bf.n > 0 THEN 'autoconsumo_remoto' ELSE 'geracao_local' END,
    bf.lista
  FROM base b
  CROSS JOIN benef bf
  LEFT JOIN public.project_equipment pe ON pe.project_id = b.id
  LEFT JOIN public.energy_concessionaires ec ON ec.id = b.concessionaire_id
  LEFT JOIN regra r ON TRUE
  LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.ludmilla_dados_criacao_cpfl(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_dados_criacao_cpfl(UUID, UUID)
  TO service_role;

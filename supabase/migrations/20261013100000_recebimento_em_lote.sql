-- ============================================================================
-- RECEBIMENTO EM LOTE — um valor redondo quitando vários projetos (13/10/2026)
--
-- O problema (relato do usuário): a empresa integradora manda um valor redondo
-- (R$ 5.000), que não casa com o total de nenhum projeto. Hoje a quitação é
-- projeto a projeto, ou "saldo cheio de vários" — não há como dizer "esse
-- dinheiro quitou A e B e abateu parte de C", e nada amarra as parcelas que
-- vieram do mesmo depósito.
--
-- O que esta migração acrescenta:
--   1. `financial_receipts` — o depósito: empresa, data, valor, sobra, quem
--      lançou. É o que a tela mostra como "valor pago no dia".
--   2. `payment_history.receipt_id` — as parcelas de projeto continuam no
--      razonete que já existe (nada de tabela nova para projeto), agora
--      sabendo de que depósito vieram.
--   3. `subscription_payment_history` — a mensalidade NÃO tinha razonete: o
--      front fazia `update amount_paid` direto, sem histórico, sem estorno e
--      sem parcial. Para um valor redondo abater PARTE de uma mensalidade,
--      esse histórico precisa existir.
--
-- Ordem da distribuição (decisão do usuário, 13/10/2026): **ARTs primeiro, da
-- mais antiga para a mais nova; a mensalidade recebe o que sobrar.**
--
-- O sistema SUGERE e a pessoa AJUSTA (decisão do usuário): `recebimento_sugerir`
-- só calcula, e `recebimento_registrar` grava exatamente as linhas que vieram
-- da tela — ela nunca redistribui por conta própria.
-- ============================================================================

-- ── Quem pode mexer: admin/staff do tenant (a mesma régua do financeiro) ────
CREATE OR REPLACE FUNCTION public.financeiro_equipe_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.get_user_role((select auth.uid())) IN ('admin', 'staff');
$$;
REVOKE ALL ON FUNCTION public.financeiro_equipe_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_equipe_ok() TO authenticated, service_role;

-- ── 1. O depósito ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.financial_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  received_date   DATE NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  -- sobra não aplicada: a empresa mandou mais do que devia. Fica como crédito
  -- visível, e a próxima sugestão o oferece primeiro (decisão do usuário).
  credit          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at     TIMESTAMPTZ,
  reversed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_reason TEXT
);
CREATE INDEX IF NOT EXISTS financial_receipts_empresa_idx
  ON public.financial_receipts (company_id, received_date DESC);
CREATE INDEX IF NOT EXISTS financial_receipts_tenant_idx
  ON public.financial_receipts (tenant_id, received_date DESC);
-- crédito ainda disponível (não estornado): o que a próxima sugestão oferece
CREATE INDEX IF NOT EXISTS financial_receipts_credito_idx
  ON public.financial_receipts (company_id) WHERE credit > 0 AND reversed_at IS NULL;

-- ── 2. A parcela de projeto sabe de que depósito veio ───────────────────────
ALTER TABLE public.payment_history
  ADD COLUMN IF NOT EXISTS receipt_id UUID
  REFERENCES public.financial_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payment_history_receipt_idx
  ON public.payment_history (receipt_id) WHERE receipt_id IS NOT NULL;

-- ── 3. O razonete que a mensalidade não tinha ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_payment_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id           UUID NOT NULL REFERENCES public.company_subscription_charges(id) ON DELETE CASCADE,
  amount              NUMERIC(12,2) NOT NULL,
  payment_date        DATE NOT NULL,
  notes               TEXT,
  registered_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entry_type          TEXT NOT NULL DEFAULT 'payment' CHECK (entry_type IN ('payment', 'reversal')),
  reverses_payment_id UUID REFERENCES public.subscription_payment_history(id) ON DELETE SET NULL,
  receipt_id          UUID REFERENCES public.financial_receipts(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payment_history_charge_idx
  ON public.subscription_payment_history (charge_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS subscription_payment_history_receipt_idx
  ON public.subscription_payment_history (receipt_id) WHERE receipt_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mesma postura das tabelas financeiras vizinhas: isolamento por tenant,
-- equipe escreve, e a empresa LÊ o que é dela (ela já lê o próprio
-- `payment_history`, então o bloco novo da tela dela não inventa acesso).
ALTER TABLE public.financial_receipts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payment_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.financial_receipts;
CREATE POLICY tenant_isolation ON public.financial_receipts AS RESTRICTIVE FOR ALL
  TO authenticated
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));

DROP POLICY IF EXISTS equipe_le_recebimentos ON public.financial_receipts;
CREATE POLICY equipe_le_recebimentos ON public.financial_receipts FOR SELECT
  TO authenticated USING ((select public.financeiro_equipe_ok()));

DROP POLICY IF EXISTS empresa_le_proprios_recebimentos ON public.financial_receipts;
CREATE POLICY empresa_le_proprios_recebimentos ON public.financial_receipts FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id((select auth.uid())));

-- escrita só pelas RPCs (SECURITY DEFINER): nenhuma policy de INSERT/UPDATE
REVOKE INSERT, UPDATE, DELETE ON public.financial_receipts FROM anon, authenticated;

DROP POLICY IF EXISTS equipe_le_parcelas_assinatura ON public.subscription_payment_history;
CREATE POLICY equipe_le_parcelas_assinatura ON public.subscription_payment_history FOR SELECT
  TO authenticated
  USING (
    (select public.financeiro_equipe_ok())
    AND EXISTS (SELECT 1 FROM public.company_subscription_charges c
                 WHERE c.id = charge_id
                   AND c.tenant_id = public.get_user_tenant_id((select auth.uid())))
  );

DROP POLICY IF EXISTS empresa_le_proprias_parcelas_assinatura ON public.subscription_payment_history;
CREATE POLICY empresa_le_proprias_parcelas_assinatura ON public.subscription_payment_history FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_subscription_charges c
                  WHERE c.id = charge_id
                    AND c.company_id = public.get_user_company_id((select auth.uid()))));

REVOKE INSERT, UPDATE, DELETE ON public.subscription_payment_history FROM anon, authenticated;

-- ── Helper: o saldo em aberto de cada coisa que a empresa deve ──────────────
-- Devolve ARTs e mensalidades em aberto, JÁ na ordem da distribuição: ARTs por
-- vencimento mais antigo (sem vencimento vai pelo nascimento), depois as
-- mensalidades por competência. É a mesma ordem que a sugestão e a conferência
-- usam, para não haver duas verdades.
CREATE OR REPLACE FUNCTION public.recebimento_abertos(_company_id UUID)
RETURNS TABLE (
  ordem      INTEGER,
  tipo       TEXT,
  alvo_id    UUID,
  rotulo     TEXT,
  detalhe    TEXT,
  vencimento DATE,
  total      NUMERIC,
  pago       NUMERIC,
  aberto     NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH arts AS (
    SELECT 'art'::TEXT AS tipo,
           pf.project_id AS alvo_id,
           pr.code AS rotulo,
           coalesce(g.holder_name, '') AS detalhe,
           pf.due_date AS vencimento,
           pf.project_value AS total,
           pf.paid_value AS pago,
           (pf.project_value - pf.paid_value) AS aberto,
           pf.due_date AS chave1,
           pr.created_at AS chave2
      FROM public.project_financials pf
      JOIN public.projects pr ON pr.id = pf.project_id
      LEFT JOIN public.project_general_data g ON g.project_id = pf.project_id
     WHERE pr.company_id = _company_id
       AND NOT pr.is_deleted
       AND pf.project_value > 0
       AND pf.paid_value < pf.project_value
  ), mensalidades AS (
    SELECT 'assinatura'::TEXT,
           c.id,
           'Mensalidade ' || to_char(c.competence, 'MM/YYYY'),
           ''::TEXT,
           c.due_date,
           c.amount,
           c.amount_paid,
           (c.amount - c.amount_paid),
           c.due_date,
           c.competence::timestamptz
      FROM public.company_subscription_charges c
     WHERE c.company_id = _company_id
       AND c.amount_paid < c.amount
  ), tudo AS (
    -- ARTs primeiro (grupo 0), mensalidades depois (grupo 1): a decisão do
    -- usuário é "ARTs primeiro, a mensalidade recebe o que sobrar".
    SELECT 0 AS grupo, * FROM arts
    UNION ALL
    SELECT 1 AS grupo, * FROM mensalidades
  )
  SELECT (row_number() OVER (ORDER BY grupo, chave1 NULLS LAST, chave2))::INTEGER,
         tipo, alvo_id, rotulo, detalhe, vencimento,
         round(total, 2), round(pago, 2), round(aberto, 2)
    FROM tudo
   ORDER BY grupo, chave1 NULLS LAST, chave2;
$$;
REVOKE ALL ON FUNCTION public.recebimento_abertos(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_abertos(UUID) TO authenticated, service_role;

-- ── Crédito disponível da empresa (sobras de depósitos anteriores) ──────────
CREATE OR REPLACE FUNCTION public.recebimento_credito(_company_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(sum(credit), 0)::NUMERIC
    FROM public.financial_receipts
   WHERE company_id = _company_id AND credit > 0 AND reversed_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.recebimento_credito(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_credito(UUID) TO authenticated, service_role;

-- ── SUGERIR: só calcula, não grava ──────────────────────────────────────────
-- Distribui `_valor` do mais antigo ao mais novo até o dinheiro acabar. A tela
-- pré-marca o que vier com `sugerido > 0` e deixa a pessoa ajustar tudo.
CREATE OR REPLACE FUNCTION public.recebimento_sugerir(_company_id UUID, _valor NUMERIC)
RETURNS TABLE (
  ordem      INTEGER,
  tipo       TEXT,
  alvo_id    UUID,
  rotulo     TEXT,
  detalhe    TEXT,
  vencimento DATE,
  total      NUMERIC,
  pago       NUMERIC,
  aberto     NUMERIC,
  sugerido   NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _resta NUMERIC := greatest(coalesce(_valor, 0), 0); _l RECORD; _usa NUMERIC;
BEGIN
  IF NOT public.financeiro_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso ao financeiro.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c
                  WHERE c.id = _company_id
                    AND c.tenant_id = public.get_user_tenant_id((select auth.uid()))) THEN
    RAISE EXCEPTION 'Empresa não encontrada neste tenant.';
  END IF;

  FOR _l IN SELECT * FROM public.recebimento_abertos(_company_id) LOOP
    _usa := least(_l.aberto, _resta);
    IF _usa < 0 THEN _usa := 0; END IF;
    _resta := _resta - _usa;
    RETURN QUERY SELECT _l.ordem, _l.tipo, _l.alvo_id, _l.rotulo, _l.detalhe,
                        _l.vencimento, _l.total, _l.pago, _l.aberto, round(_usa, 2);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.recebimento_sugerir(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_sugerir(UUID, NUMERIC) TO authenticated;

-- ── REGISTRAR: grava exatamente o que a tela mandou ─────────────────────────
-- `_linhas` é um array JSON de {tipo, alvo_id, valor}. A função NÃO redistribui:
-- se a pessoa ajustou, é o ajuste dela que vale. O que ela valida é o que não
-- pode passar: valor maior que o recebido, linha maior que o saldo em aberto,
-- alvo de outra empresa.
CREATE OR REPLACE FUNCTION public.recebimento_registrar(
  _company_id UUID, _data DATE, _valor NUMERIC, _linhas JSONB, _notes TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (select auth.uid());
  _tenant UUID;
  _receipt UUID;
  _soma NUMERIC := 0;
  _l JSONB;
  _tipo TEXT; _alvo UUID; _val NUMERIC;
  _aberto NUMERIC;
  _novo_pago NUMERIC; _total NUMERIC;
BEGIN
  IF _uid IS NULL OR NOT public.financeiro_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso ao financeiro.' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  IF NOT EXISTS (SELECT 1 FROM public.companies c
                  WHERE c.id = _company_id AND c.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Empresa não encontrada neste tenant.';
  END IF;
  IF coalesce(_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'O valor recebido tem de ser maior que zero.';
  END IF;
  IF _data IS NULL THEN
    RAISE EXCEPTION 'Informe a data em que o valor foi recebido.';
  END IF;
  IF _data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data do recebimento não pode ser no futuro.';
  END IF;

  -- confere a soma antes de gravar qualquer coisa
  FOR _l IN SELECT * FROM jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) LOOP
    _val := round((_l->>'valor')::NUMERIC, 2);
    IF _val IS NULL OR _val <= 0 THEN
      RAISE EXCEPTION 'Toda linha precisa de um valor maior que zero.';
    END IF;
    _soma := _soma + _val;
  END LOOP;
  IF _soma > round(_valor, 2) THEN
    RAISE EXCEPTION 'A soma das linhas (%) passa do valor recebido (%).',
      to_char(_soma, 'FM999999990.00'), to_char(_valor, 'FM999999990.00');
  END IF;

  INSERT INTO public.financial_receipts
    (tenant_id, company_id, received_date, amount, credit, notes, created_by)
  VALUES (_tenant, _company_id, _data, round(_valor, 2), round(_valor, 2) - _soma,
          nullif(btrim(coalesce(_notes, '')), ''), _uid)
  RETURNING id INTO _receipt;

  FOR _l IN SELECT * FROM jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) LOOP
    _tipo := _l->>'tipo';
    _alvo := (_l->>'alvo_id')::UUID;
    _val  := round((_l->>'valor')::NUMERIC, 2);

    IF _tipo = 'art' THEN
      SELECT pf.project_value, pf.paid_value, (pf.project_value - pf.paid_value)
        INTO _total, _novo_pago, _aberto
        FROM public.project_financials pf
        JOIN public.projects pr ON pr.id = pf.project_id
       WHERE pf.project_id = _alvo AND pr.company_id = _company_id AND NOT pr.is_deleted
       FOR UPDATE OF pf;
      IF _total IS NULL THEN
        RAISE EXCEPTION 'Projeto não encontrado nesta empresa.';
      END IF;
      IF _val > _aberto THEN
        RAISE EXCEPTION 'O valor de uma linha (%) passa do saldo em aberto do projeto (%).',
          to_char(_val, 'FM999999990.00'), to_char(_aberto, 'FM999999990.00');
      END IF;

      INSERT INTO public.payment_history
        (project_id, amount, payment_date, notes, registered_by, entry_type, receipt_id)
      VALUES (_alvo, _val, _data, nullif(btrim(coalesce(_notes, '')), ''), _uid, 'payment', _receipt);

      _novo_pago := _novo_pago + _val;
      UPDATE public.project_financials
         SET paid_value = _novo_pago,
             payment_status = (CASE WHEN _novo_pago <= 0 THEN 'pending'
                                    WHEN _novo_pago >= _total THEN 'paid'
                                    ELSE 'partial' END)::public.payment_status,
             updated_at = now()
       WHERE project_id = _alvo;

    ELSIF _tipo = 'assinatura' THEN
      SELECT c.amount, c.amount_paid, (c.amount - c.amount_paid)
        INTO _total, _novo_pago, _aberto
        FROM public.company_subscription_charges c
       WHERE c.id = _alvo AND c.company_id = _company_id AND c.tenant_id = _tenant
       FOR UPDATE;
      IF _total IS NULL THEN
        RAISE EXCEPTION 'Mensalidade não encontrada nesta empresa.';
      END IF;
      IF _val > _aberto THEN
        RAISE EXCEPTION 'O valor de uma linha (%) passa do saldo em aberto da mensalidade (%).',
          to_char(_val, 'FM999999990.00'), to_char(_aberto, 'FM999999990.00');
      END IF;

      INSERT INTO public.subscription_payment_history
        (charge_id, amount, payment_date, notes, registered_by, entry_type, receipt_id)
      VALUES (_alvo, _val, _data, nullif(btrim(coalesce(_notes, '')), ''), _uid, 'payment', _receipt);

      _novo_pago := _novo_pago + _val;
      UPDATE public.company_subscription_charges
         SET amount_paid = _novo_pago,
             status = CASE WHEN _novo_pago <= 0 THEN 'pending'
                           WHEN _novo_pago >= _total THEN 'paid'
                           ELSE 'partial' END,
             updated_at = now()
       WHERE id = _alvo;

    ELSE
      RAISE EXCEPTION 'Tipo de linha desconhecido: %.', coalesce(_tipo, '(vazio)');
    END IF;
  END LOOP;

  RETURN _receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.recebimento_registrar(UUID, DATE, NUMERIC, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_registrar(UUID, DATE, NUMERIC, JSONB, TEXT) TO authenticated;

-- ── ESTORNAR o depósito inteiro ─────────────────────────────────────────────
-- Desfaz todas as parcelas de uma vez, preservando a trilha: grava linha de
-- reversão (valor negativo) nos dois razonetes, como o estorno por projeto já
-- faz. Só admin, porque desfaz lançamento financeiro.
CREATE OR REPLACE FUNCTION public.recebimento_estornar(_receipt_id UUID, _motivo TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (select auth.uid());
  _r public.financial_receipts;
  _p RECORD;
  _total NUMERIC; _pago NUMERIC;
BEGIN
  -- o enum precisa de schema explícito: a função roda com search_path = ''
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Só o admin estorna recebimento.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _r FROM public.financial_receipts
   WHERE id = _receipt_id AND tenant_id = public.get_user_tenant_id(_uid)
   FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado.'; END IF;
  IF _r.reversed_at IS NOT NULL THEN RETURN FALSE; END IF;

  -- parcelas de projeto
  FOR _p IN SELECT id, project_id, amount FROM public.payment_history
             WHERE receipt_id = _receipt_id AND entry_type = 'payment' LOOP
    INSERT INTO public.payment_history
      (project_id, amount, payment_date, notes, registered_by, entry_type,
       reverses_payment_id, receipt_id)
    VALUES (_p.project_id, -_p.amount, (now() AT TIME ZONE 'America/Sao_Paulo')::date,
            left('Estorno do recebimento de ' || to_char(_r.received_date, 'DD/MM/YYYY')
                 || coalesce(' — ' || _motivo, ''), 500),
            _uid, 'reversal', _p.id, _receipt_id);

    SELECT pf.project_value, greatest(pf.paid_value - _p.amount, 0)
      INTO _total, _pago
      FROM public.project_financials pf WHERE pf.project_id = _p.project_id FOR UPDATE;
    UPDATE public.project_financials
       SET paid_value = _pago,
           payment_status = (CASE WHEN _pago <= 0 THEN 'pending'
                                  WHEN _pago >= _total THEN 'paid'
                                  ELSE 'partial' END)::public.payment_status,
           updated_at = now()
     WHERE project_id = _p.project_id;
  END LOOP;

  -- parcelas de mensalidade
  FOR _p IN SELECT id, charge_id, amount FROM public.subscription_payment_history
             WHERE receipt_id = _receipt_id AND entry_type = 'payment' LOOP
    INSERT INTO public.subscription_payment_history
      (charge_id, amount, payment_date, notes, registered_by, entry_type,
       reverses_payment_id, receipt_id)
    VALUES (_p.charge_id, -_p.amount, (now() AT TIME ZONE 'America/Sao_Paulo')::date,
            left('Estorno do recebimento de ' || to_char(_r.received_date, 'DD/MM/YYYY')
                 || coalesce(' — ' || _motivo, ''), 500),
            _uid, 'reversal', _p.id, _receipt_id);

    SELECT c.amount, greatest(c.amount_paid - _p.amount, 0)
      INTO _total, _pago
      FROM public.company_subscription_charges c WHERE c.id = _p.charge_id FOR UPDATE;
    UPDATE public.company_subscription_charges
       SET amount_paid = _pago,
           status = CASE WHEN _pago <= 0 THEN 'pending'
                         WHEN _pago >= _total THEN 'paid'
                         ELSE 'partial' END,
           updated_at = now()
     WHERE id = _p.charge_id;
  END LOOP;

  UPDATE public.financial_receipts
     SET reversed_at = now(), reversed_by = _uid,
         reversal_reason = nullif(btrim(coalesce(_motivo, '')), ''),
         credit = 0
   WHERE id = _receipt_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.recebimento_estornar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_estornar(UUID, TEXT) TO authenticated;

-- ── EXTRATO: "o valor pago no dia e o que ele quitou" ───────────────────────
-- É o que as duas telas mostram. Uma linha por depósito, com as parcelas dentro
-- em JSON, cada uma dizendo se quitou (integral) ou abateu (parcial).
CREATE OR REPLACE FUNCTION public.recebimento_extrato(
  _company_id UUID DEFAULT NULL, _limite INTEGER DEFAULT 50)
RETURNS TABLE (
  id            UUID,
  company_id    UUID,
  company_name  TEXT,
  received_date DATE,
  amount        NUMERIC,
  aplicado      NUMERIC,
  credit        NUMERIC,
  notes         TEXT,
  criado_por    TEXT,
  reversed_at   TIMESTAMPTZ,
  reversal_reason TEXT,
  linhas        JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH visiveis AS (
    SELECT r.*
      FROM public.financial_receipts r
     WHERE (_company_id IS NULL OR r.company_id = _company_id)
       AND r.tenant_id = public.get_user_tenant_id((select auth.uid()))
       AND (
         (select public.financeiro_equipe_ok())
         OR r.company_id = public.get_user_company_id((select auth.uid()))
       )
     ORDER BY r.received_date DESC, r.created_at DESC
     LIMIT greatest(1, least(coalesce(_limite, 50), 300))
  ), parcelas AS (
    SELECT ph.receipt_id,
           jsonb_build_object(
             'tipo', 'art',
             'rotulo', pr.code,
             'detalhe', coalesce(g.holder_name, ''),
             'valor', ph.amount,
             'total', pf.project_value,
             'quitou', (pf.paid_value >= pf.project_value AND ph.amount > 0),
             'project_id', ph.project_id
           ) AS linha,
           ph.amount AS valor
      FROM public.payment_history ph
      JOIN public.projects pr ON pr.id = ph.project_id
      LEFT JOIN public.project_financials pf ON pf.project_id = ph.project_id
      LEFT JOIN public.project_general_data g ON g.project_id = ph.project_id
     WHERE ph.receipt_id IN (SELECT id FROM visiveis) AND ph.entry_type = 'payment'
    UNION ALL
    SELECT sp.receipt_id,
           jsonb_build_object(
             'tipo', 'assinatura',
             'rotulo', 'Mensalidade ' || to_char(c.competence, 'MM/YYYY'),
             'detalhe', '',
             'valor', sp.amount,
             'total', c.amount,
             'quitou', (c.amount_paid >= c.amount AND sp.amount > 0),
             'project_id', NULL
           ),
           sp.amount
      FROM public.subscription_payment_history sp
      JOIN public.company_subscription_charges c ON c.id = sp.charge_id
     WHERE sp.receipt_id IN (SELECT id FROM visiveis) AND sp.entry_type = 'payment'
  )
  SELECT v.id, v.company_id, co.name, v.received_date, v.amount,
         coalesce((SELECT sum(p.valor) FROM parcelas p WHERE p.receipt_id = v.id), 0),
         v.credit, v.notes,
         coalesce(pf2.name, '—'),
         v.reversed_at, v.reversal_reason,
         coalesce((SELECT jsonb_agg(p.linha ORDER BY p.linha->>'rotulo')
                     FROM parcelas p WHERE p.receipt_id = v.id), '[]'::jsonb)
    FROM visiveis v
    JOIN public.companies co ON co.id = v.company_id
    LEFT JOIN public.profiles pf2 ON pf2.id = v.created_by
   ORDER BY v.received_date DESC, v.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.recebimento_extrato(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_extrato(UUID, INTEGER) TO authenticated;

SELECT 'recebimento em lote aplicado' AS resultado,
       (SELECT count(*) FROM public.financial_receipts) AS recebimentos,
       (SELECT count(*) FROM public.subscription_payment_history) AS parcelas_assinatura;

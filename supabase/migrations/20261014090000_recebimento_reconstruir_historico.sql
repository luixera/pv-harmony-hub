-- ============================================================================
-- RECONSTRUÇÃO DO HISTÓRICO DE RECEBIMENTOS (14/10/2026)
--
-- O problema (pedido do usuário): os pagamentos lançados ANTES de
-- `financial_receipts` existir estão soltos, projeto a projeto. A empresa não
-- consegue ver "aquele depósito pagou estes dois e abateu parte de um
-- terceiro" — exatamente a pergunta que o recebimento em lote passou a
-- responder, mas só para o que for lançado de agora em diante.
--
-- O critério (decisão do usuário, out/2026): **mesma empresa + mesma data de
-- pagamento = um recebimento**, cujo valor é a soma dos pagamentos do dia. Na
-- prática, quem lançou fez todos os abatimentos do mesmo dinheiro no mesmo
-- dia, então a soma do dia reconstitui o depósito.
--
-- O que foi medido no banco antes de escrever isto (13/10/2026):
--   184 pagamentos candidatos · 57 dias distintos (34 deles com mais de um
--   pagamento) · R$ 78.435,84 · nenhum já pertencia a um recebimento.
--   `subscription_payment_history` estava VAZIO — a mensalidade nunca teve
--   razonete, então não há o que agrupar nela: a reconstrução é só de ARTs.
--
-- Três coisas que esta migração NÃO faz, de propósito:
--
--   1. **Não adivinha sobra.** Pelo próprio critério, a soma do dia É o valor
--      do depósito. Se na vida real a empresa mandou mais do que foi abatido,
--      aquela diferença nunca foi registrada em lugar nenhum. Todo recebimento
--      reconstruído nasce com `credit = 0` (RN-FIN-09 não se aplica a ele).
--
--   2. **Não se disfarça de lançamento.** `origin = 'reconstruido'` separa o
--      que alguém lançou do que o sistema deduziu. Importa no dia em que uma
--      empresa questionar um valor: "alguém lançou R$ 1.000" e "o sistema
--      somou o dia e deu R$ 1.000" são afirmações diferentes, e a segunda
--      carrega a premissa do item 1.
--
--   3. **Não encosta em pagamento estornado.** Um pagamento que já foi
--      revertido sairia no cartão como dinheiro que entrou, quando ele voltou.
--      Ficam de fora o pagamento revertido e a linha de reversão.
--
-- Dois depósitos reais no mesmo dia viram um só cartão. É imprecisão aceita
-- pelo critério, e foi dita ao usuário antes de rodar.
-- ============================================================================

-- ── A procedência do recebimento ────────────────────────────────────────────
ALTER TABLE public.financial_receipts
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'lancado';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.financial_receipts'::regclass
       AND conname  = 'financial_receipts_origin_check'
  ) THEN
    ALTER TABLE public.financial_receipts
      ADD CONSTRAINT financial_receipts_origin_check
      CHECK (origin IN ('lancado', 'reconstruido'));
  END IF;
END $$;

COMMENT ON COLUMN public.financial_receipts.origin IS
  'lancado = alguém registrou o depósito na tela; reconstruido = deduzido do '
  'histórico agrupando pagamentos da mesma empresa na mesma data (credit é '
  'sempre 0 nesse caso, porque a sobra nunca foi registrada).';

-- ── A reconstrução ──────────────────────────────────────────────────────────
-- Só admin: mexe em dinheiro de todas as empresas de uma vez. Idempotente por
-- construção — só enxerga pagamento com `receipt_id IS NULL`, então rodar de
-- novo não cria nada e não duplica.
CREATE OR REPLACE FUNCTION public.recebimento_reconstruir_historico(
  _simular BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  recebimentos INTEGER,
  pagamentos   INTEGER,
  valor        NUMERIC,
  simulado     BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid      UUID := (select auth.uid());
  _tenant   UUID;
  _g        RECORD;
  _novo     UUID;
  _n_rec    INTEGER := 0;
  _n_pag    INTEGER := 0;
  _total    NUMERIC(14,2) := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária.';
  END IF;
  IF public.get_user_role(_uid) <> 'admin' THEN
    RAISE EXCEPTION 'Só o administrador pode reconstruir o histórico.';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  FOR _g IN
    SELECT pr.company_id,
           ph.payment_date,
           sum(ph.amount)                                   AS soma,
           count(*)                                         AS qtd,
           mode() WITHIN GROUP (ORDER BY ph.registered_by)   AS autor,
           array_agg(ph.id)                                 AS ids
      FROM public.payment_history ph
      JOIN public.projects pr ON pr.id = ph.project_id
     WHERE ph.entry_type = 'payment'
       AND ph.receipt_id IS NULL
       AND ph.amount > 0
       AND pr.tenant_id = _tenant
       AND NOT pr.is_deleted
       -- pagamento já revertido não é dinheiro que ficou
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_history rv
              WHERE rv.reverses_payment_id = ph.id
                AND rv.entry_type = 'reversal'
           )
     GROUP BY pr.company_id, ph.payment_date
     ORDER BY ph.payment_date
  LOOP
    _n_rec := _n_rec + 1;
    _n_pag := _n_pag + _g.qtd;
    _total := _total + _g.soma;

    IF NOT _simular THEN
      INSERT INTO public.financial_receipts
        (tenant_id, company_id, received_date, amount, credit,
         notes, created_by, created_at, origin)
      VALUES
        (_tenant, _g.company_id, _g.payment_date, _g.soma, 0,
         NULL, _g.autor, _g.payment_date::timestamptz, 'reconstruido')
      RETURNING id INTO _novo;

      UPDATE public.payment_history
         SET receipt_id = _novo
       WHERE id = ANY(_g.ids);
    END IF;
  END LOOP;

  RETURN QUERY SELECT _n_rec, _n_pag, _total, _simular;
END $$;

REVOKE ALL ON FUNCTION public.recebimento_reconstruir_historico(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_reconstruir_historico(BOOLEAN) TO authenticated, service_role;

-- ── O desfazer ──────────────────────────────────────────────────────────────
-- É o ponto de restauração dos DADOS desta rodada: o tag do git protege o
-- código, isto devolve o banco. Solta os pagamentos e apaga só o que foi
-- deduzido — nunca um recebimento que alguém lançou de verdade.
CREATE OR REPLACE FUNCTION public.recebimento_reconstrucao_desfazer()
RETURNS TABLE (recebimentos INTEGER, pagamentos INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid    UUID := (select auth.uid());
  _tenant UUID;
  _n_rec  INTEGER := 0;
  _n_pag  INTEGER := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária.';
  END IF;
  IF public.get_user_role(_uid) <> 'admin' THEN
    RAISE EXCEPTION 'Só o administrador pode desfazer a reconstrução.';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  WITH alvos AS (
    SELECT id FROM public.financial_receipts
     WHERE tenant_id = _tenant AND origin = 'reconstruido'
  ), soltos AS (
    UPDATE public.payment_history
       SET receipt_id = NULL
     WHERE receipt_id IN (SELECT id FROM alvos)
    RETURNING 1
  )
  SELECT count(*) INTO _n_pag FROM soltos;

  WITH apagados AS (
    DELETE FROM public.financial_receipts
     WHERE tenant_id = _tenant AND origin = 'reconstruido'
    RETURNING 1
  )
  SELECT count(*) INTO _n_rec FROM apagados;

  RETURN QUERY SELECT _n_rec, _n_pag;
END $$;

REVOKE ALL ON FUNCTION public.recebimento_reconstrucao_desfazer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_reconstrucao_desfazer() TO authenticated, service_role;

-- ── O extrato precisa contar a procedência ──────────────────────────────────
-- Cópia fiel da função de 13/10 com UMA mudança: a coluna `origin`, para a
-- tela marcar o cartão reconstruído em vez de apresentá-lo como lançamento.
-- Nada mais foi tocado — o teto de 300 no limite, a régua de acesso
-- (equipe OU a própria empresa) e o discriminador `tipo: 'art'` continuam
-- exatamente como estavam, porque o front já depende deles.
DROP FUNCTION IF EXISTS public.recebimento_extrato(UUID, INTEGER);
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
  origin        TEXT,
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
         v.origin,
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

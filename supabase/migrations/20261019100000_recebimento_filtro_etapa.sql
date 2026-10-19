-- ============================================================================
-- RECEBIMENTO EM LOTE — filtrar por ETAPA do projeto antes de distribuir
--
-- Pedido do usuário (19/10/2026), com um caso concreto: ao lançar R$ 4.000 da
-- LDS SOLAR, a sugestão mandou R$ 3.068,04 para o PRJ-81171 da LUMATEX, que
-- **ainda não está aprovado**. Ele prefere que esse dinheiro vá para projetos
-- mais adiantados.
--
-- POR QUE NO BANCO, E NÃO NA TELA: desmarcar a linha no modal não resolveria o
-- problema dele. O valor desmarcado vira SOBRA, e sobra vira crédito da
-- empresa — não escorre para os projetos seguintes. Para o dinheiro cascatear,
-- a ART fora do filtro tem de ser pulada ANTES de consumir o valor, e isso só
-- acontece aqui dentro, onde a distribuição é calculada.
--
-- O QUE NÃO MUDA:
--   * a linha fora do filtro CONTINUA aparecendo, com sugerido = 0. A dívida
--     existe, e em algum momento ela vai ser quitada; o filtro orienta a
--     sugestão, não proíbe o pagamento. A pessoa ainda pode marcar na mão, e o
--     `recebimento_registrar` aceita, porque ele valida saldo, não etapa.
--   * a MENSALIDADE nunca é filtrada: ela não tem etapa de projeto. Mesma
--     regra que já vale no extrato financeiro.
--   * sem filtro (NULL ou array vazio), o comportamento é exatamente o de
--     antes — esta migração não muda nada para quem não usar o filtro.
--
-- As duas funções só LEEM. Nenhum dado é alterado por esta migração.
-- `DROP` antes de `CREATE` porque a lista de colunas devolvida mudou, e o
-- Postgres não deixa trocar o tipo de retorno com `CREATE OR REPLACE`.
-- ============================================================================

-- ── Abertos: agora dizendo em que ETAPA o projeto está ─────────────────────
DROP FUNCTION IF EXISTS public.recebimento_abertos(UUID);

CREATE FUNCTION public.recebimento_abertos(_company_id UUID)
RETURNS TABLE (
  ordem      INTEGER,
  tipo       TEXT,
  alvo_id    UUID,
  rotulo     TEXT,
  detalhe    TEXT,
  -- Etapa do projeto (`projects.status`). NULL na mensalidade, que não tem.
  etapa      TEXT,
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
           -- `projects.status` e o enum `project_status`; o cast e obrigatorio
           -- para o UNION com a mensalidade, que traz NULL::TEXT.
           pr.status::TEXT AS etapa,
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
           NULL::TEXT,
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
         tipo, alvo_id, rotulo, detalhe, etapa, vencimento,
         round(total, 2), round(pago, 2), round(aberto, 2)
    FROM tudo
   ORDER BY grupo, chave1 NULLS LAST, chave2;
$$;
REVOKE ALL ON FUNCTION public.recebimento_abertos(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_abertos(UUID) TO authenticated, service_role;

-- ── Sugerir: a ART fora do filtro não consome o valor ──────────────────────
DROP FUNCTION IF EXISTS public.recebimento_sugerir(UUID, NUMERIC);

CREATE FUNCTION public.recebimento_sugerir(
  _company_id UUID,
  _valor      NUMERIC,
  _etapas     TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  ordem      INTEGER,
  tipo       TEXT,
  alvo_id    UUID,
  rotulo     TEXT,
  detalhe    TEXT,
  etapa      TEXT,
  vencimento DATE,
  total      NUMERIC,
  pago       NUMERIC,
  aberto     NUMERIC,
  sugerido   NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _resta NUMERIC := greatest(coalesce(_valor, 0), 0);
  _l RECORD;
  _usa NUMERIC;
  _filtra BOOLEAN := coalesce(array_length(_etapas, 1), 0) > 0;
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
    -- A mensalidade (`etapa` nula) passa sempre: não tem etapa de projeto.
    -- `coalesce` de propósito: projeto sem etapa não entra num recorte por
    -- etapa — com o filtro ligado, a pessoa disse exatamente quais quer.
    IF _filtra AND _l.tipo = 'art' AND NOT (coalesce(_l.etapa, '') = ANY (_etapas)) THEN
      _usa := 0;                       -- não consome: o valor segue para a próxima
    ELSE
      _usa := least(_l.aberto, _resta);
      IF _usa < 0 THEN _usa := 0; END IF;
      _resta := _resta - _usa;
    END IF;

    RETURN QUERY SELECT _l.ordem, _l.tipo, _l.alvo_id, _l.rotulo, _l.detalhe,
                        _l.etapa, _l.vencimento, _l.total, _l.pago, _l.aberto,
                        round(_usa, 2);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.recebimento_sugerir(UUID, NUMERIC, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recebimento_sugerir(UUID, NUMERIC, TEXT[]) TO authenticated;

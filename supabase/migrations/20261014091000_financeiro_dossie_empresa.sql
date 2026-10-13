-- ============================================================================
-- DOSSIÊ FINANCEIRO DA EMPRESA (14/10/2026)
--
-- O pedido do usuário: "ao selecionar uma empresa, tratar toda a questão do
-- histórico de pagamento, a evolução do ticket médio, um gráfico sobre a
-- quantidade de projetos do mês" — para a tela deixar de ser um filtro e
-- passar a ser um dossiê, sem risco de confundir o dado de uma empresa com
-- o de outra.
--
-- Duas funções:
--   `financeiro_empresas_resumo()`   — a lista do panorama, com prazo.
--   `financeiro_empresa_painel(_id)` — tudo de uma empresa, com série mensal.
--
-- ── O prazo médio, e a ressalva que ele carrega ─────────────────────────────
-- `project_financials.due_date` está VAZIO nas 281 linhas do banco (medido em
-- 13/10/2026), então NÃO existe prazo "do vencimento até o pagamento". O que
-- esta função mede é do **projeto entrar** até o dinheiro chegar. É uma régua
-- diferente de atraso contratual, e a tela precisa dizer isso — o número é
-- honesto, o rótulo é que engana se ficar só "prazo".
-- Se um dia houver regra de vencimento para a ART, este é o lugar de trocar.
--
-- Cada pagamento conta uma vez (projeto pago em duas parcelas entra com dois
-- prazos), porque a pergunta é "quanto tempo o dinheiro leva para chegar", e
-- não "quanto tempo o projeto leva para fechar".
-- `NULL` em prazo = a empresa nunca pagou nada. A tela mostra isso como
-- categoria própria, não como prazo ruim: no banco há uma empresa com 13
-- projetos e nenhum pagamento.
--
-- ── O ticket médio é adaptativo, e pelo DADO, não pelo rótulo ───────────────
-- A primeira ideia foi escolher o indicador pelo `pricing_type`, mas 34 das 36
-- empresas são `manual`/`fixed` e nenhuma é `per_kwp` ou faixa — o tipo não
-- discrimina nada. E a variação real não segue o tipo: uma empresa `manual`
-- tem 22 projetos todos a R$ 358,36, outra `manual` vai de R$ 498 a R$ 3.700.
-- Então quem decide é `valores_distintos` + mín/máx: a tela mostra gráfico de
-- distribuição quando varia e um número só quando é sempre o mesmo valor.
-- ============================================================================

-- ── Quem pode ler o dossiê ──────────────────────────────────────────────────
-- Equipe do tenant vê qualquer empresa dele; usuário de empresa vê só a dele.
-- Mesma régua de `recebimento_extrato`, para não haver duas verdades.
CREATE OR REPLACE FUNCTION public.financeiro_empresa_visivel(_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.companies co
     WHERE co.id = _company_id
       AND co.tenant_id = public.get_user_tenant_id((select auth.uid()))
       AND (
         (select public.financeiro_equipe_ok())
         OR co.id = public.get_user_company_id((select auth.uid()))
       )
  );
$$;
REVOKE ALL ON FUNCTION public.financeiro_empresa_visivel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_empresa_visivel(UUID) TO authenticated, service_role;

-- ── A lista do panorama ─────────────────────────────────────────────────────
-- Uma linha por empresa com o que a tela de visão geral precisa: quanto deve,
-- quanto já pagou e em quantos dias costuma pagar. `pagamentos` vem junto para
-- o front calcular o prazo médio GLOBAL como média ponderada — que é idêntica
-- à média real dos pagamentos, sem precisar de uma segunda consulta.
CREATE OR REPLACE FUNCTION public.financeiro_empresas_resumo()
RETURNS TABLE (
  company_id        UUID,
  company_name      TEXT,
  pricing_type      TEXT,
  projetos          INTEGER,
  faturado          NUMERIC,
  recebido          NUMERIC,
  aberto            NUMERIC,
  pagamentos        INTEGER,
  prazo_medio_dias  NUMERIC,
  ultimo_pagamento  DATE
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH permitido AS (
    SELECT co.id, co.name, co.pricing_type::text AS tipo
      FROM public.companies co
     WHERE co.tenant_id = public.get_user_tenant_id((select auth.uid()))
       AND (
         (select public.financeiro_equipe_ok())
         OR co.id = public.get_user_company_id((select auth.uid()))
       )
  ), valores AS (
    SELECT pr.company_id,
           count(*)::int                                          AS projetos,
           coalesce(sum(pf.project_value), 0)                     AS faturado,
           coalesce(sum(pf.paid_value), 0)                        AS recebido,
           coalesce(sum(greatest(pf.project_value - pf.paid_value, 0)), 0) AS aberto
      FROM public.projects pr
      JOIN public.project_financials pf ON pf.project_id = pr.id
     WHERE NOT pr.is_deleted
     GROUP BY pr.company_id
  ), prazos AS (
    SELECT pr.company_id,
           count(*)::int                                          AS pagamentos,
           round(avg(ph.payment_date - pr.created_at::date), 0)    AS prazo,
           max(ph.payment_date)                                   AS ultimo
      FROM public.payment_history ph
      JOIN public.projects pr ON pr.id = ph.project_id
     WHERE ph.entry_type = 'payment' AND ph.amount > 0 AND NOT pr.is_deleted
     GROUP BY pr.company_id
  )
  SELECT p.id, p.name, p.tipo,
         coalesce(v.projetos, 0),
         coalesce(v.faturado, 0),
         coalesce(v.recebido, 0),
         coalesce(v.aberto, 0),
         coalesce(z.pagamentos, 0),
         z.prazo,
         z.ultimo
    FROM permitido p
    LEFT JOIN valores v ON v.company_id = p.id
    LEFT JOIN prazos  z ON z.company_id = p.id
   WHERE coalesce(v.projetos, 0) > 0
   ORDER BY coalesce(v.aberto, 0) DESC, p.name;
$$;
REVOKE ALL ON FUNCTION public.financeiro_empresas_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_empresas_resumo() TO authenticated, service_role;

-- ── O dossiê ────────────────────────────────────────────────────────────────
-- Uma linha só, com a série mensal em JSON. A série cobre apenas os meses que
-- EXISTEM (no banco, de 2 a 6 por empresa) — um eixo de 12 meses ficaria
-- vazio e passaria a impressão de queda onde não houve nada.
CREATE OR REPLACE FUNCTION public.financeiro_empresa_painel(_company_id UUID)
RETURNS TABLE (
  company_id        UUID,
  company_name      TEXT,
  pricing_type      TEXT,
  cliente_desde     DATE,
  projetos          INTEGER,
  faturado          NUMERIC,
  recebido          NUMERIC,
  aberto            NUMERIC,
  abertos_qtd       INTEGER,
  pagamentos        INTEGER,
  prazo_medio_dias  NUMERIC,
  ultimo_pagamento  DATE,
  ultimo_valor      NUMERIC,
  valores_distintos INTEGER,
  valor_min         NUMERIC,
  valor_max         NUMERIC,
  ticket_medio      NUMERIC,
  serie             JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH guarda AS (
    SELECT public.financeiro_empresa_visivel(_company_id) AS ok
  ), base AS (
    SELECT pr.id, pr.created_at, pf.project_value, pf.paid_value
      FROM public.projects pr
      JOIN public.project_financials pf ON pf.project_id = pr.id
     WHERE pr.company_id = _company_id AND NOT pr.is_deleted
       AND (SELECT ok FROM guarda)
  ), pagos AS (
    SELECT ph.payment_date, ph.amount, pr.created_at
      FROM public.payment_history ph
      JOIN public.projects pr ON pr.id = ph.project_id
     WHERE pr.company_id = _company_id AND NOT pr.is_deleted
       AND ph.entry_type = 'payment' AND ph.amount > 0
       AND (SELECT ok FROM guarda)
  ), meses AS (
    SELECT date_trunc('month', created_at)::date AS mes FROM base
    UNION
    SELECT date_trunc('month', payment_date)::date FROM pagos
  ), serie AS (
    SELECT m.mes,
           coalesce(pj.projetos, 0)  AS projetos,
           coalesce(pj.faturado, 0)  AS faturado,
           pj.ticket                 AS ticket,
           coalesce(pg.recebido, 0)  AS recebido
      FROM meses m
      LEFT JOIN (
        SELECT date_trunc('month', created_at)::date AS mes,
               count(*)::int                         AS projetos,
               sum(project_value)                    AS faturado,
               round(avg(project_value), 2)          AS ticket
          FROM base GROUP BY 1
      ) pj ON pj.mes = m.mes
      LEFT JOIN (
        SELECT date_trunc('month', payment_date)::date AS mes,
               sum(amount)                             AS recebido
          FROM pagos GROUP BY 1
      ) pg ON pg.mes = m.mes
     ORDER BY m.mes
  )
  SELECT co.id, co.name, co.pricing_type::text,
         (SELECT min(created_at)::date FROM base),
         (SELECT count(*)::int FROM base),
         (SELECT coalesce(sum(project_value), 0) FROM base),
         (SELECT coalesce(sum(paid_value), 0) FROM base),
         (SELECT coalesce(sum(greatest(project_value - paid_value, 0)), 0) FROM base),
         (SELECT count(*)::int FROM base WHERE project_value - paid_value > 0),
         (SELECT count(*)::int FROM pagos),
         (SELECT round(avg(payment_date - created_at::date), 0) FROM pagos),
         (SELECT max(payment_date) FROM pagos),
         (SELECT sum(amount) FROM pagos
           WHERE payment_date = (SELECT max(payment_date) FROM pagos)),
         (SELECT count(DISTINCT project_value)::int FROM base),
         (SELECT min(project_value) FROM base),
         (SELECT max(project_value) FROM base),
         (SELECT round(avg(project_value), 2) FROM base),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
             'mes', to_char(s.mes, 'YYYY-MM'),
             'projetos', s.projetos,
             'faturado', s.faturado,
             'recebido', s.recebido,
             'ticket', s.ticket
           ) ORDER BY s.mes) FROM serie s), '[]'::jsonb)
    FROM public.companies co
   WHERE co.id = _company_id AND (SELECT ok FROM guarda);
$$;
REVOKE ALL ON FUNCTION public.financeiro_empresa_painel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_empresa_painel(UUID) TO authenticated, service_role;

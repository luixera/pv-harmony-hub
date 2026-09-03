-- ─────────────────────────────────────────────────────────────────────────────
-- Assinatura mensal: dia de vencimento por empresa + geração automática
--
-- Relato do usuário (set/2026): o extrato de uma empresa com assinatura não
-- somava a mensalidade. Causa: só existia a competência de julho — a geração
-- é manual (um botão na tela Financeiro) e não rodava desde então, então
-- agosto e setembro nunca nasceram.
--
-- Duas mudanças:
--   1. `pricing_due_day` — o vencimento era sempre o último dia do mês, sem
--      escolha. Agora cada empresa tem o seu (AF ENERGY dia 30, Ouro Solar
--      dia 10). Dia maior que o mês (30 em fevereiro) cai no último dia.
--   2. Geração automática todo dia 1º, via pg_cron. A função existente exige
--      sessão de admin (`auth.uid()`), e o agendador não tem sessão — daí uma
--      irmã sem esse check, que só o cron executa.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS pricing_due_day SMALLINT
    CHECK (pricing_due_day IS NULL OR pricing_due_day BETWEEN 1 AND 31);

COMMENT ON COLUMN public.companies.pricing_due_day IS
  'Dia do vencimento da mensalidade (1-31). Nulo = último dia do mês.';

-- Vencimento da competência, respeitando meses curtos.
CREATE OR REPLACE FUNCTION public.subscription_due_date(_competence DATE, _due_day SMALLINT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _due_day IS NULL THEN (_competence + INTERVAL '1 month - 1 day')::DATE
    ELSE (_competence + (LEAST(
      _due_day,
      EXTRACT(DAY FROM (_competence + INTERVAL '1 month - 1 day'))::INT
    ) - 1) * INTERVAL '1 day')::DATE
  END;
$$;

-- ── Geração sob demanda (botão da tela Financeiro) ───────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_subscription_charges(_from DATE DEFAULT NULL, _to DATE DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _tenant uuid;
  _criadas int := 0;
  _c record;
  _mes date;
  _ini date; _fim date;
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  if not public.is_master(auth.uid())
     and coalesce(public.get_user_role(auth.uid())::text, '') not in ('admin', 'staff') then
    raise exception 'apenas admin ou staff';
  end if;
  _tenant := public.get_user_tenant_id(auth.uid());
  _fim := date_trunc('month', coalesce(_to, current_date))::date;

  for _c in
    select c.id, c.tenant_id, c.pricing_monthly_value, c.pricing_monthly_limit, c.pricing_due_day,
           (select min(date_trunc('month', p.created_at))::date
              from projects p where p.company_id = c.id and p.is_deleted = false) as primeiro_mes
    from companies c
    where c.pricing_type = 'monthly'
      and coalesce(c.active, true) = true
      and (public.is_master(auth.uid()) or c.tenant_id = _tenant)
  loop
    _ini := date_trunc('month', coalesce(_from, _c.primeiro_mes, current_date))::date;
    _mes := _ini;
    while _mes <= _fim loop
      insert into company_subscription_charges
        (tenant_id, company_id, competence, amount, projects_included, due_date, status)
      values
        (_c.tenant_id, _c.id, _mes, coalesce(_c.pricing_monthly_value, 0),
         _c.pricing_monthly_limit,
         public.subscription_due_date(_mes, _c.pricing_due_day), 'pending')
      on conflict (company_id, competence) do nothing;
      if found then _criadas := _criadas + 1; end if;
      _mes := (_mes + interval '1 month')::date;
    end loop;
  end loop;

  return _criadas;
end;
$$;

-- ── Geração automática (pg_cron) ─────────────────────────────────────────────
-- Sem o check de sessão: quem chama é o agendador, que não tem `auth.uid()`.
-- Gera SÓ a competência do mês corrente, para todos os tenants.
CREATE OR REPLACE FUNCTION public.ensure_subscription_charges_all()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _criadas int := 0;
  _c record;
  _mes date := date_trunc('month', current_date)::date;
begin
  for _c in
    select c.id, c.tenant_id, c.pricing_monthly_value, c.pricing_monthly_limit, c.pricing_due_day
    from companies c
    where c.pricing_type = 'monthly'
      and coalesce(c.active, true) = true
  loop
    insert into company_subscription_charges
      (tenant_id, company_id, competence, amount, projects_included, due_date, status)
    values
      (_c.tenant_id, _c.id, _mes, coalesce(_c.pricing_monthly_value, 0),
       _c.pricing_monthly_limit,
       public.subscription_due_date(_mes, _c.pricing_due_day), 'pending')
    on conflict (company_id, competence) do nothing;
    if found then _criadas := _criadas + 1; end if;
  end loop;

  return _criadas;
end;
$$;

-- Só o agendador executa: nenhum papel da aplicação recebe permissão.
REVOKE ALL ON FUNCTION public.ensure_subscription_charges_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_subscription_charges_all() FROM authenticated, anon;

-- Todo dia 1º às 06:00 UTC (03:00 em Brasília).
SELECT cron.unschedule('gerar-mensalidades')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gerar-mensalidades');

SELECT cron.schedule(
  'gerar-mensalidades',
  '0 6 1 * *',
  $cron$ SELECT public.ensure_subscription_charges_all(); $cron$
);

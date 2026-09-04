-- ─────────────────────────────────────────────────────────────────────────────
-- A mensalidade nasce NO DIA DO VENCIMENTO
--
-- Pedido do usuário (set/2026): gerada no dia 1º, a mensalidade ficava o mês
-- inteiro no extrato como "pendente" sem estar vencida, e não havia como
-- separar o que ele realmente tem a receber do que ainda vai vencer.
--
-- Seguro porque `compute_project_value` NÃO depende desta linha: o excedente
-- da franquia é contado direto da tabela `projects`, com o limite lido da
-- empresa. A cobrança nascer depois não altera o preço de projeto nenhum.
--
-- O que se perde (dito ao usuário): durante o mês, a competência corrente não
-- aparece no financeiro da empresa — nem o consumo "7 de 10 projetos". A
-- contagem continua correta; ela só passa a ser exibida quando a cobrança
-- nasce. Para voltar atrás, basta reagendar o job para '0 6 1 * *' chamando
-- ensure_subscription_charges_all().
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_subscription_charges_due()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _criadas int := 0;
  _c record;
  _mes date := date_trunc('month', current_date)::date;
  _venc date;
begin
  for _c in
    select c.id, c.tenant_id, c.pricing_monthly_value, c.pricing_monthly_limit, c.pricing_due_day
    from companies c
    where c.pricing_type = 'monthly'
      and coalesce(c.active, true) = true
  loop
    _venc := public.subscription_due_date(_mes, _c.pricing_due_day);

    -- `<=` e não `=`: se o job falhar num dia, a cobrança nasce no próximo —
    -- não fica um mês inteiro sem existir por causa de uma execução perdida.
    if current_date >= _venc then
      insert into company_subscription_charges
        (tenant_id, company_id, competence, amount, projects_included, due_date, status)
      values
        (_c.tenant_id, _c.id, _mes, coalesce(_c.pricing_monthly_value, 0),
         _c.pricing_monthly_limit, _venc, 'pending')
      on conflict (company_id, competence) do nothing;
      if found then _criadas := _criadas + 1; end if;
    end if;
  end loop;

  return _criadas;
end;
$$;

REVOKE ALL ON FUNCTION public.ensure_subscription_charges_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_subscription_charges_due() FROM authenticated, anon;

-- Passa a rodar TODO DIA: o que decide é o vencimento de cada empresa, que
-- varia (AF ENERGY dia 30, Ouro Solar dia 10). Um job mensal no dia 1º não
-- daria conta.
SELECT cron.unschedule('gerar-mensalidades')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gerar-mensalidades');

SELECT cron.schedule(
  'gerar-mensalidades',
  '0 6 * * *',
  $cron$ SELECT public.ensure_subscription_charges_due(); $cron$
);

-- ── Coerência da contagem: Brasília também aqui ──────────────────────────────
-- `compute_project_value` conta a franquia com date_trunc em UTC, enquanto o
-- extrato já passou a contar em Brasília. Na virada do mês os dois poderiam
-- discordar — um projeto das 22h do dia 31 entraria na franquia de um mês para
-- o preço e de outro para o extrato.
CREATE OR REPLACE FUNCTION public.compute_project_value(_project_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _company uuid; _created timestamptz; _tenant uuid;
  _ptype public.pricing_type;
  _fixed numeric; _rate numeric; _tiers jsonb; _mlimit int; _excess numeric; _art numeric;
  _kwp numeric; _count int; _val numeric := 0;
  _mes_ini timestamptz; _mes_fim timestamptz;
begin
  select company_id, created_at, tenant_id into _company, _created, _tenant
    from projects where id = _project_id;
  if _company is null then return 0; end if;

  select pricing_type, pricing_fixed_value, pricing_kwp_rate, pricing_tiers,
         pricing_monthly_limit, pricing_excess_value
    into _ptype, _fixed, _rate, _tiers, _mlimit, _excess
  from companies where id = _company;

  select coalesce(total_installed_power, 0) into _kwp
    from project_equipment where project_id = _project_id;
  _kwp := coalesce(_kwp, 0);

  if _ptype = 'fixed' then
    _val := coalesce(_fixed, 0);

  elsif _ptype = 'per_kwp' then
    _val := round(_kwp * coalesce(_rate, 0), 2);

  elsif _ptype = 'tiered_kwp' then
    select (t->>'rate')::numeric into _rate
    from jsonb_array_elements(coalesce(_tiers, '[]'::jsonb)) t
    where (t->>'up_to') is null or _kwp <= (t->>'up_to')::numeric
    order by ((t->>'up_to') is null), nullif(t->>'up_to','')::numeric nulls last
    limit 1;
    _val := round(_kwp * coalesce(_rate, 0), 2);

  elsif _ptype = 'tiered_flat' then
    select (t->>'price')::numeric into _val
    from jsonb_array_elements(coalesce(_tiers, '[]'::jsonb)) t
    where _kwp >= coalesce(nullif(t->>'from','')::numeric, 0)
      and ((t->>'to') is null or t->>'to' = '' or _kwp <= (t->>'to')::numeric)
    order by coalesce(nullif(t->>'from','')::numeric, 0)
    limit 1;
    _val := coalesce(_val, 0);

  elsif _ptype = 'monthly' then
    -- a mensalidade é cobrada à parte (company_subscription_charges);
    -- no projeto entra a RT, mais o excedente quando passa da franquia do mês
    select art_value into _art from tenants where id = _tenant;

    -- mês do calendário de BRASÍLIA, igual ao extrato
    _mes_ini := (date_trunc('month', _created at time zone 'America/Sao_Paulo'))
                  at time zone 'America/Sao_Paulo';
    _mes_fim := (date_trunc('month', _created at time zone 'America/Sao_Paulo') + interval '1 month')
                  at time zone 'America/Sao_Paulo';

    select count(*) into _count from projects
    where company_id = _company and is_deleted = false
      and created_at >= _mes_ini
      and created_at <  _mes_fim
      and created_at <= _created
      and id <> _project_id;

    _val := coalesce(_art, 0);
    if _mlimit is not null and _count >= _mlimit then
      _val := _val + coalesce(_excess, 0);
    end if;

  else
    _val := 0;
  end if;

  return _val;
end;
$$;

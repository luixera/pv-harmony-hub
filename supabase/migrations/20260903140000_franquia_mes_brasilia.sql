-- ─────────────────────────────────────────────────────────────────────────────
-- A franquia do mês conta pelo calendário de BRASÍLIA
--
-- Regra confirmada com o usuário (set/2026): a franquia é o mês do calendário,
-- do dia 1º ao último (30, 31 ou 28). Era o que o sistema já fazia — com um
-- detalhe que ainda não tinha mordido ninguém: a sessão do banco roda em UTC,
-- e `date_trunc('month', created_at)` seguia o fuso da sessão.
--
-- Efeito prático: projeto enviado às 22h de Brasília no dia 31 é gravado como
-- dia 1º em UTC e contaria na franquia do MÊS SEGUINTE — e noite é justamente
-- quando integrador envia projeto. Hoje há ZERO projetos nessa condição, então
-- esta mudança não altera nenhuma cobrança existente; ela evita a errada.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.company_subscription_statement(_company_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID, competence DATE, amount NUMERIC, amount_paid NUMERIC,
  status TEXT, due_date DATE, project_limit INT, projects_count INT,
  excess_count INT, excess_value NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  _co uuid; _tenant uuid; _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'sem sessão'; end if;

  -- sem parâmetro, é o extrato da empresa do próprio usuário
  _co := coalesce(_company_id, public.get_user_company_id(_uid));
  if _co is null then return; end if;

  select c.tenant_id into _tenant from companies c where c.id = _co;
  if _tenant is null then return; end if;

  -- o master, o admin/staff do tenant da empresa, ou a própria empresa
  if not (
    public.is_master(_uid)
    or (_tenant = public.get_user_tenant_id(_uid)
        and coalesce(public.get_user_role(_uid)::text, '') in ('admin', 'staff'))
    or public.get_user_company_id(_uid) = _co
  ) then
    raise exception 'sem acesso às cobranças desta empresa';
  end if;

  return query
  with usados as (
    -- AT TIME ZONE: o mês é o de Brasília, não o de UTC (ver cabeçalho)
    select date_trunc('month', p.created_at at time zone 'America/Sao_Paulo')::date as competence,
           count(*)::int as qtd
    from projects p
    where p.company_id = _co and p.is_deleted = false
    group by 1
  )
  select s.id, s.competence, s.amount, s.amount_paid, s.status, s.due_date,
         s.projects_included as project_limit,
         coalesce(u.qtd, 0) as projects_count,
         case
           when s.projects_included is null then 0
           else greatest(0, coalesce(u.qtd, 0) - s.projects_included)
         end as excess_count,
         coalesce(c.pricing_excess_value, 0) as excess_value
  from company_subscription_charges s
  join companies c on c.id = s.company_id
  left join usados u on u.competence = s.competence
  where s.company_id = _co
  order by s.competence desc;
end;
$$;

-- Mesma correção na descoberta do primeiro mês da empresa, para a geração
-- retroativa não criar uma competência a mais no limite da virada.
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
           (select min(date_trunc('month', p.created_at at time zone 'America/Sao_Paulo'))::date
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

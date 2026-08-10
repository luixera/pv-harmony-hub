-- ═══════════════════════════════════════════════════════════════════════════
-- Vínculo PROJETISTA ↔ EMPRESAS
--
-- Pedido do usuário (ago/2026): "quero conseguir atribuir todos os projetos de
-- uma empresa para o projetista, assim não preciso ficar atribuindo os projetos
-- manualmente".
--
-- Por isso é um VÍNCULO e não uma atribuição em lote: valendo daqui pra frente,
-- todo projeto da empresa — inclusive os que chegarem depois — já nasce visível
-- pro projetista, sem ninguém fazer nada.
--
-- Um projetista pode atender VÁRIAS empresas (N:N). O vínculo SOMA com as
-- atribuições individuais que já existem: quem é `assigned_only` enxerga os
-- projetos atribuídos a ele MAIS os das empresas ligadas a ele.
--
-- Não confundir com `profiles.company_id`, que é do papel `company` (a empresa
-- cliente que faz login). Projetista não "pertence" a uma empresa.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.staff_companies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  staff_user_id uuid not null references public.profiles(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  unique (staff_user_id, company_id)
);

create index if not exists idx_staff_companies_staff   on public.staff_companies(staff_user_id);
create index if not exists idx_staff_companies_company on public.staff_companies(company_id);
create index if not exists idx_staff_companies_tenant  on public.staff_companies(tenant_id);

-- tenant_id sai do perfil do projetista: quem chama não precisa (nem deve)
-- escolher o tenant do vínculo
create or replace function public.set_staff_company_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.tenant_id is null then
    select p.tenant_id into new.tenant_id from profiles p where p.id = new.staff_user_id;
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_staff_companies_tenant on public.staff_companies;
create trigger trg_staff_companies_tenant
before insert on public.staff_companies
for each row execute function public.set_staff_company_tenant();

alter table public.staff_companies enable row level security;

-- Leitura: o master, e quem é do mesmo tenant (o admin precisa montar a lista;
-- o projetista precisa saber quais são as empresas dele).
drop policy if exists staff_companies_read on public.staff_companies;
create policy staff_companies_read
on public.staff_companies for select to authenticated
using (
  public.is_master(auth.uid())
  or tenant_id = public.get_user_tenant_id(auth.uid())
);

-- Escrita: só admin do MESMO tenant (ou master). Projetista não se autoatribui.
drop policy if exists staff_companies_write on public.staff_companies;
create policy staff_companies_write
on public.staff_companies for all to authenticated
using (
  public.is_master(auth.uid())
  or (tenant_id = public.get_user_tenant_id(auth.uid())
      and public.get_user_role(auth.uid()) = 'admin'::user_role)
)
with check (
  public.is_master(auth.uid())
  or (tenant_id = public.get_user_tenant_id(auth.uid())
      and public.get_user_role(auth.uid()) = 'admin'::user_role)
);

-- Vínculo e projeto TÊM de ser do mesmo tenant. Sem isto, um admin poderia
-- ligar um projetista do tenant dele a uma empresa de outro tenant e furar o
-- isolamento por tabelinha de junção.
create or replace function public.check_staff_company_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _company_tenant uuid; _staff_tenant uuid;
begin
  select c.tenant_id into _company_tenant from companies c where c.id = new.company_id;
  select p.tenant_id into _staff_tenant  from profiles  p where p.id = new.staff_user_id;
  if _company_tenant is null or _staff_tenant is null or _company_tenant <> _staff_tenant then
    raise exception 'Projetista e empresa precisam ser do mesmo tenant';
  end if;
  return new;
end $$;

drop trigger if exists trg_staff_companies_mesmo_tenant on public.staff_companies;
create trigger trg_staff_companies_mesmo_tenant
before insert or update on public.staff_companies
for each row execute function public.check_staff_company_tenant();

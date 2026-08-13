-- ═══════════════════════════════════════════════════════════════════════════
-- ARQUIVAR PROJETOS (pedido do usuário, ago/2026)
--
-- Some do Kanban/lista/mapa, com botão "Mostrar arquivados" para reaparecer.
-- **Não é exclusão**: `is_deleted` continua sendo outra coisa (lixeira), e o
-- projeto arquivado segue inteiro no banco.
--
-- Decisões do usuário nesta rodada:
-- - quem arquiva: admin e projetista (a empresa cliente não);
-- - Financeiro e Relatórios CONTINUAM contando o projeto arquivado — arquivar
--   é organização visual, não pode mudar número de cobrança. Por isso a
--   filtragem é do lado do cliente (`useProjects`), e não uma política que
--   escondesse o projeto de todo mundo: aquelas telas leem `projects` por
--   consultas próprias e continuam enxergando tudo;
-- - a empresa cliente NÃO vê o projeto arquivado — e isso sim vai no RLS,
--   porque é regra de acesso, não de tela.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);

-- o índice parcial serve à consulta do dia a dia: "não arquivados"
create index if not exists idx_projects_archived_at
  on public.projects(tenant_id) where archived_at is null;

comment on column public.projects.archived_at is
  'Arquivado (sai do Kanban/lista/mapa e da visão da empresa). Não é exclusão — ver is_deleted.';

-- ── A empresa cliente deixa de enxergar o que foi arquivado ────────────────
-- O corpo antigo é lido do catálogo e só recebe o "AND archived_at IS NULL" —
-- não é redigitado, mesma precaução das outras rodadas (o corpo versionado no
-- repositório pode estar defasado em relação ao banco).
do $do$
declare r record;
begin
  for r in
    select c.relname::text as tbl, pol.polname::text as pol,
           pg_get_expr(pol.polqual, pol.polrelid) as corpo
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relname = 'projects'
       and pol.polcmd = 'r'
       and pol.polname in ('Company can view own projects', 'Company users can view their own projects')
       and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') not like '%archived_at%'
  loop
    execute format('alter policy %I on public.projects using ((%s) and archived_at is null)', r.pol, r.corpo);
    raise notice 'empresa deixa de ver arquivado: %', r.pol;
  end loop;
end $do$;

-- ── Arquivar/desarquivar: RPC, para checar papel e tenant no servidor ──────
-- Sem isto, bastaria um UPDATE direto em `archived_at` — e a política de
-- UPDATE de projects hoje só exige ser admin OU staff, sem olhar de quem é o
-- projeto. Aqui o tenant é conferido explicitamente.
create or replace function public.set_project_archived(_project_id uuid, _archived boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _meu_tenant uuid; _do_projeto uuid; _papel user_role;
begin
  select p.tenant_id, p.role into _meu_tenant, _papel from profiles p where p.id = auth.uid();
  select pr.tenant_id into _do_projeto from projects pr where pr.id = _project_id;

  if _meu_tenant is null or _do_projeto is null or _meu_tenant <> _do_projeto then
    raise exception 'Projeto de outro tenant';
  end if;
  if _papel is null or _papel not in ('admin'::user_role, 'staff'::user_role) then
    raise exception 'Somente administrador ou projetista pode arquivar';
  end if;

  update projects
     set archived_at = case when _archived then now() else null end,
         archived_by = case when _archived then auth.uid() else null end
   where id = _project_id;
end $$;

revoke all on function public.set_project_archived(uuid, boolean) from public;
grant execute on function public.set_project_archived(uuid, boolean) to authenticated;

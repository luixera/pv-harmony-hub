-- ═══════════════════════════════════════════════════════════════════════════
-- VERSÕES DO DIAGRAMA UNIFILAR
--
-- Hoje `project_diagrams` guarda UM diagrama por projeto, com autosave por
-- upsert: cada edição sobrescreve a anterior e não há como voltar. Gerar de
-- novo pelo motor também substitui tudo — foi assim que um clique errado em
-- "é microinversor" apagou o unifilar já pronto de um projeto (ago/2026).
--
-- Esta tabela guarda instantâneos nomeados. Não substitui `project_diagrams`
-- (que continua sendo o diagrama VIGENTE, o que abre na aba): é o histórico
-- ao lado, para restaurar.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.project_diagram_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  -- 'manual' (o usuário salvou) | 'auto' (guardado antes de uma regeração
  -- apagar o anterior) — a UI mostra os dois, mas a limpeza automática só
  -- pode remover os 'auto'
  origin      text not null default 'manual',
  scene_data  jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

create index if not exists idx_diagram_versions_project
  on public.project_diagram_versions(project_id, created_at desc);
create index if not exists idx_diagram_versions_tenant
  on public.project_diagram_versions(tenant_id);

alter table public.project_diagram_versions enable row level security;

-- Mesmas regras de `project_diagrams`: isolamento RESTRICTIVE por tenant +
-- admin/staff gerenciam. A empresa cliente não vê versão de diagrama.
drop policy if exists tenant_isolation on public.project_diagram_versions;
create policy tenant_isolation
on public.project_diagram_versions
as restrictive
for all to public
using (tenant_id = public.get_user_tenant_id(auth.uid()))
with check (tenant_id = public.get_user_tenant_id(auth.uid()));

drop policy if exists "Admin and staff manage diagram versions" on public.project_diagram_versions;
create policy "Admin and staff manage diagram versions"
on public.project_diagram_versions
for all to authenticated
using (public.has_role(auth.uid(), 'admin'::user_role) or public.has_role(auth.uid(), 'staff'::user_role))
with check (public.has_role(auth.uid(), 'admin'::user_role) or public.has_role(auth.uid(), 'staff'::user_role));

-- tenant_id vem do projeto: quem chama não escolhe (mesma precaução de
-- `staff_companies`), e assim uma versão nunca nasce apontando para outro
-- tenant.
create or replace function public.set_diagram_version_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select p.tenant_id into new.tenant_id from projects p where p.id = new.project_id;
  if new.tenant_id is null then
    raise exception 'projeto % nao encontrado', new.project_id;
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_diagram_version_tenant on public.project_diagram_versions;
create trigger trg_diagram_version_tenant
before insert on public.project_diagram_versions
for each row execute function public.set_diagram_version_tenant();

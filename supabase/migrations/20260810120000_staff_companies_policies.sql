-- ═══════════════════════════════════════════════════════════════════════════
-- O vínculo projetista↔empresa passa a valer DE VERDADE no RLS.
--
-- Diagnóstico (ago/2026): o vínculo estava gravado, `staff_can_access_project`
-- já devolvia `true` para os projetos da empresa ligada — e mesmo assim o
-- projetista não via nada. Motivo: **nenhuma política de `projects` chama
-- `staff_can_access_project`**. As 11 políticas de leitura do projetista
-- restrito checam `project_assignments` no próprio corpo. Mexer na função não
-- tinha como surtir efeito.
--
-- Correção: cada uma dessas políticas ganha um "OU é projeto de empresa ligada
-- a mim". O corpo antigo é preservado **literalmente** (lido de `pg_get_expr`,
-- não redigitado) e só recebe o OR — mesma precaução da rodada anterior, para
-- não apagar regra de produção que não está versionada aqui.
--
-- A checagem do vínculo vai em função SECURITY DEFINER: dentro de uma política,
-- subconsulta a outra tabela com RLS reavalia a RLS daquela tabela (e em
-- `projects` daria recursão). A função roda como dona e não recursa.
--
-- Idempotente: políticas que já contêm `staff_ligado` são puladas.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.staff_ligado_ao_projeto(_user_id uuid, _project_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from projects p
      join staff_companies sc on sc.company_id = p.company_id
     where p.id = _project_id
       and sc.staff_user_id = _user_id
  )
$$;

-- As tabelas de revisão não têm project_id: chegam nele pela revisão.
create or replace function public.staff_ligado_a_revisao(_user_id uuid, _revision_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from project_revisions r
      join projects p        on p.id = r.project_id
      join staff_companies sc on sc.company_id = p.company_id
     where r.id = _revision_id
       and sc.staff_user_id = _user_id
  )
$$;

do $do$
declare r record; _add text;
begin
  for r in
    select c.relname::text as tbl, pol.polname::text as pol,
           pg_get_expr(pol.polqual, pol.polrelid) as corpo
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
     where c.relnamespace = 'public'::regnamespace
       and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') like '%project_assignments%'
       and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') not like '%staff_ligado%'
  loop
    if r.tbl = 'projects' then
      -- projeto excluído continua escondido: o ramo novo repete a condição
      _add := 'public.staff_ligado_ao_projeto(auth.uid(), projects.id) and projects.is_deleted = false';
    elsif r.tbl in ('revision_equipment', 'revision_general_data') then
      _add := format('public.staff_ligado_a_revisao(auth.uid(), %I.revision_id)', r.tbl);
    else
      _add := format('public.staff_ligado_ao_projeto(auth.uid(), %I.project_id)', r.tbl);
    end if;

    execute format('alter policy %I on public.%I using ((%s) or (%s))', r.pol, r.tbl, r.corpo, _add);
    raise notice 'estendida: %.%', r.tbl, r.pol;
  end loop;
end $do$;

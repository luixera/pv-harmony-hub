-- ═══════════════════════════════════════════════════════════════════════════
-- O acesso do projetista `assigned_only` passa a considerar TAMBÉM as empresas
-- ligadas a ele (tabela `staff_companies`), não só as atribuições individuais.
--
-- ⚠️ ANTES DE APLICAR: confira o corpo ATUAL de `staff_can_access_project` no
-- banco e replique aqui. Este arquivo foi escrito a partir da versão do
-- repositório (migração 20260112223210); se a função tiver sido alterada
-- depois por alguma migração aplicada direto no banco, aplicar isto sem
-- comparar REGRIDE a alteração. O único trecho novo é o `OR EXISTS (...)` do
-- `assigned_only`.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.staff_can_access_project(_user_id uuid, _project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      -- admin enxerga tudo
      when has_role(_user_id, 'admin'::user_role) then true
      -- staff com acesso global enxerga tudo
      when has_role(_user_id, 'staff'::user_role) and
           (select staff_access_mode from profiles where id = _user_id) = 'global' then true
      -- staff restrito: atribuição individual OU empresa ligada a ele
      when has_role(_user_id, 'staff'::user_role) and
           (select staff_access_mode from profiles where id = _user_id) = 'assigned_only' then
           exists (
             select 1 from project_assignments
             where project_id = _project_id and staff_user_id = _user_id
           )
           or exists (
             select 1
             from projects p
             join staff_companies sc on sc.company_id = p.company_id
             where p.id = _project_id and sc.staff_user_id = _user_id
           )
      else false
    end
$$;

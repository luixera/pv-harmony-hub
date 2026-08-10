-- ═══════════════════════════════════════════════════════════════════════════
-- O acesso do projetista passa a considerar TAMBÉM as empresas ligadas a ele
-- (`staff_companies`), além das atribuições individuais.
--
-- Por que NÃO reescrevemos a função com um corpo novo: boa parte das alterações
-- desta base foi aplicada direto no banco e não está versionada aqui, então o
-- corpo do repositório pode estar defasado — sobrescrever no escuro apagaria
-- regra em produção sem ninguém perceber.
--
-- Em vez disso: a regra ATUAL é copiada, intacta e seja ela qual for, para
-- `staff_can_access_project_base`, e a função original vira
-- "regra de antes OU projeto de empresa ligada ao projetista". Não há um corpo
-- chumbado aqui — o script lê o que existe e preserva.
--
-- Idempotente: se `..._base` já existe, não faz nada. Sem essa guarda, rodar
-- duas vezes faria a base virar uma chamada a si mesma (recursão infinita).
--
-- Aplicado em produção pelo usuário via SQL Editor em 2026-08-10 (o MCP do
-- Supabase estava fora do ar).
-- ═══════════════════════════════════════════════════════════════════════════

do $do$
declare _def text;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'staff_can_access_project_base'
  ) then
    raise notice 'ja aplicado, nada a fazer';
    return;
  end if;

  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'staff_can_access_project';

  if _def is null then
    raise exception 'funcao staff_can_access_project nao encontrada';
  end if;

  -- 1) preserva a regra atual, sem alterar nada, com outro nome
  execute replace(_def,
    'FUNCTION public.staff_can_access_project(',
    'FUNCTION public.staff_can_access_project_base(');

  -- 2) a original vira: regra de antes OU empresa ligada ao projetista
  execute $f$
    create or replace function public.staff_can_access_project(_user_id uuid, _project_id uuid)
    returns boolean language sql stable security definer set search_path = public
    as $body$
      select public.staff_can_access_project_base(_user_id, _project_id)
          or exists (
               select 1 from projects p
               join staff_companies sc on sc.company_id = p.company_id
               where p.id = _project_id and sc.staff_user_id = _user_id
             )
    $body$
  $f$;
end $do$;

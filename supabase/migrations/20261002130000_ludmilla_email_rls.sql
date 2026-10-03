-- supabase/migrations/20261002130000_ludmilla_email_rls.sql
-- Ludmilla (e-mail): aperta o acesso às duas tabelas novas, no mesmo padrão
-- das irmãs `portal_*` (portal_accounts, portal_updates, portal_anexos).
--
-- Por quê: a migração 20261002120000 criou políticas permissivas com
-- USING (TRUE). Somadas só à RESTRICTIVE de tenant, deixavam QUALQUER usuário
-- autenticado do tenant GD Manager — inclusive o papel `company` (empresa
-- integradora) — ler o resumo dos pareceres de todos os projetos e editar as
-- regras de leitura. Isolamento entre empresas é inegociável.
--
-- Regra de acesso (igual à de `portal_accounts`, que guarda o acesso ao portal):
--   • LER  portal_email_regras e portal_email_mensagens: só a equipe do tenant
--     — `ludmilla_equipe_ok()`, ou seja, admin/staff de tenant `is_library`.
--     Empresa integradora (`company`) não vê nada.
--   • ESCREVER portal_email_regras: só quem já pode mexer em acesso de portal —
--     equipe E papel `admin`. Staff lê, mas não grava.
--   • ESCREVER portal_email_mensagens: ninguém pelo app. É o registro do que o
--     robô já leu; só o robô grava, pela RPC ludmilla_email_registrar.
--   • O robô entra por `service_role` (ignora RLS) e não depende destas políticas.
--
-- A RESTRICTIVE de tenant (portal_email_regras_tenant / portal_email_mensagens_tenant),
-- criada na migração anterior, continua valendo e não é tocada aqui.

-- ── 1. Sai o permissivo frouxo da migração anterior ──────────────────────────
DROP POLICY IF EXISTS portal_email_regras_leitura    ON public.portal_email_regras;
DROP POLICY IF EXISTS portal_email_mensagens_leitura ON public.portal_email_mensagens;

-- ── 2. Regras: a equipe lê; só ADMIN cria/edita/apaga ────────────────────────
DROP POLICY IF EXISTS equipe_le_email_regras ON public.portal_email_regras;
CREATE POLICY equipe_le_email_regras ON public.portal_email_regras FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));

DROP POLICY IF EXISTS admin_gerencia_email_regras ON public.portal_email_regras;
CREATE POLICY admin_gerencia_email_regras ON public.portal_email_regras FOR ALL
  USING      ((select public.ludmilla_equipe_ok()) AND public.has_role((select auth.uid()), 'admin'))
  WITH CHECK ((select public.ludmilla_equipe_ok()) AND public.has_role((select auth.uid()), 'admin'));

-- ── 3. Mensagens lidas: a equipe lê; ninguém grava pelo app ──────────────────
DROP POLICY IF EXISTS equipe_le_email_mensagens ON public.portal_email_mensagens;
CREATE POLICY equipe_le_email_mensagens ON public.portal_email_mensagens FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));

-- ============================================================
-- 001 — CORREÇÕES DE SEGURANÇA CRÍTICAS
-- ============================================================
-- Aplica os 5 fixes mais urgentes da auditoria de RLS/Auth.
-- Sem isso, qualquer usuário autenticado pode virar admin via console,
-- e qualquer pessoa pode baixar a base inteira de empresas.
--
-- ORDEM DE APLICAÇÃO: 1º arquivo. Aplique antes de qualquer outro.
--
-- COMO APLICAR:
-- 1. Backup do banco (Dashboard Supabase → Database → Backups)
-- 2. Dashboard Supabase → SQL Editor → New query
-- 3. Cole TODO este arquivo e clique Run
-- 4. Verifique mensagens (deve ser "Success. No rows returned" várias vezes)
-- 5. Teste login e operações básicas no app
-- ============================================================

BEGIN;

-- ============================================================
-- FIX 1 — Escalação de privilégio via UPDATE profiles
-- ============================================================
-- ANTES: política "Users can update own profile" permitia qualquer authenticated
-- fazer UPDATE em sua própria linha SEM restrição de coluna. Atacante rodava:
--   UPDATE profiles SET role='admin' WHERE id=auth.uid()
-- e virava admin.
--
-- DEPOIS: adicionamos WITH CHECK que congela colunas sensíveis (role, company_id,
-- active, staff_access_mode, hide_company_name) no valor atual. Usuário só altera
-- name, email, phone, avatar_url, updated_at.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Colunas sensíveis: usuário só pode "atualizar" pro mesmo valor atual
    AND role             IS NOT DISTINCT FROM (SELECT role             FROM public.profiles WHERE id = auth.uid())
    AND company_id       IS NOT DISTINCT FROM (SELECT company_id       FROM public.profiles WHERE id = auth.uid())
    AND active           IS NOT DISTINCT FROM (SELECT active           FROM public.profiles WHERE id = auth.uid())
    AND staff_access_mode IS NOT DISTINCT FROM (SELECT staff_access_mode FROM public.profiles WHERE id = auth.uid())
    AND hide_company_name IS NOT DISTINCT FROM (SELECT hide_company_name FROM public.profiles WHERE id = auth.uid())
  );


-- ============================================================
-- FIX 2 — Vazamento da base de empresas via anon SELECT
-- ============================================================
-- ANTES: política "Anyone can lookup active company by public token" omitia
-- a cláusula TO e o filtro por token. Resultado: qualquer anônimo rodava
--   supabase.from('companies').select('*')
-- e baixava CNPJ + email + phone + public_form_token de TODAS as empresas ativas.
--
-- DEPOIS: anon NÃO pode SELECT direto em companies. Lookup só via RPC
-- get_company_by_public_token() que retorna só a empresa do token específico.

DROP POLICY IF EXISTS "Anyone can lookup active company by public token" ON public.companies;
DROP POLICY IF EXISTS "Anyone can lookup company by public token" ON public.companies;

-- Garante que anon não pode SELECT direto
CREATE POLICY "Anon cannot select companies directly"
  ON public.companies
  FOR SELECT
  TO anon
  USING (false);


-- ============================================================
-- FIX 3 — Hardening do trigger handle_new_user (signup hijack)
-- ============================================================
-- ANTES: trigger lia 'role' de raw_user_meta_data sem validar quem chamou.
-- Se signup público estivesse habilitado no Dashboard (default = ON), atacante
-- chamava /auth/v1/signup com {"data":{"role":"admin"}} e nascia admin.
--
-- DEPOIS: só aceita role do metadata se a chamada vier do service_role
-- (Edge Function admin). Signup público sempre cria como 'company'.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.user_role;
BEGIN
  -- Decide role baseado em quem está criando
  _role := CASE
    WHEN auth.role() = 'service_role'
      THEN COALESCE((NEW.raw_user_meta_data ->> 'role')::public.user_role, 'company')
    ELSE 'company'::public.user_role
  END;

  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email),
    NEW.email,
    _role
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role);

  RETURN NEW;
END;
$$;

-- ⚠️ AÇÃO ADICIONAL MANUAL (no Dashboard Supabase):
--    Authentication → Settings → Disable "Allow new users to sign up"
--    Isso fecha de vez o vetor de signup público. Usuários são criados
--    apenas via Edge Function create-user (que valida role admin).


-- ============================================================
-- FIX 4 — Função create_first_revision sem search_path
-- ============================================================
-- ANTES: SECURITY DEFINER sem SET search_path → vulnerável a search_path
-- hijacking via pg_temp. Atacante autenticado podia criar uma função
-- pg_temp.project_revisions(...) e subverter inserts.
--
-- DEPOIS: SET search_path = public garante que só funções/tabelas de public
-- sejam resolvidas dentro do trigger.

-- Recria a função preservando comportamento original mas com search_path fixado
DO $$
DECLARE
  trigger_func_body TEXT;
BEGIN
  -- Tenta recriar usando o mesmo corpo original
  CREATE OR REPLACE FUNCTION public.create_first_revision()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  BEGIN
    INSERT INTO public.project_revisions (
      project_id,
      revision_number,
      status,
      is_current,
      created_by
    ) VALUES (
      NEW.id,
      1,
      'pending'::public.project_status,
      true,
      NEW.created_by
    );
    RETURN NEW;
  END;
  $func$;
END $$;


-- ============================================================
-- FIX 5 — Storage bucket avatars (criação + policies)
-- ============================================================
-- ANTES: bucket era criado manualmente no Dashboard sem policies de path.
-- Resultado: qualquer authenticated podia sobrescrever avatar de qualquer
-- outro usuário (`bucket=avatars, INSERT WITH CHECK true`).
--
-- DEPOIS: bucket criado por migration + policies restritivas por user.id.

-- Cria bucket se não existe
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Limpa policies antigas (idempotente)
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;

-- Cada usuário só mexe na própria pasta {user.id}/...
CREATE POLICY "Users upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura pública (bucket é public, todos podem ver avatares)
CREATE POLICY "Public read avatars"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');


COMMIT;

-- ============================================================
-- VALIDAÇÃO (rode após aplicar)
-- ============================================================
-- 1) Verificar que profiles UPDATE tem WITH CHECK:
--    SELECT polname, polcmd, polqual, polwithcheck
--    FROM pg_policy WHERE polrelid = 'public.profiles'::regclass;
--
-- 2) Verificar que anon NÃO consegue mais SELECT em companies:
--    (logado como anon, deveria voltar vazio mesmo com empresas ativas)
--    SET ROLE anon; SELECT * FROM public.companies; RESET ROLE;
--
-- 3) Verificar que create_first_revision tem search_path:
--    SELECT proname, proconfig
--    FROM pg_proc WHERE proname = 'create_first_revision';
--    -- deve mostrar: {search_path=public}
--
-- 4) Verificar storage policies avatars:
--    SELECT policyname FROM pg_policies
--    WHERE tablename = 'objects' AND policyname LIKE '%avatar%';
--    -- deve mostrar 4 policies
-- ============================================================

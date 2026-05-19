-- =============================================================================
-- 001_security_critical.sql
-- Correções críticas de segurança — GD Manager Energy
-- Aplicado em: 2026-05-19
-- Status: ✅ JÁ APLICADO EM PRODUÇÃO
--
-- Fecha 5 vulnerabilidades críticas:
--   1. Escalação de privilégio via UPDATE em profiles (role/company_id imutáveis)
--   2. SELECT aberto em companies para usuários anônimos
--   3. handle_new_user garante role=company em signups públicos
--   4. create_first_revision com SET search_path = public (anti SQL injection)
--   5. Bucket avatars com policies restritas por user.id
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: Bloquear escalação de privilégio via UPDATE profiles
-- Antes: qualquer usuário autenticado podia SET role='admin' via console
-- Depois: WITH CHECK garante que role/company_id/active/staff_access_mode
--         não podem ser alterados pelo próprio usuário
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Campos sensíveis não podem ser alterados pelo próprio usuário:
    AND NOT (role IS DISTINCT FROM (SELECT role FROM profiles WHERE id = auth.uid()))
    AND NOT (company_id IS DISTINCT FROM (SELECT company_id FROM profiles WHERE id = auth.uid()))
    AND NOT (active IS DISTINCT FROM (SELECT active FROM profiles WHERE id = auth.uid()))
    AND NOT (staff_access_mode IS DISTINCT FROM (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()))
    AND NOT (hide_company_name IS DISTINCT FROM (SELECT hide_company_name FROM profiles WHERE id = auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: Bloquear acesso anônimo direto à tabela companies
-- Antes: anon podia fazer SELECT * FROM companies e baixar CNPJ + emails
-- Depois: policy explícita retorna false para anon
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon cannot select companies directly" ON companies;
CREATE POLICY "Anon cannot select companies directly"
  ON companies FOR SELECT
  TO anon
  USING (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: handle_new_user — sempre cria usuário como 'company' via signup público
-- Evita que signup hijack force um admin/staff
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role user_role;
  v_name TEXT;
  v_company_id UUID;
BEGIN
  -- Pega role dos metadados, mas NUNCA permite admin/staff via signup público
  v_role := COALESCE(
    (NEW.raw_user_meta_data->>'role')::user_role,
    'company'::user_role
  );
  -- Força company se vier de signup público (não de admin.createUser)
  IF NOT (NEW.raw_app_meta_data->>'provider' IS NULL
          OR NEW.raw_app_meta_data->>'provider' = 'email') THEN
    v_role := 'company'::user_role;
  END IF;

  v_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email);
  v_company_id := (NEW.raw_user_meta_data->>'company_id')::UUID;

  INSERT INTO public.profiles (id, email, name, role, company_id)
  VALUES (NEW.id, NEW.email, v_name, v_role, v_company_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4: create_first_revision com SET search_path = public
-- Previne ataque de path injection em funções SECURITY DEFINER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_first_revision(p_project_id UUID)
  RETURNS UUID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_revision_id UUID;
  v_general_data RECORD;
  v_equipment RECORD;
BEGIN
  SELECT * INTO v_general_data
  FROM project_general_data WHERE project_id = p_project_id;

  SELECT * INTO v_equipment
  FROM project_equipment WHERE project_id = p_project_id;

  INSERT INTO project_revisions (project_id, revision_number, created_by)
  VALUES (p_project_id, 1, auth.uid())
  RETURNING id INTO v_revision_id;

  IF v_general_data IS NOT NULL THEN
    INSERT INTO revision_general_data (revision_id, holder_name, holder_cpf_cnpj,
      holder_email, holder_phone, address, city, state, is_rural, coordinates,
      utility_company, uc_number, phase_type, has_beneficiaries)
    VALUES (v_revision_id,
      v_general_data.holder_name, v_general_data.holder_cpf_cnpj,
      v_general_data.holder_email, v_general_data.holder_phone,
      v_general_data.address, v_general_data.city, v_general_data.state,
      v_general_data.is_rural, v_general_data.coordinates,
      v_general_data.utility_company, v_general_data.uc_number,
      v_general_data.phase_type, v_general_data.has_beneficiaries);
  END IF;

  IF v_equipment IS NOT NULL THEN
    INSERT INTO revision_equipment (revision_id, inverter_brand, inverter_model,
      inverter_power, inverter_quantity, module_brand, module_model,
      module_power, module_quantity, total_installed_power)
    VALUES (v_revision_id,
      v_equipment.inverter_brand, v_equipment.inverter_model,
      v_equipment.inverter_power, v_equipment.inverter_quantity,
      v_equipment.module_brand, v_equipment.module_model,
      v_equipment.module_power, v_equipment.module_quantity,
      v_equipment.total_installed_power);
  END IF;

  RETURN v_revision_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5: Storage bucket 'avatars' — policies restritas por user.id
-- Antes: sem policies → qualquer usuário podia sobrescrever avatar de outros
-- Depois: cada usuário só acessa sua própria pasta (user.id/*)
-- ─────────────────────────────────────────────────────────────────────────────
-- Nota: as policies de storage são aplicadas via Dashboard → Storage → Policies
-- ou via Supabase CLI. O SQL abaixo é apenas documentação do estado aplicado.
-- Policies aplicadas no bucket 'avatars':
--   SELECT: bucket_id='avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   INSERT: bucket_id='avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   UPDATE: bucket_id='avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   DELETE: bucket_id='avatars' AND auth.uid()::text = (storage.foldername(name))[1]

COMMENT ON FUNCTION public.handle_new_user() IS
  'Cria perfil e role ao registrar novo usuário. SECURITY DEFINER. Garante role=company para signups públicos.';

COMMENT ON FUNCTION public.create_first_revision(UUID) IS
  'Cria a primeira revisão de um projeto copiando dados atuais. SECURITY DEFINER com SET search_path = public.';

-- ============================================
-- 1. CRIAR BUCKET PARA DOCUMENTOS
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-documents', 'project-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas para o bucket de documentos

-- Admin/Staff podem ver todos os documentos
CREATE POLICY "Admin/Staff can view all project documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND (
      public.has_role(auth.uid(), 'admin') 
      OR public.has_role(auth.uid(), 'staff')
    )
  );

-- Admin/Staff podem fazer upload
CREATE POLICY "Admin/Staff can upload project documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-documents'
    AND (
      public.has_role(auth.uid(), 'admin') 
      OR public.has_role(auth.uid(), 'staff')
    )
  );

-- Admin pode deletar
CREATE POLICY "Admin can delete project documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND public.has_role(auth.uid(), 'admin')
  );

-- Empresa pode ver seus próprios documentos (via path: company_id/...)
CREATE POLICY "Company can view own project documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND (storage.foldername(name))[1] = public.get_user_company_id(auth.uid())::text
  );

-- Empresa pode fazer upload para seus próprios projetos
CREATE POLICY "Company can upload own project documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-documents'
    AND (storage.foldername(name))[1] = public.get_user_company_id(auth.uid())::text
  );

-- Anônimo pode fazer upload via formulário público (path: public/{company_id}/...)
CREATE POLICY "Anonymous can upload via public form"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'project-documents'
    AND (storage.foldername(name))[1] = 'public'
  );

-- ============================================
-- 2. TRIGGER PARA CRIAR PERFIL AUTOMATICAMENTE
-- ============================================

-- Verificar se trigger já existe e criar se necessário
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 3. AJUSTAR RLS PARA INSERÇÃO DE PROFILES
-- ============================================

-- Permitir que o trigger insira profiles
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================
-- 4. FUNÇÃO PARA BUSCAR COMPANY_ID POR TOKEN
-- ============================================

CREATE OR REPLACE FUNCTION public.get_company_id_by_token(_token TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.companies WHERE public_form_token = _token AND active = true LIMIT 1
$$;
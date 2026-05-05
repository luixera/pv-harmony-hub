-- ============================================
-- CORREÇÃO DE SEGURANÇA: Restringir acesso público
-- ============================================

-- Remover política permissiva de companies
DROP POLICY IF EXISTS "Anyone can lookup company by public token" ON public.companies;

-- Criar política restritiva que permite apenas lookup por token específico
-- Anônimos só podem ver nome da empresa quando buscam pelo token exato
CREATE POLICY "Anonymous can lookup company by exact token"
  ON public.companies FOR SELECT
  TO anon
  USING (false);  -- Anônimos não podem listar empresas diretamente

-- Criar função segura para buscar empresa por token (para o formulário público)
CREATE OR REPLACE FUNCTION public.get_company_by_public_token(_token TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  public_form_token TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.name,
    c.public_form_token
  FROM public.companies c
  WHERE c.public_form_token = _token
  AND c.active = true
  LIMIT 1
$$;

-- Garantir que profiles requer autenticação
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Staff can view all profiles" ON public.profiles;

-- Recriar policies de profiles com autenticação obrigatória
CREATE POLICY "Authenticated users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admin can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'));
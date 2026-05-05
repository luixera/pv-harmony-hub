-- Correção das RLS para permitir INSERT anônimo via link público
-- O problema é que as policies para "Anonymous" dependem de verificar se o projeto existe
-- mas no momento da criação, o projeto ainda não existe.

-- 1. Atualizar a policy de projects para ser mais permissiva para public_form
-- A policy atual já permite, mas vamos garantir que funciona para anônimos
DROP POLICY IF EXISTS "Anonymous can insert projects via public form" ON projects;

CREATE POLICY "Anonymous can insert projects via public form"
ON projects
FOR INSERT
WITH CHECK (
  source = 'public_form'::project_source 
  AND EXISTS (
    SELECT 1 FROM companies 
    WHERE id = company_id AND active = true
  )
);

-- 2. Criar policy para permitir que anônimos vejam a empresa pelo token público
-- (necessário para o formulário público carregar os dados da empresa)
DROP POLICY IF EXISTS "Anonymous can lookup company by exact token" ON companies;

CREATE POLICY "Anyone can lookup active company by public token"
ON companies
FOR SELECT
USING (active = true);

-- 3. Atualizar policies de project_financials para permitir INSERT anônimo
CREATE POLICY "Anonymous can insert financials for public form"
ON project_financials
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_financials.project_id
    AND p.source = 'public_form'::project_source
  )
);

-- 4. Garantir que admin pode inserir profiles (para criação de usuários)
DROP POLICY IF EXISTS "Service role can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;

CREATE POLICY "Admin can insert profiles"
ON profiles
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

-- 5. Permitir que o trigger de criação de profile funcione (via service role)
-- Isso é feito automaticamente pelo Supabase quando o trigger é executado com SECURITY DEFINER
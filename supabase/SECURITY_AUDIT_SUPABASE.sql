-- ============================================================
-- SECURITY AUDIT QUERIES — GD Manager Energy
-- Execute no Supabase SQL Editor para verificar estado do RLS
-- ============================================================

-- 1. Verificar quais tabelas têm RLS ativo
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 2. Listar todas as policies existentes
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. Verificar buckets de storage (público vs privado)
SELECT id, name, public
FROM storage.buckets
ORDER BY name;

-- 4. Verificar policies de storage
SELECT
  bucket_id,
  name,
  definition
FROM storage.policies
ORDER BY bucket_id, name;

-- 5. Verificar usuários admin ativos
SELECT id, email, name, role, active
FROM profiles
WHERE role = 'admin'
ORDER BY name;

-- 6. Verificar tokens públicos das empresas (comprimento mínimo)
SELECT
  id,
  name,
  LENGTH(public_token) AS token_length,
  CASE WHEN LENGTH(public_token) >= 32 THEN 'OK' ELSE 'CURTO' END AS token_status,
  is_active
FROM companies
ORDER BY name;

-- 7. Verificar projetos sem project_financials (orphans)
SELECT p.id, p.code, p.status
FROM projects p
LEFT JOIN project_financials pf ON pf.project_id = p.id
WHERE pf.id IS NULL
  AND (p.is_deleted IS NULL OR p.is_deleted = false);

-- 8. Verificar uploads recentes (possível abuso)
SELECT
  project_id,
  document_type,
  file_name,
  created_at
FROM documents
ORDER BY created_at DESC
LIMIT 50;

-- 9. Verificar tentativas de acesso com token inválido
-- (requer logging habilitado no Supabase — apenas informativo)
-- SELECT * FROM auth.audit_log_entries
-- WHERE event_message LIKE '%invalid%'
-- ORDER BY created_at DESC LIMIT 20;

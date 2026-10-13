-- ============================================================================
-- Assinador — o claim passa a devolver `company_id`.
--
-- A policy de leitura do bucket `project-documents` exige que o PRIMEIRO
-- segmento do caminho seja o id da EMPRESA (companies.id), não o do tenant.
-- Sem o company_id o robô montava `${tenant_id}/...`: o upload funcionava
-- (service_role ignora RLS), mas ninguém da equipe conseguia abrir o PDF
-- preparado para dar o "está certo". Convenção da casa:
--   ${company_id}/${project_id}/<tipo>/arquivo
--
-- O retorno da função muda, então CREATE OR REPLACE não serve: DROP + CREATE e
-- os grants refeitos. O corpo é idêntico ao de 20261003110000_assinatura_fluxo,
-- só acrescenta a coluna (a 18ª, no fim) vinda de projects.company_id (NOT NULL).
-- ============================================================================

DROP FUNCTION IF EXISTS public.assinatura_claim();

CREATE FUNCTION public.assinatura_claim()
RETURNS TABLE (
  id UUID, tenant_id UUID, project_id UUID, document_id UUID, assinavel_id UUID,
  certificado_id UUID, situacao TEXT, titular_nome TEXT, titular_cpf TEXT,
  codigo_verificacao TEXT, documento_aprovado_path TEXT, hash_aprovado TEXT,
  file_url TEXT, file_name TEXT, file_type TEXT, cidade TEXT, tentativas SMALLINT,
  company_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- `tentativas` limita o retry POR ETAPA (assinatura_passo zera ao mudar de
  -- situação). Quem esgotou as 3 e já está com o claim vencido vai para 'erro',
  -- onde a pessoa vê e pode cancelar — em vez de ficar inalcançável na fila e
  -- bloquear o documento pela checagem de duplicidade.
  UPDATE public.assinaturas a
     SET situacao = 'erro',
         erro = coalesce(a.erro, 'Esgotei as tentativas nesta etapa.'),
         claim_em = NULL, updated_at = now()
   WHERE a.situacao IN ('preparando', 'triagem', 'pendente')
     AND a.tentativas >= 3
     AND (a.claim_em IS NULL OR a.claim_em < now() - interval '10 minutes');

  SELECT a.id INTO _id FROM public.assinaturas a
   WHERE a.situacao IN ('preparando', 'triagem', 'pendente')
     AND a.tentativas < 3
     AND (a.claim_em IS NULL OR a.claim_em < now() - interval '10 minutes')
   ORDER BY a.created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF _id IS NULL THEN RETURN; END IF;

  UPDATE public.assinaturas a
     SET claim_em = now(), tentativas = a.tentativas + 1, updated_at = now()
   WHERE a.id = _id;

  RETURN QUERY
    SELECT a.id, a.tenant_id, a.project_id, a.document_id, a.assinavel_id,
           a.certificado_id, a.situacao, a.titular_nome, a.titular_cpf,
           a.codigo_verificacao, a.documento_aprovado_path, a.hash_aprovado,
           d.file_url, d.file_name, d.file_type,
           coalesce(g.city, '') AS cidade, a.tentativas,
           p.company_id
      FROM public.assinaturas a
      JOIN public.projects p ON p.id = a.project_id
      LEFT JOIN public.documents d ON d.id = a.document_id
      LEFT JOIN public.project_general_data g ON g.project_id = a.project_id
     WHERE a.id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_claim() TO service_role;

-- Conferência: 18 colunas, company_id entre elas, só service_role executa.
SELECT
  (SELECT count(*) FROM pg_proc p, unnest(p.proargnames, p.proargmodes) AS x(n, m)
    WHERE p.oid = 'public.assinatura_claim()'::regprocedure AND x.m = 't') AS colunas,
  (SELECT bool_or(x.n = 'company_id') FROM pg_proc p, unnest(p.proargnames, p.proargmodes) AS x(n, m)
    WHERE p.oid = 'public.assinatura_claim()'::regprocedure AND x.m = 't') AS tem_company_id,
  has_function_privilege('service_role', 'public.assinatura_claim()', 'EXECUTE') AS service_role_executa,
  has_function_privilege('authenticated', 'public.assinatura_claim()', 'EXECUTE') AS authenticated_executa,
  has_function_privilege('anon', 'public.assinatura_claim()', 'EXECUTE') AS anon_executa;

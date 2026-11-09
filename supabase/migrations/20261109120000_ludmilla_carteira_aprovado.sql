-- ═══════════════════════════════════════════════════════════════════════════
-- Ludmilla, entrega 1 (medir) — "com quem está" em Aprovado (09/11/2026).
--
-- Decisão do usuário: "Para pedir vistoria somos nós, para instalar é com a
-- empresa cliente". Em Aprovado o projeto passa por dois momentos:
--   · a empresa cliente está instalando           → 'cliente' (com a empresa)
--   · a empresa avisou que instalou e falta pedir  → 'nos'     (com a gente)
-- O aviso de instalação feita é o pedido de vistoria da empresa pelo painel:
-- solicitar_vistoria() cria tarefas com origin = 'vistoria_request'. Conta só
-- o pedido feito DEPOIS de o projeto entrar em Aprovado (last_status_change).
--
-- Só ludmilla_carteira() muda, e só no ramo de Aprovado; copiada da versão
-- aplicada em 20261108200000_ludmilla_medir.sql.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ludmilla_carteira()
RETURNS TABLE (project_id uuid, code text, titular text, empresa text, company_id uuid,
               concessionaria text, concessionaire_id uuid, status text, na_etapa_desde timestamptz,
               dias_na_etapa numeric, normal_dias integer, normal_fonte text, atraso_dias numeric,
               com_quem text, donos jsonb, historico jsonb, na_fila boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _tenant uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  _tenant := public.get_user_tenant_id((SELECT auth.uid()));

  RETURN QUERY
  WITH ativos AS (
    SELECT p.id, p.code, p.title, p.company_id, p.concessionaire_id, p.status::text AS status, p.last_status_change
      FROM public.projects p
     WHERE p.tenant_id = _tenant AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed'
  ), normais AS (
    SELECT * FROM public.ludmilla_normais_do_tenant(_tenant)
  ), pass AS (
    SELECT * FROM public.ludmilla_passagens(_tenant)
  ), fila AS (
    SELECT u.project_id AS pid FROM public.portal_updates u
     WHERE u.tenant_id = _tenant AND u.situacao = 'pendente' AND u.project_id IS NOT NULL
    UNION
    SELECT f.project_id FROM public.portal_afazeres f
     WHERE f.tenant_id = _tenant AND f.feito_em IS NULL AND f.project_id IS NOT NULL
  ), base AS (
    SELECT a.*,
           round((extract(epoch FROM (now() - a.last_status_change)) / 86400.0)::numeric, 1) AS dias,
           EXISTS (SELECT 1 FROM fila WHERE fila.pid = a.id) AS na_fila,
           -- a empresa avisou que instalou: pediu a vistoria pelo painel depois de entrar em Aprovado
           EXISTS (SELECT 1 FROM public.tasks k
                    WHERE k.project_id = a.id AND k.origin = 'vistoria_request'
                      AND k.created_at >= a.last_status_change) AS instalado
      FROM ativos a
  )
  SELECT b.id, b.code::text, b.title::text, co.name::text, b.company_id, ec.name::text, b.concessionaire_id,
         b.status, b.last_status_change, b.dias, n.normal_dias, n.fonte,
         CASE WHEN n.normal_dias IS NULL THEN NULL ELSE b.dias - n.normal_dias END,
         CASE
           WHEN b.na_fila THEN 'nos'
           WHEN b.status IN ('pendencia', 'aguardando_instalacao') THEN 'cliente'
           WHEN b.status = 'approved' AND NOT b.instalado THEN 'cliente'
           WHEN b.status IN ('analysis', 'approval', 'vistoria_solicitada') THEN 'concessionaria'
           ELSE 'nos'
         END,
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'nome', pr.name) ORDER BY pr.name)
                     FROM public.staff_companies sc
                     JOIN public.profiles pr ON pr.id = sc.staff_user_id
                    WHERE sc.company_id = b.company_id AND sc.tenant_id = _tenant AND pr.active), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(jsonb_build_object('etapa', ps.etapa, 'dias', ps.dias, 'atual', ps.saiu_em IS NULL)
                                    ORDER BY ps.entrou_em)
                     FROM pass ps WHERE ps.project_id = b.id), '[]'::jsonb),
         b.na_fila
    FROM base b
    LEFT JOIN public.companies co ON co.id = b.company_id
    LEFT JOIN public.energy_concessionaires ec ON ec.id = b.concessionaire_id
    LEFT JOIN normais n ON n.concessionaire_id IS NOT DISTINCT FROM b.concessionaire_id AND n.etapa = b.status
   ORDER BY 13 DESC NULLS LAST, 10 DESC;
END $$;
REVOKE ALL ON FUNCTION public.ludmilla_carteira() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_carteira() TO authenticated;

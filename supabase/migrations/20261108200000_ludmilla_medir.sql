-- ═══════════════════════════════════════════════════════════════════════════
-- Ludmilla, entrega 1 (MEDIR): registro das etapas, tempo normal e carteira.
-- Spec: docs/superpowers/specs/2026-11-08-ludmilla-repaginacao-design.md
--   (6.3 tempo na etapa e normal, 6.4 com quem está, 7 banco, 9.1 entrega).
-- Nada aqui muda projeto: o gatilho só registra a troca e as funções só leem.
-- Pode rodar de novo: tudo é IF NOT EXISTS, DROP … IF EXISTS ou ON CONFLICT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. O registro das etapas ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_stage_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  de          text,
  para        text NOT NULL,
  em          timestamptz NOT NULL,
  origem      text NOT NULL CHECK (origem IN ('gatilho', 'historico', 'criacao', 'atual')),
  history_id  uuid UNIQUE REFERENCES public.project_history(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.project_stage_log IS
  'Cada troca de etapa do projeto. gatilho = desde 08/11/2026; historico = lido do texto de project_history '
  '(confiável desde 19/07/2026); criacao = a entrada na primeira etapa; atual = a etapa atual quando o histórico não chega nela.';
CREATE INDEX IF NOT EXISTS idx_stage_log_projeto ON public.project_stage_log (project_id, em);
CREATE INDEX IF NOT EXISTS idx_stage_log_tenant  ON public.project_stage_log (tenant_id, para, em);

ALTER TABLE public.project_stage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.project_stage_log;
CREATE POLICY tenant_isolation ON public.project_stage_log
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((SELECT auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((SELECT auth.uid())));
DROP POLICY IF EXISTS equipe_le_etapas ON public.project_stage_log;
CREATE POLICY equipe_le_etapas ON public.project_stage_log
  FOR SELECT USING ((SELECT public.ludmilla_equipe_ok()));
REVOKE ALL ON public.project_stage_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_stage_log FROM authenticated;
GRANT SELECT ON public.project_stage_log TO authenticated;

-- ── 2. O gatilho: registra, nunca bloqueia ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_etapa_do_projeto()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.status IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
    VALUES (NEW.tenant_id, NEW.id, NULL, NEW.status::text, coalesce(NEW.created_at, now()), 'criacao');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
    VALUES (NEW.tenant_id, NEW.id, OLD.status::text, NEW.status::text, now(), 'gatilho');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'project_stage_log: não registrei a etapa do projeto % (%)', NEW.id, SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.registrar_etapa_do_projeto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_registrar_etapa ON public.projects;
CREATE TRIGGER trg_registrar_etapa
  AFTER INSERT OR UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.registrar_etapa_do_projeto();

-- ── 3. Carga inicial, a partir do texto do histórico ───────────────────────
-- 3a. Cada linha de histórico que diz a etapa nova.
WITH rotulos(rotulo, chave) AS (VALUES
  ('Projetos Recebidos', 'pending'), ('Em Análise', 'analysis'), ('Documentação', 'documentation'),
  ('Aguardando Aprovação', 'approval'), ('Aprovado', 'approved'), ('Pendência', 'pendencia'),
  ('Vistoria Solicitada', 'vistoria_solicitada'), ('Aguardando Instalação', 'aguardando_instalacao'),
  ('Vistoria sem Protocolo', 'vistoria_sem_protocolo'), ('Vistoria Reprovada', 'vistoria_reprovada'),
  ('Concluído', 'completed')
),
lidos AS (
  SELECT h.id, h.project_id, p.tenant_id, h.created_at, h.action,
         substring(h.description FROM 'de "([^"]+)" para') AS rot_de,
         substring(h.description FROM 'para "([^"]+)"')    AS rot_para,
         substring(h.description FROM 'moveu para ([a-z_]+)') AS chave_portal
    FROM public.project_history h
    JOIN public.projects p ON p.id = h.project_id
   WHERE h.action IN ('Etapa alterada', 'Status alterado', 'Status atualizado pelo portal')
     AND p.tenant_id IS NOT NULL
),
traduzidos AS (
  SELECT l.id, l.project_id, l.tenant_id, l.created_at,
         CASE WHEN l.action = 'Etapa alterada' THEN rd.chave END AS de,
         CASE l.action
           WHEN 'Etapa alterada' THEN rp.chave
           WHEN 'Status alterado' THEN rk.chave
           ELSE rq.chave
         END AS para
    FROM lidos l
    LEFT JOIN rotulos rd ON lower(rd.rotulo) = lower(l.rot_de)
    LEFT JOIN rotulos rp ON lower(rp.rotulo) = lower(l.rot_para)
    LEFT JOIN rotulos rk ON rk.chave = l.rot_para
    LEFT JOIN rotulos rq ON rq.chave = l.chave_portal
)
INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem, history_id)
SELECT t.tenant_id, t.project_id, t.de, t.para, t.created_at, 'historico', t.id
  FROM traduzidos t
 WHERE t.para IS NOT NULL
ON CONFLICT (history_id) DO NOTHING;

-- 3b. A entrada na primeira etapa (quando o projeto nasceu antes da primeira troca registrada).
--     Só olha linhas do histórico: a linha "atual" de uma rodada anterior não é troca de etapa,
--     e usá-la inventaria uma entrada em "pending" ao rodar a migração de novo.
INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
SELECT p.tenant_id, p.id, NULL, coalesce(pri.de, 'pending'), p.created_at, 'criacao'
  FROM public.projects p
  JOIN LATERAL (SELECT s.de, s.em FROM public.project_stage_log s
                 WHERE s.project_id = p.id AND s.origem = 'historico'
                 ORDER BY s.em, s.criado_em LIMIT 1) pri ON true
 WHERE p.tenant_id IS NOT NULL AND p.created_at IS NOT NULL AND p.created_at < pri.em
   AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.project_id = p.id AND s.origem = 'criacao');

-- 3c. A etapa atual, quando o histórico não chega nela (last_status_change é mantido por gatilho desde mai/2026).
INSERT INTO public.project_stage_log (tenant_id, project_id, de, para, em, origem)
SELECT p.tenant_id, p.id, ult.para, p.status::text, p.last_status_change, 'atual'
  FROM public.projects p
  LEFT JOIN LATERAL (SELECT s.para, s.em FROM public.project_stage_log s
                      WHERE s.project_id = p.id ORDER BY s.em DESC, s.criado_em DESC LIMIT 1) ult ON true
 WHERE p.tenant_id IS NOT NULL AND p.status IS NOT NULL AND p.last_status_change IS NOT NULL
   AND (ult.para IS NULL OR (ult.para IS DISTINCT FROM p.status::text AND p.last_status_change > ult.em))
   AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.project_id = p.id AND s.origem = 'atual');

-- ── 4. Passagens e o tempo normal ──────────────────────────────────────────
-- Uma passagem = uma estada numa etapa: da entrada até a próxima troca (ou até agora).
-- Linhas seguidas com a mesma etapa (o mesmo movimento escrito duas vezes) contam uma vez.
CREATE OR REPLACE FUNCTION public.ludmilla_passagens(p_tenant uuid)
RETURNS TABLE (project_id uuid, concessionaire_id uuid, etapa text, entrou_em timestamptz,
               saiu_em timestamptz, dias numeric, confiavel boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH l AS (
    SELECT s.project_id, s.para, s.em,
           lag(s.para) OVER (PARTITION BY s.project_id ORDER BY s.em, s.criado_em) AS para_antes
      FROM public.project_stage_log s
     WHERE s.tenant_id = p_tenant
  ), entradas AS (
    SELECT l.project_id, l.para, l.em FROM l WHERE l.para_antes IS DISTINCT FROM l.para
  ), seq AS (
    SELECT e.project_id, e.para AS etapa, e.em AS entrou_em,
           lead(e.em) OVER (PARTITION BY e.project_id ORDER BY e.em) AS saiu_em
      FROM entradas e
  )
  SELECT q.project_id, p.concessionaire_id, q.etapa, q.entrou_em, q.saiu_em,
         round((extract(epoch FROM (coalesce(q.saiu_em, now()) - q.entrou_em)) / 86400.0)::numeric, 1),
         q.entrou_em >= timestamptz '2026-07-19 00:00:00-03'
    FROM seq q
    JOIN public.projects p ON p.id = q.project_id
   WHERE p.is_deleted IS NOT TRUE
$$;
REVOKE ALL ON FUNCTION public.ludmilla_passagens(uuid) FROM PUBLIC, anon, authenticated;

-- O normal de cada concessionária × etapa: mediana de 12 meses com no mínimo 5 passagens fechadas;
-- senão a mediana da etapa em todas as concessionárias ("geral"); senão o stale_days da coluna do
-- Kanban ativo ("coluna"); senão NULL. Nunca menos de 1 dia.
CREATE OR REPLACE FUNCTION public.ludmilla_normais_do_tenant(p_tenant uuid)
RETURNS TABLE (concessionaire_id uuid, etapa text, normal_dias integer, amostra integer, fonte text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH pass AS (
    SELECT x.concessionaire_id, x.etapa, x.dias
      FROM public.ludmilla_passagens(p_tenant) x
     WHERE x.saiu_em IS NOT NULL AND x.confiavel AND x.etapa <> 'completed'
       AND x.entrou_em >= now() - interval '12 months'
  ), por_conc AS (
    SELECT pass.concessionaire_id, pass.etapa, count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pass.dias::float8) AS med
      FROM pass WHERE pass.concessionaire_id IS NOT NULL
     GROUP BY 1, 2
  ), geral AS (
    SELECT pass.etapa, count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pass.dias::float8) AS med
      FROM pass GROUP BY 1
  ), coluna AS (
    SELECT kc.status_key AS etapa, min(kc.stale_days) AS stale
      FROM public.kanban_columns kc
      JOIN public.kanban_models m ON m.id = kc.kanban_model_id
     WHERE m.tenant_id = p_tenant AND m.is_active AND kc.stale_days IS NOT NULL
     GROUP BY 1
  ), combos AS (
    SELECT DISTINCT p.concessionaire_id, e.etapa
      FROM public.projects p
     CROSS JOIN (VALUES ('pending'), ('analysis'), ('documentation'), ('approval'), ('approved'),
                        ('pendencia'), ('vistoria_solicitada'), ('aguardando_instalacao'),
                        ('vistoria_sem_protocolo'), ('vistoria_reprovada')) e(etapa)
     WHERE p.tenant_id = p_tenant AND p.is_deleted IS NOT TRUE
  )
  SELECT c.concessionaire_id, c.etapa,
         CASE WHEN pc.n >= 5 THEN greatest(1, ceil(pc.med))::int
              WHEN g.n  >= 5 THEN greatest(1, ceil(g.med))::int
              WHEN col.stale IS NOT NULL THEN greatest(1, col.stale)
              ELSE NULL END,  -- greatest(1, NULL) daria 1: sem medição o normal fica vazio
         CASE WHEN pc.n >= 5 THEN pc.n WHEN g.n >= 5 THEN g.n ELSE 0 END,
         CASE WHEN pc.n >= 5 THEN 'medido' WHEN g.n >= 5 THEN 'geral'
              WHEN col.stale IS NOT NULL THEN 'coluna' ELSE NULL END
    FROM combos c
    LEFT JOIN por_conc pc ON pc.concessionaire_id IS NOT DISTINCT FROM c.concessionaire_id AND pc.etapa = c.etapa
    LEFT JOIN geral g     ON g.etapa = c.etapa
    LEFT JOIN coluna col  ON col.etapa = c.etapa
$$;
REVOKE ALL ON FUNCTION public.ludmilla_normais_do_tenant(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ludmilla_normais()
RETURNS TABLE (concessionaire_id uuid, etapa text, normal_dias integer, amostra integer, fonte text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  RETURN QUERY SELECT * FROM public.ludmilla_normais_do_tenant(public.get_user_tenant_id((SELECT auth.uid())));
END $$;
REVOKE ALL ON FUNCTION public.ludmilla_normais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_normais() TO authenticated;

-- ── 5. A carteira ──────────────────────────────────────────────────────────
-- Projetos ativos do tenant (não excluídos, não arquivados, não concluídos) com o tempo na etapa,
-- o normal, o atraso, com quem está (spec 6.4), os projetistas ligados à empresa e o histórico.
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
           EXISTS (SELECT 1 FROM fila WHERE fila.pid = a.id) AS na_fila
      FROM ativos a
  )
  SELECT b.id, b.code::text, b.title::text, co.name::text, b.company_id, ec.name::text, b.concessionaire_id,
         b.status, b.last_status_change, b.dias, n.normal_dias, n.fonte,
         CASE WHEN n.normal_dias IS NULL THEN NULL ELSE b.dias - n.normal_dias END,
         CASE
           WHEN b.na_fila THEN 'nos'
           WHEN b.status IN ('pendencia', 'aguardando_instalacao') THEN 'cliente'
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

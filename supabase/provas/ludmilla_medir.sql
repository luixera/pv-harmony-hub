-- Prova da entrega 1 (medir). Roda DENTRO de BEGIN … ROLLBACK, depois da migração.
-- Devolve uma linha por caso: ok = true passou, false falhou, null não deu para testar.
CREATE TEMP TABLE r (caso text, ok boolean, detalhe text) ON COMMIT DROP;
GRANT INSERT, SELECT ON r TO authenticated;

-- ── A. O registro das etapas ───────────────────────────────────────────────
DO $$
DECLARE _t uuid; _n int; _txt text; _p uuid;
BEGIN
  SELECT id INTO _t FROM public.tenants WHERE is_library LIMIT 1;

  SELECT count(*) INTO _n FROM public.project_history h
   WHERE h.action = 'Etapa alterada'
     AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.history_id = h.id);
  SELECT string_agg(DISTINCT substring(h.description FROM 'para "([^"]+)"'), ', ') INTO _txt
    FROM public.project_history h
   WHERE h.action = 'Etapa alterada'
     AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.history_id = h.id);
  INSERT INTO r VALUES ('A1 todo "Etapa alterada" virou linha do registro', _n = 0,
                        _n || ' sem etapa reconhecida' || coalesce(': ' || _txt, ''));

  SELECT string_agg(origem || '=' || n, ', ') INTO _txt
    FROM (SELECT origem, count(*) AS n FROM public.project_stage_log GROUP BY 1 ORDER BY 1) x;
  SELECT count(*) INTO _n FROM public.project_stage_log WHERE origem = 'historico';
  INSERT INTO r VALUES ('A2 linhas por origem', _n >= 1000, _txt);

  SELECT count(*), string_agg(code, ', ') INTO _n, _txt FROM (
    SELECT p.code FROM public.projects p
      JOIN LATERAL (SELECT s.para FROM public.project_stage_log s WHERE s.project_id = p.id
                     ORDER BY s.em DESC, s.criado_em DESC LIMIT 1) u ON true
     WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed'
       AND u.para IS DISTINCT FROM p.status::text
     LIMIT 50) x;
  INSERT INTO r VALUES ('A3 a última etapa do registro é a do projeto', _n = 0,
                        _n || coalesce(' divergentes: ' || _txt, ''));

  SELECT count(*) INTO _n FROM public.projects p
   WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed'
     AND NOT EXISTS (SELECT 1 FROM public.project_stage_log s WHERE s.project_id = p.id);
  INSERT INTO r VALUES ('A4 todo projeto ativo tem registro', _n = 0, _n || ' sem nenhuma linha');

  SELECT count(*) INTO _n FROM (
    SELECT s.project_id FROM public.project_stage_log s WHERE s.origem IN ('criacao', 'atual')
     GROUP BY s.project_id, s.origem HAVING count(*) > 1) x;
  INSERT INTO r VALUES ('A5 rodar a migração de novo não duplica', _n = 0, _n || ' projetos com linha repetida');

  SELECT p.id INTO _p FROM public.projects p
   WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.status = 'approved' ORDER BY p.created_at DESC LIMIT 1;
  UPDATE public.projects SET status = 'vistoria_solicitada' WHERE id = _p;
  SELECT count(*) INTO _n FROM public.project_stage_log s
   WHERE s.project_id = _p AND s.origem = 'gatilho' AND s.de = 'approved' AND s.para = 'vistoria_solicitada';
  INSERT INTO r VALUES ('A6 o gatilho registra a troca de etapa', _n = 1, _n || ' linha(s) de gatilho');
END $$;

-- ── (blocos B e C entram aqui) ─────────────────────────────────────────────

SELECT json_agg(json_build_object('caso', caso, 'ok', ok, 'detalhe', detalhe)
                ORDER BY ok NULLS FIRST, caso) AS x FROM r;

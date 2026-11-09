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

-- ── B. As passagens e o tempo normal ───────────────────────────────────────
DO $$
DECLARE _t uuid; _pessoa uuid; _n int; _txt text; _enel text; _erro text;
BEGIN
  SELECT id INTO _t FROM public.tenants WHERE is_library LIMIT 1;
  SELECT p.id INTO _pessoa FROM public.profiles p
   WHERE p.tenant_id = _t AND p.active AND p.role IN ('admin', 'staff')
     AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p.id)
   ORDER BY (p.role = 'admin') DESC LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', _pessoa)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO _n FROM public.ludmilla_normais() WHERE normal_dias < 1;
  SELECT string_agg(f || '=' || c, ', ') INTO _txt
    FROM (SELECT coalesce(fonte, 'sem normal') AS f, count(*) AS c FROM public.ludmilla_normais() GROUP BY 1 ORDER BY 1) x;
  SELECT string_agg(n.etapa || ' ' || coalesce(n.normal_dias::text, '?') || 'd (' || coalesce(n.fonte, 'sem') || ', ' || n.amostra || ')', '; ')
    INTO _enel
    FROM public.ludmilla_normais() n
    JOIN public.energy_concessionaires ec ON ec.id = n.concessionaire_id
   WHERE ec.name ILIKE '%ENEL%';
  BEGIN
    PERFORM count(*) FROM public.ludmilla_passagens(_t);
    _erro := 'chamou';
  EXCEPTION WHEN insufficient_privilege THEN _erro := 'negado';
  END;

  PERFORM set_config('role', 'none', true);
  INSERT INTO r VALUES
    ('B1 nenhum normal abaixo de 1 dia', _n = 0, _n || ' abaixo de 1'),
    ('B2 de onde vem cada normal', true, _txt),
    ('B3 normais da ENEL (para conferir a olho)', true, left(coalesce(_enel, 'nenhum'), 900)),
    ('B4 passagens fechadas para a equipe', _erro = 'negado', _erro);
END $$;

-- ── C. A carteira ──────────────────────────────────────────────────────────
DO $$
DECLARE _t uuid; _pessoa uuid; _outro uuid; _n int; _ativos int; _fora int; _desordem int;
        _txt text; _ini timestamptz; _ms numeric; _erro text; _linhas_outro int; _sem_hist int;
BEGIN
  SELECT id INTO _t FROM public.tenants WHERE is_library LIMIT 1;
  SELECT p.id INTO _pessoa FROM public.profiles p
   WHERE p.tenant_id = _t AND p.active AND p.role IN ('admin', 'staff')
     AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p.id)
   ORDER BY (p.role = 'admin') DESC LIMIT 1;
  SELECT p.id INTO _outro FROM public.profiles p
    JOIN public.tenants t ON t.id = p.tenant_id AND NOT t.is_library
   WHERE p.active AND p.role = 'admin' AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p.id)
   LIMIT 1;
  SELECT count(*) INTO _ativos FROM public.projects p
   WHERE p.tenant_id = _t AND p.is_deleted IS NOT TRUE AND p.archived_at IS NULL AND p.status <> 'completed';

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', _pessoa)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  _ini := clock_timestamp();
  SELECT count(*),
         count(*) FILTER (WHERE c.com_quem NOT IN ('nos', 'concessionaria', 'cliente')),
         count(*) FILTER (WHERE jsonb_array_length(c.historico) = 0),
         string_agg(c.code || ' ' || c.atraso_dias || 'd além de ' || c.normal_dias || ' (' || c.status || ', ' || c.com_quem || ')', '; ')
           FILTER (WHERE c.atraso_dias > 0)
    INTO _n, _fora, _sem_hist, _txt
    FROM public.ludmilla_carteira() c;
  _ms := extract(epoch FROM clock_timestamp() - _ini) * 1000;
  SELECT count(*) INTO _desordem FROM (
    SELECT c.atraso_dias, lag(c.atraso_dias) OVER (ORDER BY c.ordinality) AS antes
      FROM public.ludmilla_carteira() WITH ORDINALITY c) x
   WHERE x.antes IS NOT NULL AND x.atraso_dias IS NOT NULL AND x.atraso_dias > x.antes;
  PERFORM set_config('role', 'none', true);

  IF _outro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', _outro)::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      PERFORM count(*) FROM public.ludmilla_carteira();
      _erro := 'entrou';
    EXCEPTION WHEN OTHERS THEN _erro := SQLERRM;
    END;
    SELECT count(*) INTO _linhas_outro FROM public.project_stage_log;
    PERFORM set_config('role', 'none', true);
  END IF;

  INSERT INTO r VALUES
    ('C1 uma linha por projeto ativo', _n = _ativos, _n || ' na carteira, ' || _ativos || ' ativos'),
    ('C2 com quem está sempre válido', _fora = 0, _fora || ' fora do padrão'),
    ('C3 mais atrasado primeiro', _desordem = 0, _desordem || ' fora de ordem'),
    ('C4 todo projeto tem histórico', _sem_hist = 0, _sem_hist || ' sem histórico'),
    ('C5 a carteira responde em menos de 2 s', _ms < 2000, round(_ms) || ' ms'),
    ('C6 outro tenant não abre a carteira',
       CASE WHEN _outro IS NULL THEN NULL ELSE _erro = 'Sem acesso à Ludmilla.' END,
       coalesce(_erro, 'sem outro tenant para testar')),
    ('C7 outro tenant não lê o registro',
       CASE WHEN _outro IS NULL THEN NULL ELSE _linhas_outro = 0 END,
       coalesce(_linhas_outro::text, '—')),
    ('C8 atrasados (para conferir a olho)', true, left(coalesce(_txt, 'nenhum'), 900));
END $$;

SELECT json_agg(json_build_object('caso', caso, 'ok', ok, 'detalhe', detalhe)
                ORDER BY ok NULLS FIRST, caso) AS x FROM r;

-- Mapa de capacidade de rede, 2ª entrega (spec §11): camada vetorial, níveis
-- de célula para os zooms 11–13, traçado dos alimentadores, busca e detalhe.
--
-- Diagnóstico medido em 13/10/2026 que motivou isto: no zoom 12 Campinas tem
-- 12.274 trafos e a RPC v1 devolvia os 1.500 piores em 624 ms / 432 KB; as
-- células paravam no zoom 11. E a tela recriava 1.500 marcadores a cada
-- arrasto. Aqui o servidor passa a devolver GeoJSON pronto por camada.
--
-- POR QUE TANTAS FUNÇÕES PEQUENAS: mesma razão das migrações anteriores da
-- rede — cada peça é verificável sozinha e o servidor MCP engasga com
-- statement longo. A entrada só compõe.

-- ── pg_trgm: ILIKE '%x%' indexado para a busca por código e nome ────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS rede_trafo_codigo_trgm_idx
  ON public.rede_transformador USING gin (codigo extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS rede_alim_codigo_trgm_idx
  ON public.rede_alimentador USING gin (codigo extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS rede_sub_nome_trgm_idx
  ON public.rede_subestacao USING gin (nome extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS rede_sub_codigo_trgm_idx
  ON public.rede_subestacao USING gin (codigo extensions.gin_trgm_ops);

-- ── Células: dois níveis novos ──────────────────────────────────────────────
-- 3 = 0,0125° (~1,4 km) para os zooms 11–12; 4 = 0,005° (~550 m) para o 13.
-- Pontos só do zoom 14 em diante. Antes, o nível 2 (5,5 km) ia até o 11 e do
-- 12 em diante eram pontos com teto de 1.500 — e Campinas no 12 tem 12.274.
-- A Fase A limitava o nível a (1,2) por CHECK; pego na primeira recarga.
ALTER TABLE public.rede_celula_agregada
  DROP CONSTRAINT IF EXISTS rede_celula_agregada_nivel_check,
  ADD CONSTRAINT rede_celula_agregada_nivel_check CHECK (nivel BETWEEN 1 AND 4);

CREATE OR REPLACE VIEW public.rede_celula_calculada AS
  SELECT t.distribuidora_id AS did, n.nivel, n.passo,
         floor(ST_X(t.geom)/n.passo)::INT AS cx,
         floor(ST_Y(t.geom)/n.passo)::INT AS cy,
         count(*) AS t,
         count(*) FILTER (WHERE t.risco='risco')    AS r,
         count(*) FILTER (WHERE t.risco='atencao')  AS a,
         count(*) FILTER (WHERE t.risco='folga')    AS f,
         count(*) FILTER (WHERE t.risco='sem_dado') AS s
    FROM public.rede_transformador t
   CROSS JOIN (VALUES (1::SMALLINT, 0.2::NUMERIC),    (2::SMALLINT, 0.05::NUMERIC),
                      (3::SMALLINT, 0.0125::NUMERIC), (4::SMALLINT, 0.005::NUMERIC)) n(nivel, passo)
   WHERE t.ativo
   GROUP BY 1,2,3,4,5;

CREATE OR REPLACE FUNCTION public.rede_nivel_celula(p_zoom INTEGER) RETURNS SMALLINT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT (CASE WHEN p_zoom < 9 THEN 1 WHEN p_zoom < 11 THEN 2
               WHEN p_zoom < 13 THEN 3 WHEN p_zoom < 14 THEN 4 END)::SMALLINT;
$fn$;

-- Tolerância do ST_Simplify do traçado por zoom. 0,00005° (~5 m) é a
-- resolução guardada; acima disso é só para a vista não pesar.
CREATE OR REPLACE FUNCTION public.rede_tolerancia_alimentador(p_zoom INTEGER) RETURNS FLOAT8
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p_zoom < 9 THEN 0.004 WHEN p_zoom < 11 THEN 0.001
              WHEN p_zoom < 14 THEN 0.0003 ELSE 0.00005 END;
$fn$;

-- ── Alimentador: contagem de trafos por estado, recalculada com o semáforo ──
ALTER TABLE public.rede_alimentador
  ADD COLUMN IF NOT EXISTS trafos          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trafos_risco    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trafos_atencao  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trafos_folga    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trafos_sem_dado INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.rede_contar_trafos_alimentador() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  WITH c AS (
    SELECT alimentador_id, count(*) AS n,
           count(*) FILTER (WHERE risco='risco')    AS r,
           count(*) FILTER (WHERE risco='atencao')  AS a,
           count(*) FILTER (WHERE risco='folga')    AS f,
           count(*) FILTER (WHERE risco='sem_dado') AS s
      FROM public.rede_transformador
     WHERE ativo AND alimentador_id IS NOT NULL
     GROUP BY alimentador_id)
  UPDATE public.rede_alimentador al
     SET trafos = c.n, trafos_risco = c.r, trafos_atencao = c.a,
         trafos_folga = c.f, trafos_sem_dado = c.s
    FROM c WHERE c.alimentador_id = al.id;
  -- alimentador que perdeu todos os trafos volta a zero
  UPDATE public.rede_alimentador al
     SET trafos = 0, trafos_risco = 0, trafos_atencao = 0, trafos_folga = 0, trafos_sem_dado = 0
   WHERE al.trafos <> 0
     AND NOT EXISTS (SELECT 1 FROM public.rede_transformador t
                      WHERE t.ativo AND t.alimentador_id = al.id);
END $fn$;

CREATE OR REPLACE FUNCTION public.grid_capacity_recalcular() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE g RECORD; o JSONB;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'So master ou service role recalcula a capacidade de rede';
  END IF;
  SELECT * INTO g FROM public.rede_regras();
  PERFORM public.rede_aplicar_trafos(g.fator, g.atencao, g.risco);
  PERFORM public.rede_aplicar_alimentadores(g.fator, g.atencao, g.risco);
  PERFORM public.rede_contar_trafos_alimentador();
  SELECT jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco_lim', g.risco,
    'trafos', jsonb_object_agg(risco, n)) INTO o
    FROM (SELECT risco::text, count(*) n FROM public.rede_transformador GROUP BY 1) z;
  RETURN o;
END $fn$;

CREATE OR REPLACE FUNCTION public.rede_concluir_carga(p_importacao_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE prom JSONB; g RECORD; n_cel INT;
BEGIN
  prom := public.rede_promover_nucleo(p_importacao_id);
  UPDATE public.rede_distribuidora d SET data_base = i.data_base, atualizado_em = now()
    FROM public.rede_importacao i
   WHERE i.id = p_importacao_id AND d.id = i.distribuidora_id;
  SELECT * INTO g FROM public.rede_regras();
  PERFORM public.rede_aplicar_trafos(g.fator, g.atencao, g.risco);
  PERFORM public.rede_aplicar_alimentadores(g.fator, g.atencao, g.risco);
  PERFORM public.rede_contar_trafos_alimentador();
  PERFORM public.rede_celula_limpar();
  PERFORM public.rede_celula_inserir();
  SELECT count(*) INTO n_cel FROM public.rede_celula_agregada;
  RETURN prom || jsonb_build_object('celulas', n_cel);
END $fn$;

-- ── Traçado: staging recebe WKT, promoção grava a geometria ─────────────────
ALTER TABLE public.rede_stg_alimentador ADD COLUMN IF NOT EXISTS geom_wkt TEXT;

CREATE OR REPLACE FUNCTION public.rede_promover_alim(p_imp BIGINT, d BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.rede_alimentador
    (distribuidora_id, subestacao_id, codigo, tensao_kv,
     carga_min_diurna_kw, gd_conectada_kw, geom, ativo, atualizado_em)
  SELECT d, se.id, a.codigo, a.tensao_kv,
         a.carga_min_diurna_kw, a.gd_conectada_kw,
         CASE WHEN a.geom_wkt IS NOT NULL AND a.geom_wkt <> ''
              THEN ST_Multi(ST_GeomFromText(a.geom_wkt, 4326)) END,
         TRUE, now()
    FROM public.rede_stg_alimentador a
    LEFT JOIN public.rede_subestacao se
           ON se.distribuidora_id = d AND se.codigo = a.subestacao_codigo
   WHERE a.importacao_id = p_imp
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET subestacao_id = EXCLUDED.subestacao_id, tensao_kv = EXCLUDED.tensao_kv,
        carga_min_diurna_kw = EXCLUDED.carga_min_diurna_kw,
        gd_conectada_kw = EXCLUDED.gd_conectada_kw,
        -- carga sem traçado não apaga o traçado que já existia
        geom = COALESCE(EXCLUDED.geom, public.rede_alimentador.geom),
        ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

-- ── Views: uma por feição, já com as propriedades que a tela usa ────────────
CREATE OR REPLACE VIEW public.rede_ponto_no_mapa AS
  SELECT t.id, t.geom, t.risco, t.ocupacao_pct,
         jsonb_build_object('id', t.id, 'codigo', t.codigo, 'risco', t.risco,
           'lng', ST_X(t.geom), 'lat', ST_Y(t.geom),
           'potencia_nominal_kva', t.potencia_nominal_kva,
           'carga_min_diurna_kw', t.carga_min_diurna_kw,
           'gd_conectada_kw', t.gd_conectada_kw, 'margem_kw', t.margem_kw,
           'ocupacao_pct', t.ocupacao_pct, 'alimentador', a.codigo,
           'alimentador_id', a.id, 'subestacao', s.nome) AS j
    FROM public.rede_transformador t
    LEFT JOIN public.rede_alimentador a ON a.id = t.alimentador_id
    LEFT JOIN public.rede_subestacao  s ON s.id = a.subestacao_id
   WHERE t.ativo;
ALTER VIEW public.rede_ponto_no_mapa SET (security_invoker = true);

CREATE OR REPLACE VIEW public.rede_celula_no_mapa AS
  SELECT c.id, c.nivel, c.geom, c.risco,
         jsonb_build_object('id', c.id, 'nivel', c.nivel, 'risco', c.risco, 'trafos', c.trafos,
           'trafos_risco', c.trafos_risco, 'trafos_atencao', c.trafos_atencao,
           'trafos_folga', c.trafos_folga, 'trafos_sem_dado', c.trafos_sem_dado,
           'oeste', ST_XMin(c.geom), 'sul', ST_YMin(c.geom),
           'leste', ST_XMax(c.geom), 'norte', ST_YMax(c.geom)) AS j
    FROM public.rede_celula_agregada c;
ALTER VIEW public.rede_celula_no_mapa SET (security_invoker = true);

CREATE OR REPLACE VIEW public.rede_alimentador_no_mapa AS
  SELECT a.id, a.geom, a.risco, a.ocupacao_pct,
         jsonb_build_object('id', a.id, 'codigo', a.codigo, 'risco', a.risco,
           'ocupacao_pct', a.ocupacao_pct, 'carga_min_diurna_kw', a.carga_min_diurna_kw,
           'gd_conectada_kw', a.gd_conectada_kw, 'trafos', a.trafos,
           'trafos_risco', a.trafos_risco, 'subestacao', s.nome,
           'oeste', ST_XMin(a.geom), 'sul', ST_YMin(a.geom),
           'leste', ST_XMax(a.geom), 'norte', ST_YMax(a.geom)) AS j
    FROM public.rede_alimentador a
    LEFT JOIN public.rede_subestacao s ON s.id = a.subestacao_id
   WHERE a.ativo AND a.geom IS NOT NULL;
ALTER VIEW public.rede_alimentador_no_mapa SET (security_invoker = true);

CREATE OR REPLACE VIEW public.rede_subestacao_no_mapa AS
  SELECT s.id, s.geom,
         jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nome', s.nome,
           'lng', ST_X(s.geom), 'lat', ST_Y(s.geom),
           'alimentadores', (SELECT count(*) FROM public.rede_alimentador a
                              WHERE a.subestacao_id = s.id AND a.ativo),
           'alimentadores_risco', (SELECT count(*) FROM public.rede_alimentador a
                              WHERE a.subestacao_id = s.id AND a.ativo AND a.risco = 'risco')) AS j
    FROM public.rede_subestacao s
   WHERE s.ativo AND s.geom IS NOT NULL;
ALTER VIEW public.rede_subestacao_no_mapa SET (security_invoker = true);

-- ── GeoJSON: Feature com `id` no topo (a camada vetorial usa no overrideStyle)
CREATE OR REPLACE FUNCTION public.rede_feicao(p_id BIGINT, p_geom geometry, p_props JSONB, p_casas INT DEFAULT 6)
RETURNS JSONB LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT jsonb_build_object('type', 'Feature', 'id', p_id,
           'geometry', ST_AsGeoJSON(p_geom, p_casas)::jsonb, 'properties', p_props);
$fn$;

CREATE OR REPLACE FUNCTION public.rede_colecao(p_feicoes JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT jsonb_build_object('type', 'FeatureCollection', 'features', COALESCE(p_feicoes, '[]'::jsonb));
$fn$;

-- ── Uma função por camada ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rede_mapa_pontos_v2(cx geometry, so_risco BOOLEAN, teto INT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(z.id, z.geom, z.j)) FROM (
           SELECT t.id, t.geom, t.j FROM public.rede_ponto_no_mapa t
            WHERE ST_Intersects(t.geom, cx)
              AND (NOT so_risco OR t.risco IN ('risco','atencao','sem_dado'))
            ORDER BY t.ocupacao_pct DESC NULLS LAST
            LIMIT teto) z));
$fn$;

CREATE OR REPLACE FUNCTION public.rede_mapa_celulas_v2(cx geometry, n SMALLINT, so_risco BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(z.id, z.geom, z.j, 5)) FROM (
           SELECT c.id, c.geom, c.j FROM public.rede_celula_no_mapa c
            WHERE c.nivel = n AND ST_Intersects(c.geom, cx)
              AND (NOT so_risco OR c.risco IN ('risco','atencao'))
            LIMIT 4000) z));
$fn$;

-- Recortado à caixa (com 10% de folga) e simplificado por zoom. Abaixo do zoom
-- 9 só risco/atenção: no estado inteiro, 2.330 linhas de folga são ruído.
-- ST_CollectionExtract(…, 2) fica só com as linhas: a interseção de uma
-- MultiLineString com um polígono pode trazer pontos soltos.
CREATE OR REPLACE FUNCTION public.rede_mapa_alimentadores(cx geometry, p_zoom INT, so_risco BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  WITH jan AS (SELECT ST_Expand(cx, (ST_XMax(cx) - ST_XMin(cx)) * 0.1) AS g),
       tol AS (SELECT public.rede_tolerancia_alimentador(p_zoom) AS t),
       z AS (
         SELECT a.id, a.geom, a.j FROM public.rede_alimentador_no_mapa a, jan
          WHERE ST_Intersects(a.geom, jan.g)
            AND (NOT (so_risco OR p_zoom < 9) OR a.risco IN ('risco','atencao'))
          ORDER BY a.ocupacao_pct DESC NULLS LAST
          LIMIT 600),
       w AS (
         SELECT z.id, z.j,
                ST_Multi(ST_CollectionExtract(
                  ST_Simplify(ST_Intersection(z.geom, jan.g), tol.t, TRUE), 2)) AS g
           FROM z, jan, tol)
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(w.id, w.g, w.j, 6))
                                FROM w WHERE NOT ST_IsEmpty(w.g)));
$fn$;

CREATE OR REPLACE FUNCTION public.rede_mapa_subestacoes(cx geometry)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(z.id, z.geom, z.j)) FROM (
           SELECT s.id, s.geom, s.j FROM public.rede_subestacao_no_mapa s
            WHERE ST_Intersects(s.geom, cx) LIMIT 800) z));
$fn$;

-- O resumo é sobre a área TODA, nunca sobre o teto: é o que a tela mostra nos
-- quatro tiles. Em zoom de célula soma as células; em zoom de ponto conta.
CREATE OR REPLACE FUNCTION public.rede_mapa_resumo(cx geometry, n SMALLINT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT CASE WHEN n IS NULL THEN (
    SELECT jsonb_build_object('total', count(*),
             'risco',    count(*) FILTER (WHERE risco='risco'),
             'atencao',  count(*) FILTER (WHERE risco='atencao'),
             'folga',    count(*) FILTER (WHERE risco='folga'),
             'sem_dado', count(*) FILTER (WHERE risco='sem_dado'))
      FROM public.rede_transformador t WHERE t.ativo AND ST_Intersects(t.geom, cx))
  ELSE (
    SELECT jsonb_build_object('total', COALESCE(sum(trafos),0),
             'risco', COALESCE(sum(trafos_risco),0), 'atencao', COALESCE(sum(trafos_atencao),0),
             'folga', COALESCE(sum(trafos_folga),0), 'sem_dado', COALESCE(sum(trafos_sem_dado),0))
      FROM public.rede_celula_agregada c WHERE c.nivel = n AND ST_Intersects(c.geom, cx)) END;
$fn$;

-- ── A entrada ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rede_no_mapa_v2(
  p_oeste NUMERIC, p_sul NUMERIC, p_leste NUMERIC, p_norte NUMERIC,
  p_zoom INTEGER DEFAULT 10, p_so_risco BOOLEAN DEFAULT FALSE,
  p_camadas TEXT[] DEFAULT ARRAY['pontos']
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE cx geometry; n SMALLINT; teto CONSTANT INT := 4000; g RECORD;
        pontos JSONB; celulas JSONB; alim JSONB; subs JSONB; res JSONB;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  cx := ST_MakeEnvelope(p_oeste, p_sul, p_leste, p_norte, 4326);
  n  := public.rede_nivel_celula(p_zoom);
  SELECT * INTO g FROM public.rede_regras();
  res := public.rede_mapa_resumo(cx, n);
  IF 'pontos' = ANY(p_camadas) THEN
    IF n IS NULL THEN pontos  := public.rede_mapa_pontos_v2(cx, p_so_risco, teto);
    ELSE                celulas := public.rede_mapa_celulas_v2(cx, n, p_so_risco); END IF;
  END IF;
  IF 'alimentadores' = ANY(p_camadas) THEN alim := public.rede_mapa_alimentadores(cx, p_zoom, p_so_risco); END IF;
  IF 'subestacoes'   = ANY(p_camadas) THEN subs := public.rede_mapa_subestacoes(cx); END IF;
  RETURN jsonb_build_object(
    'base',   COALESCE(public.rede_base_atual(), '{}'::jsonb),
    'regras', jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco', g.risco),
    'zoom', p_zoom, 'camada', CASE WHEN n IS NULL THEN 'ponto' ELSE 'celula' END, 'nivel', n,
    'resumo', res, 'pontos', pontos, 'celulas', celulas,
    'alimentadores', alim, 'subestacoes', subs,
    'teto', teto,
    'excedeu', n IS NULL AND COALESCE(jsonb_array_length(pontos->'features'), 0) >= teto);
END $fn$;

-- ── Busca: código de trafo, de alimentador, nome/código de subestação ───────
CREATE OR REPLACE FUNCTION public.rede_buscar(p_texto TEXT, p_limite INTEGER DEFAULT 6)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE t TEXT; pad TEXT; lim INT;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  t := left(btrim(COALESCE(p_texto, '')), 60);
  IF length(t) < 2 THEN RETURN '[]'::jsonb; END IF;
  -- % e _ do usuário são literais, não curingas
  pad := '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  lim := LEAST(GREATEST(COALESCE(p_limite, 6), 1), 20);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) - 'ordem' ORDER BY x.ordem, x.codigo) FROM (
      (SELECT 1 AS ordem, 'subestacao' AS tipo, s.id, s.codigo, s.nome, NULL::TEXT AS risco,
              ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat,
              NULL::FLOAT8 AS oeste, NULL::FLOAT8 AS sul, NULL::FLOAT8 AS leste, NULL::FLOAT8 AS norte
         FROM public.rede_subestacao s
        WHERE s.ativo AND (s.nome ILIKE pad OR s.codigo ILIKE pad)
        ORDER BY s.nome LIMIT lim)
      UNION ALL
      (SELECT 2, 'alimentador', a.id, a.codigo, se.nome, a.risco::TEXT, NULL, NULL,
              ST_XMin(e.g), ST_YMin(e.g), ST_XMax(e.g), ST_YMax(e.g)
         FROM (SELECT a.* FROM public.rede_alimentador a
                WHERE a.ativo AND a.codigo ILIKE pad ORDER BY a.codigo LIMIT lim) a
         LEFT JOIN public.rede_subestacao se ON se.id = a.subestacao_id
         LEFT JOIN LATERAL (SELECT COALESCE(a.geom,
                              (SELECT ST_Collect(t.geom) FROM public.rede_transformador t
                                WHERE t.alimentador_id = a.id AND t.ativo)) AS g) e ON TRUE)
      UNION ALL
      (SELECT 3, 'trafo', t.id, t.codigo, al.codigo, t.risco::TEXT, ST_X(t.geom), ST_Y(t.geom),
              NULL, NULL, NULL, NULL
         FROM (SELECT t.* FROM public.rede_transformador t
                WHERE t.ativo AND t.codigo ILIKE pad ORDER BY t.codigo LIMIT lim) t
         LEFT JOIN public.rede_alimentador al ON al.id = t.alimentador_id)
    ) x), '[]'::jsonb);
END $fn$;

-- ── Detalhe do alimentador: o contexto do trafo e a gaveta do alimentador ───
CREATE OR REPLACE FUNCTION public.rede_alimentador_detalhe(p_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE g RECORD; r JSONB;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  SELECT * INTO g FROM public.rede_regras();
  SELECT jsonb_build_object('id', a.id, 'codigo', a.codigo, 'risco', a.risco,
           'ocupacao_pct', a.ocupacao_pct, 'carga_min_diurna_kw', a.carga_min_diurna_kw,
           'gd_conectada_kw', a.gd_conectada_kw,
           'margem_kw', public.rede_margem(a.carga_min_diurna_kw, a.gd_conectada_kw, g.fator),
           'trafos', a.trafos, 'trafos_risco', a.trafos_risco, 'trafos_atencao', a.trafos_atencao,
           'trafos_folga', a.trafos_folga, 'trafos_sem_dado', a.trafos_sem_dado,
           'subestacao', s.nome, 'distribuidora', d.nome, 'tem_tracado', a.geom IS NOT NULL,
           'oeste', ST_XMin(e.g), 'sul', ST_YMin(e.g), 'leste', ST_XMax(e.g), 'norte', ST_YMax(e.g))
    INTO r
    FROM public.rede_alimentador a
    LEFT JOIN public.rede_subestacao s ON s.id = a.subestacao_id
    LEFT JOIN public.rede_distribuidora d ON d.id = a.distribuidora_id
    LEFT JOIN LATERAL (SELECT COALESCE(a.geom,
                         (SELECT ST_Collect(t.geom) FROM public.rede_transformador t
                           WHERE t.alimentador_id = a.id AND t.ativo)) AS g) e ON TRUE
   WHERE a.id = p_id;
  RETURN r;   -- NULL quando não existe
END $fn$;

-- ── Permissões: TODO objeto novo, varrido ───────────────────────────────────
REVOKE ALL ON FUNCTION public.rede_nivel_celula(INTEGER)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_tolerancia_alimentador(INTEGER)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_contar_trafos_alimentador()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_feicao(BIGINT, geometry, JSONB, INT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_colecao(JSONB)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_pontos_v2(geometry, BOOLEAN, INT)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_celulas_v2(geometry, SMALLINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_alimentadores(geometry, INT, BOOLEAN)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_subestacoes(geometry)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_resumo(geometry, SMALLINT)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rede_alimentador_no_mapa, public.rede_subestacao_no_mapa  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rede_no_mapa_v2(NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,BOOLEAN,TEXT[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_no_mapa_v2(NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,BOOLEAN,TEXT[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_buscar(TEXT, INTEGER)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_buscar(TEXT, INTEGER)          TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_alimentador_detalhe(BIGINT)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_alimentador_detalhe(BIGINT)    TO authenticated;

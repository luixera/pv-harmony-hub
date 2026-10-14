-- Traçado dos alimentadores por nível de zoom, pré-calculado.
--
-- Medido em 13/10/2026 com a Piratininga carregada (550 traçados, 437 pontos
-- em média, 12.724 km): `rede_mapa_alimentadores` com ST_Intersection +
-- ST_Simplify na hora levava 1,8 s no zoom 12 (68 linhas, 813 KB) e 27,7 s
-- no estado inteiro (600 linhas, 13 MB). Duas causas, medidas separadamente:
--
-- 1. ST_Intersection é um overlay GEOS: só ele custava ~1,6 s dos 1,8 s.
--    ST_ClipByBox2D faz o recorte por caixa sem overlay.
-- 2. ST_Simplify quase não reduz uma rede de MT: a linha é uma árvore com
--    centenas de ramos de 2–3 pontos, e simplify não remove ponto de ramo
--    curto. O que reduz é DESCARTAR os ramos menores que a tolerância do zoom
--    (no zoom 7 um ramo de 500 m tem 1 px). Por isso três geometrias
--    pré-calculadas na promoção, uma por faixa de zoom, e a cheia do 14 em
--    diante.

ALTER TABLE public.rede_alimentador
  ADD COLUMN IF NOT EXISTS geom_z1 geometry(MultiLineString, 4326),   -- zoom 9–10
  ADD COLUMN IF NOT EXISTS geom_z2 geometry(MultiLineString, 4326),   -- 11–12
  ADD COLUMN IF NOT EXISTS geom_z3 geometry(MultiLineString, 4326),   -- 13–14
  -- Envelope separado para o filtro espacial: o `&&` sobre `geom` passa pelo
  -- índice, mas o RECHECK da heap destoasta a árvore inteira (10 KB) para 800
  -- candidatos — 620 ms só para escolher os ids. O envelope tem 5 pontos.
  ADD COLUMN IF NOT EXISTS envelope geometry(Polygon, 4326);
CREATE INDEX IF NOT EXISTS rede_alimentador_envelope_idx ON public.rede_alimentador USING gist (envelope);

-- Por que SnapToGrid + UnaryUnion antes do LineMerge: os trechos da SSDMT não
-- compartilham o nó com exatidão (o ogr2ogr só mergeou o que coincidia), e um
-- alimentador de 30 km chegava com 383 partes de ≤ 500 m — todas descartadas
-- por qualquer mínimo razoável (73% dos alimentadores sumiam no zoom < 9).
-- Encaixando os nós numa grade da ordem da tolerância, a união costura a
-- árvore e o merge devolve ramos longos. Medido em 300 alimentadores: de 383
-- partes/2 pontos cada para 93 partes/187 pontos, 3,5 KB por linha no nível 1.
-- Ramos menores que `minimo` (graus) somem; `preserveCollapsed = false` leva
-- junto o ramo que colapsa num ponto.
CREATE OR REPLACE FUNCTION public.rede_tracado_nivel(g geometry, tol FLOAT8, minimo FLOAT8)
RETURNS geometry LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT ST_Multi(ST_CollectionExtract(ST_Collect(p.geom), 2))
    FROM (SELECT ST_Simplify(d.geom, tol, FALSE) AS geom
            FROM ST_Dump(ST_LineMerge(ST_UnaryUnion(ST_SnapToGrid(g, tol / 3)))) d
           WHERE ST_Length(d.geom) >= minimo) p
   WHERE p.geom IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.rede_alimentador_simplificar() RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  UPDATE public.rede_alimentador SET
    geom_z1 = public.rede_tracado_nivel(geom, 0.003,  0.003),   -- ~330 m: 1 px no zoom 8
    geom_z2 = public.rede_tracado_nivel(geom, 0.001,  0.001),   -- ~110 m: 1 px no zoom 10
    geom_z3 = public.rede_tracado_nivel(geom, 0.0003, 0.0003),  -- ~33 m:  1 px no zoom 12
    envelope = ST_Envelope(geom)
  WHERE geom IS NOT NULL AND ativo;
$fn$;

-- Entra na conclusão da carga, depois da promoção.
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
  PERFORM public.rede_alimentador_simplificar();
  PERFORM public.rede_celula_limpar();
  PERFORM public.rede_celula_inserir();
  SELECT count(*) INTO n_cel FROM public.rede_celula_agregada;
  RETURN prom || jsonb_build_object('celulas', n_cel);
END $fn$;

CREATE OR REPLACE VIEW public.rede_alimentador_no_mapa AS
  SELECT a.id, a.geom, a.risco, a.ocupacao_pct,
         jsonb_build_object('id', a.id, 'codigo', a.codigo, 'risco', a.risco,
           'ocupacao_pct', a.ocupacao_pct, 'carga_min_diurna_kw', a.carga_min_diurna_kw,
           'gd_conectada_kw', a.gd_conectada_kw, 'trafos', a.trafos,
           'trafos_risco', a.trafos_risco, 'subestacao', s.nome,
           -- a caixa sai do envelope (5 pontos), não da árvore de 600: era o
           -- que destoastava a geometria cheia em toda chamada
           'oeste', ST_XMin(a.envelope), 'sul', ST_YMin(a.envelope),
           'leste', ST_XMax(a.envelope), 'norte', ST_YMax(a.envelope)) AS j,
         -- colunas novas de uma view só podem entrar NO FIM (CREATE OR REPLACE)
         a.geom_z1, a.geom_z2, a.geom_z3
    FROM public.rede_alimentador a
    LEFT JOIN public.rede_subestacao s ON s.id = a.subestacao_id
   WHERE a.ativo AND a.geom IS NOT NULL;
ALTER VIEW public.rede_alimentador_no_mapa SET (security_invoker = true);

-- Geometria do nível, recortada por caixa (sem overlay). Medido depois da
-- costura (13/10/2026): no estado inteiro (zoom 7) ainda eram 4,0 s e 2,6 MB
-- para 599 linhas — e no zoom 7 um alimentador tem 1 px: não informa nada
-- que a célula já não diga. Decisão: alimentadores só do zoom 9 em diante;
-- no 9–10 só risco/atenção com o nível 1 e teto 300 (visão regional dos
-- pontos quentes). O filtro espacial é `&&` (só o índice): o ST_Intersects
-- exato sobre 1.000 árvores de 600 pontos custava 0,7 s sozinho, e quem não
-- toca a caixa de verdade sai vazio no recorte.
CREATE OR REPLACE FUNCTION public.rede_mapa_alimentadores(cx geometry, p_zoom INT, so_risco BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  WITH jan AS (SELECT ST_Expand(cx, (ST_XMax(cx) - ST_XMin(cx)) * 0.1) AS g),
       -- primeiro só os ids: ordenar a view inteira calculava o JSON (com
       -- quatro ST_XMin/Max sobre a geometria cheia) para TODOS os candidatos
       -- antes do LIMIT — 1,4 s numa vista regional
       ids AS (
         SELECT a.id FROM public.rede_alimentador a, jan
          WHERE p_zoom >= 9 AND a.ativo AND a.envelope IS NOT NULL
            AND a.envelope && jan.g
            AND (NOT (so_risco OR p_zoom < 11) OR a.risco IN ('risco','atencao'))
          ORDER BY a.ocupacao_pct DESC NULLS LAST
          LIMIT CASE WHEN p_zoom < 11 THEN 300 ELSE 600 END),
       z AS (
         SELECT v.id, v.j,
                CASE WHEN p_zoom < 11 THEN v.geom_z1 WHEN p_zoom < 13 THEN v.geom_z2
                     WHEN p_zoom < 15 THEN v.geom_z3 ELSE v.geom END AS g
           FROM public.rede_alimentador_no_mapa v JOIN ids USING (id)),
       w AS (
         SELECT z.id, z.j, ST_Multi(ST_CollectionExtract(ST_ClipByBox2D(z.g, jan.g::box2d), 2)) AS g
           FROM z, jan WHERE z.g IS NOT NULL)
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(w.id, w.g, w.j,
                                CASE WHEN p_zoom < 13 THEN 4 ELSE 5 END))
                                FROM w WHERE w.g IS NOT NULL AND NOT ST_IsEmpty(w.g)));
$fn$;

-- `rede_tolerancia_alimentador(INTEGER)` ficou sem uso (as tolerâncias agora
-- vivem em rede_alimentador_simplificar). O DROP depende do portão do MCP;
-- fica para a limpeza seguinte. Continua sem EXECUTE para anon/authenticated.

REVOKE ALL ON FUNCTION public.rede_tracado_nivel(geometry, FLOAT8, FLOAT8) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_alimentador_simplificar()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rede_alimentador_no_mapa FROM anon, authenticated;

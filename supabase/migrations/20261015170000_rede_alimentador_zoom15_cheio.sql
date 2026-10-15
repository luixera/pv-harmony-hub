-- Traçado dos alimentadores: geometria CHEIA a partir do zoom 15.
--
-- A v3 passou a usar o nível 3 (tolerância 33 m, ramos < 33 m descartados)
-- nos zooms 15–16 para economizar rede. Em produção (15/10/2026, São José do
-- Rio Preto no zoom 16, 1 px = 2,4 m) as linhas apareciam "cortadas": ramos
-- terminando no meio da rua e emendas da grade de 11 m visíveis. No 16 a
-- geometria cheia custa 404–716 KB (72 linhas): cabe. Volta à regra da v2.
CREATE OR REPLACE FUNCTION public.rede_mapa_alimentadores(cx geometry, p_zoom INT, so_risco BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  WITH jan AS (SELECT ST_Expand(cx, (ST_XMax(cx) - ST_XMin(cx)) * 0.1) AS g),
       ids AS (
         SELECT a.id FROM public.rede_alimentador a, jan
          WHERE p_zoom >= 9 AND a.ativo AND a.envelope IS NOT NULL
            AND a.envelope && jan.g
            AND (NOT (so_risco OR p_zoom < 11) OR a.risco IN ('risco','atencao'))
          ORDER BY a.ocupacao_pct DESC NULLS LAST
          LIMIT CASE WHEN p_zoom < 11 THEN 300 ELSE 600 END),
       z AS (
         SELECT v.id, v.j,
                CASE WHEN p_zoom < 13 THEN v.geom_z1 WHEN p_zoom < 15 THEN v.geom_z2 ELSE v.geom END AS g
           FROM public.rede_alimentador_no_mapa v JOIN ids USING (id)),
       w AS (
         SELECT z.id, z.j, ST_Multi(ST_CollectionExtract(ST_ClipByBox2D(z.g, jan.g::box2d), 2)) AS g
           FROM z, jan WHERE z.g IS NOT NULL)
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(w.id, w.g, w.j,
                                CASE WHEN p_zoom < 13 THEN 4 ELSE 5 END))
                                FROM w WHERE w.g IS NOT NULL AND NOT ST_IsEmpty(w.g)));
$fn$;
REVOKE ALL ON FUNCTION public.rede_mapa_alimentadores(geometry, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;

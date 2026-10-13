-- O que o mapa lê, por bounding box e zoom.
--
-- Spec §7. Zoom distante lê células agregadas; zoom próximo lê trafos reais.
-- Quem decide é esta RPC, não a tela. O teto de feições existe para o
-- navegador não travar: acima dele a tela diz "aproxime para ver cada um"
-- em vez de tentar desenhar tudo.
--
-- Decomposto em views e funções pequenas pela mesma razão do cálculo: cada
-- peça é verificável isoladamente, e o servidor MCP usado para aplicar isto
-- engasga com statements longos.

-- ── Views: já montam o JSON de cada feição ──────────────────────────────────

CREATE OR REPLACE VIEW public.rede_ponto_no_mapa AS
  SELECT t.id, t.geom, t.risco, t.ocupacao_pct,
         jsonb_build_object('id', t.id, 'codigo', t.codigo, 'risco', t.risco,
           'lng', ST_X(t.geom), 'lat', ST_Y(t.geom),
           'potencia_nominal_kva', t.potencia_nominal_kva,
           'carga_min_diurna_kw', t.carga_min_diurna_kw,
           'gd_conectada_kw', t.gd_conectada_kw, 'margem_kw', t.margem_kw,
           'ocupacao_pct', t.ocupacao_pct, 'alimentador', a.codigo,
           'subestacao', s.nome) AS j
    FROM public.rede_transformador t
    LEFT JOIN public.rede_alimentador a ON a.id = t.alimentador_id
    LEFT JOIN public.rede_subestacao  s ON s.id = a.subestacao_id
   WHERE t.ativo;

CREATE OR REPLACE VIEW public.rede_celula_no_mapa AS
  SELECT c.id, c.nivel, c.geom, c.risco,
         jsonb_build_object('id', c.id, 'risco', c.risco, 'trafos', c.trafos,
           'trafos_risco', c.trafos_risco, 'trafos_atencao', c.trafos_atencao,
           'oeste', ST_XMin(c.geom), 'sul', ST_YMin(c.geom),
           'leste', ST_XMax(c.geom), 'norte', ST_YMax(c.geom)) AS j
    FROM public.rede_celula_agregada c;

-- ── Procedência: alimenta o rótulo de data-base e idade do dado na tela ─────
-- Com a opção B da spec (defasagem não descontada), esse rótulo é a principal
-- proteção contra a leitura otimista do semáforo.

CREATE OR REPLACE FUNCTION public.rede_base_atual() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT jsonb_build_object('distribuidora', d.nome, 'sigla', d.sigla,
           'data_base', d.data_base, 'importado_em', i.concluido_em)
    FROM public.rede_distribuidora d
    LEFT JOIN LATERAL (SELECT concluido_em FROM public.rede_importacao
       WHERE distribuidora_id = d.id AND situacao = 'concluida'
       ORDER BY concluido_em DESC NULLS LAST LIMIT 1) i ON TRUE
   ORDER BY d.data_base DESC NULLS LAST LIMIT 1;
$fn$;

-- ── Uma função por camada ───────────────────────────────────────────────────
-- O teto de 1500 aparece aqui e na flag `excedeu` da RPC de entrada.

CREATE OR REPLACE FUNCTION public.rede_mapa_celula(cx geometry, n SMALLINT, so_risco BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.rede_celula_no_mapa c
               WHERE c.nivel = n AND ST_Intersects(c.geom, cx)
                 AND (NOT so_risco OR c.risco IN ('risco','atencao'))),
    'itens', COALESCE((SELECT jsonb_agg(z.j) FROM (
               SELECT c.j FROM public.rede_celula_no_mapa c
                WHERE c.nivel = n AND ST_Intersects(c.geom, cx)
                  AND (NOT so_risco OR c.risco IN ('risco','atencao'))
                LIMIT 1500) z), '[]'::jsonb));
$fn$;

CREATE OR REPLACE FUNCTION public.rede_mapa_ponto(cx geometry, so_risco BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.rede_ponto_no_mapa t
               WHERE ST_Intersects(t.geom, cx)
                 AND (NOT so_risco OR t.risco IN ('risco','atencao','sem_dado'))),
    'itens', COALESCE((SELECT jsonb_agg(z.j) FROM (
               SELECT t.j FROM public.rede_ponto_no_mapa t
                WHERE ST_Intersects(t.geom, cx)
                  AND (NOT so_risco OR t.risco IN ('risco','atencao','sem_dado'))
                ORDER BY t.ocupacao_pct DESC NULLS LAST
                LIMIT 1500) z), '[]'::jsonb));
$fn$;

-- ── A entrada ───────────────────────────────────────────────────────────────
-- Gate estrito: SÓ master. Nem service_role entra, porque isto é leitura de
-- tela e não tem uso de servidor.

CREATE OR REPLACE FUNCTION public.rede_no_mapa(
  p_oeste NUMERIC, p_sul NUMERIC, p_leste NUMERIC, p_norte NUMERIC,
  p_zoom INTEGER DEFAULT 10, p_so_risco BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE cx geometry; d JSONB; cam TEXT;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  cx := ST_MakeEnvelope(p_oeste, p_sul, p_leste, p_norte, 4326);
  IF p_zoom < 12 THEN
    cam := 'celula';
    d := public.rede_mapa_celula(cx, (CASE WHEN p_zoom < 9 THEN 1 ELSE 2 END)::SMALLINT, p_so_risco);
  ELSE
    cam := 'ponto';
    d := public.rede_mapa_ponto(cx, p_so_risco);
  END IF;
  RETURN jsonb_build_object('camada', cam,
    'base', COALESCE(public.rede_base_atual(), '{}'::jsonb),
    'itens', d->'itens', 'total', d->'total',
    'excedeu', (d->>'total')::INT > 1500);
END $fn$;

-- ── Permissões: só a entrada é chamável de fora ─────────────────────────────
REVOKE ALL ON FUNCTION public.rede_mapa_celula(geometry, SMALLINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_ponto(geometry, BOOLEAN)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_base_atual()                             FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rede_no_mapa(NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_no_mapa(NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,BOOLEAN) TO authenticated;

-- Mapa v3 — amostragem adaptativa, payload enxuto, auditoria do dado.
-- Spec: docs/superpowers/specs/2026-10-10-capacidade-rede-design.md §12.
--
-- Medido em 15/10/2026 (vista 1920×1080 sobre Campinas, as duas CPFL): a v2
-- devolvia 8,4 MB no zoom 11 (4.000 células CORTADAS + 600 alimentadores em
-- 59.877 partes) e 4,2 MB no 14 (4.000 pontos de 12.508, 540 bytes cada).
-- O nível de célula era escolhido pelo zoom, calibrado numa tela menor e só
-- com a Piratininga. Aqui o servidor escolhe pela CONTAGEM da caixa.

-- ── 1. Nível 5 de célula (0,0025°, ~275 m) ─────────────────────────────────
-- No zoom 15 em Campinas há 6.252 trafos na caixa: acima do teto de pontos, e
-- o nível 4 daria 276 blocos de 120 px. O 5 dá ~1.100 blocos de 60 px.
ALTER TABLE public.rede_celula_agregada
  DROP CONSTRAINT IF EXISTS rede_celula_agregada_nivel_check,
  ADD CONSTRAINT rede_celula_agregada_nivel_check CHECK (nivel BETWEEN 1 AND 5);
COMMENT ON COLUMN public.rede_celula_agregada.nivel IS
  '1 = 0,2° (~22 km) · 2 = 0,05° · 3 = 0,0125° · 4 = 0,005° · 5 = 0,0025° (~275 m). O nível é escolhido pela contagem da caixa (rede_amostra), não pelo zoom.';

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
                      (3::SMALLINT, 0.0125::NUMERIC), (4::SMALLINT, 0.005::NUMERIC),
                      (5::SMALLINT, 0.0025::NUMERIC)) n(nivel, passo)
   WHERE t.ativo
   GROUP BY 1,2,3,4,5;
ALTER VIEW public.rede_celula_calculada SET (security_invoker = true);

-- A cor da célula deixa de ser "o pior estado presente": com 300 trafos numa
-- célula de 5 km, um só em risco pintava Campinas inteira de vermelho e a cor
-- não dizia nada. Agora um estado manda quando atinge UM EM CINCO dos trafos
-- da célula (ou pelo menos um, nas células pequenas, onde um trafo importa).
-- A proporção exata vai nas propriedades e a legenda explica a regra.
CREATE OR REPLACE VIEW public.rede_celula_pronta AS
  SELECT did AS distribuidora_id, nivel, t AS trafos, r AS trafos_risco,
         a AS trafos_atencao, f AS trafos_folga, s AS trafos_sem_dado,
         (CASE WHEN r     >= GREATEST(1, ceil(t * 0.2)) THEN 'risco'
               WHEN r + a >= GREATEST(1, ceil(t * 0.2)) THEN 'atencao'
               WHEN f > 0 THEN 'folga' ELSE 'sem_dado' END)::public.rede_risco AS risco,
         ST_SetSRID(ST_MakeEnvelope((cx*passo)::float8, (cy*passo)::float8,
           ((cx+1)*passo)::float8, ((cy+1)*passo)::float8), 4326) AS geom
    FROM public.rede_celula_calculada;
ALTER VIEW public.rede_celula_pronta SET (security_invoker = true);

-- ── 2. Baixa tensão: UCs atendidas e unidades de GD por trafo ──────────────
-- A ingestão já contava (`count(*) AS ucs` em UCBT, `AS unidades` em UGBT) e
-- descartava. Para a análise de BT são os dois números que a pessoa pergunta
-- primeiro. Nulos até a próxima reingestão; a tela mostra "—".
ALTER TABLE public.rede_transformador
  ADD COLUMN IF NOT EXISTS unidades_consumidoras INTEGER,
  ADD COLUMN IF NOT EXISTS gd_unidades INTEGER;
ALTER TABLE public.rede_stg_transformador
  ADD COLUMN IF NOT EXISTS unidades_consumidoras INTEGER,
  ADD COLUMN IF NOT EXISTS gd_unidades INTEGER;
COMMENT ON COLUMN public.rede_transformador.unidades_consumidoras IS 'UCs de BT ligadas ao trafo na BDGD (UCBT.UNI_TR_MT). Nulo = carga anterior a 15/10/2026.';
COMMENT ON COLUMN public.rede_transformador.gd_unidades IS 'Unidades de GD em BT ligadas ao trafo (UGBT.UNI_TR_MT). Nulo = carga anterior a 15/10/2026.';

CREATE OR REPLACE FUNCTION public.rede_promover_trafo(p_imp BIGINT, d BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.rede_transformador
    (distribuidora_id, alimentador_id, codigo, potencia_nominal_kva, fases,
     tensao_secundaria_v, carga_min_diurna_kw, gd_conectada_kw,
     unidades_consumidoras, gd_unidades, geom, ativo, atualizado_em)
  SELECT d, al.id, t.codigo, t.potencia_nominal_kva, t.fases,
         t.tensao_secundaria_v, t.carga_min_diurna_kw, t.gd_conectada_kw,
         t.unidades_consumidoras, t.gd_unidades,
         ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326), TRUE, now()
    FROM public.rede_stg_transformador t
    LEFT JOIN public.rede_alimentador al
           ON al.distribuidora_id = d AND al.codigo = t.alimentador_codigo
   WHERE t.importacao_id = p_imp
  ON CONFLICT (distribuidora_id, codigo) DO UPDATE
    SET alimentador_id = EXCLUDED.alimentador_id,
        potencia_nominal_kva = EXCLUDED.potencia_nominal_kva,
        fases = EXCLUDED.fases, tensao_secundaria_v = EXCLUDED.tensao_secundaria_v,
        carga_min_diurna_kw = EXCLUDED.carga_min_diurna_kw,
        gd_conectada_kw = EXCLUDED.gd_conectada_kw,
        unidades_consumidoras = EXCLUDED.unidades_consumidoras,
        gd_unidades = EXCLUDED.gd_unidades,
        geom = EXCLUDED.geom, ativo = TRUE, atualizado_em = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

-- ── 3. Auditoria: ficha da fonte e histórico por importação ────────────────
ALTER TABLE public.rede_importacao
  ADD COLUMN IF NOT EXISTS hash_sha256   TEXT,
  ADD COLUMN IF NOT EXISTS tamanho_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS versao_bdgd   TEXT,
  ADD COLUMN IF NOT EXISTS baixado_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS regras        JSONB,
  ADD COLUMN IF NOT EXISTS mudancas      JSONB;
COMMENT ON COLUMN public.rede_importacao.hash_sha256 IS 'SHA-256 do zip baixado da ANEEL, calculado em streaming pelo worker. Prova de qual arquivo gerou esta carga.';
COMMENT ON COLUMN public.rede_importacao.regras IS 'fator, limiares e janela de geração VIGENTES na conclusão da carga (o semáforo depende deles).';
COMMENT ON COLUMN public.rede_importacao.mudancas IS 'Comparação com a carga anterior da mesma distribuidora: novos, inativados, transições de risco. Nulo = sem carga anterior com histórico.';

-- Estado de cada trafo em cada carga. 295 mil linhas por carga anual: barato,
-- e é o que permite dizer "na base anterior este trafo estava em atenção".
CREATE TABLE IF NOT EXISTS public.rede_transformador_hist (
  importacao_id       BIGINT NOT NULL REFERENCES public.rede_importacao(id) ON DELETE CASCADE,
  transformador_id    BIGINT NOT NULL REFERENCES public.rede_transformador(id) ON DELETE CASCADE,
  risco               public.rede_risco NOT NULL,
  ocupacao_pct        NUMERIC(8,2),
  margem_kw           NUMERIC(12,2),
  carga_min_diurna_kw NUMERIC(12,2),
  gd_conectada_kw     NUMERIC(12,2),
  ativo               BOOLEAN NOT NULL,
  PRIMARY KEY (importacao_id, transformador_id)
);
CREATE INDEX IF NOT EXISTS rede_transformador_hist_trafo_idx ON public.rede_transformador_hist (transformador_id);
-- Sem política: só as funções SECURITY DEFINER (e o service role) chegam aqui.
ALTER TABLE public.rede_transformador_hist ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rede_registrar_hist(p_imp BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.rede_transformador_hist
    (importacao_id, transformador_id, risco, ocupacao_pct, margem_kw,
     carga_min_diurna_kw, gd_conectada_kw, ativo)
  SELECT p_imp, t.id, t.risco, t.ocupacao_pct, t.margem_kw,
         t.carga_min_diurna_kw, t.gd_conectada_kw, t.ativo
    FROM public.rede_transformador t
    JOIN public.rede_importacao i ON i.id = p_imp
   WHERE t.distribuidora_id = i.distribuidora_id
  ON CONFLICT (importacao_id, transformador_id) DO UPDATE
    SET risco = EXCLUDED.risco, ocupacao_pct = EXCLUDED.ocupacao_pct,
        margem_kw = EXCLUDED.margem_kw, carga_min_diurna_kw = EXCLUDED.carga_min_diurna_kw,
        gd_conectada_kw = EXCLUDED.gd_conectada_kw, ativo = EXCLUDED.ativo;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

-- A carga concluída imediatamente anterior, da mesma distribuidora, que tenha
-- histórico — é com ela que se compara.
CREATE OR REPLACE FUNCTION public.rede_importacao_anterior(p_imp BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT j.id
    FROM public.rede_importacao i
    JOIN public.rede_importacao j ON j.distribuidora_id = i.distribuidora_id
                                 AND j.id < i.id AND j.situacao = 'concluida'
   WHERE i.id = p_imp
     AND EXISTS (SELECT 1 FROM public.rede_transformador_hist h WHERE h.importacao_id = j.id)
   ORDER BY j.id DESC LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.rede_mudancas(p_imp BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE ant BIGINT; r JSONB; totais JSONB;
BEGIN
  ant := public.rede_importacao_anterior(p_imp);
  SELECT jsonb_build_object(
           'ativos',   count(*) FILTER (WHERE h.ativo),
           'risco',    count(*) FILTER (WHERE h.ativo AND h.risco = 'risco'),
           'atencao',  count(*) FILTER (WHERE h.ativo AND h.risco = 'atencao'),
           'folga',    count(*) FILTER (WHERE h.ativo AND h.risco = 'folga'),
           'sem_dado', count(*) FILTER (WHERE h.ativo AND h.risco = 'sem_dado'))
    INTO totais FROM public.rede_transformador_hist h WHERE h.importacao_id = p_imp;
  IF ant IS NULL THEN
    RETURN jsonb_build_object('anterior', NULL, 'totais', totais);
  END IF;
  WITH agora AS (SELECT * FROM public.rede_transformador_hist WHERE importacao_id = p_imp),
       antes AS (SELECT * FROM public.rede_transformador_hist WHERE importacao_id = ant),
       par AS (SELECT COALESCE(a.transformador_id, b.transformador_id) AS tid,
                      a.risco AS depois, COALESCE(a.ativo, FALSE) AS ativo_depois,
                      b.risco AS antes,  COALESCE(b.ativo, FALSE) AS ativo_antes
                 FROM agora a FULL JOIN antes b ON b.transformador_id = a.transformador_id)
  SELECT jsonb_build_object(
           'anterior', (SELECT jsonb_build_object('importacao_id', i.id, 'data_base', i.data_base,
                                                  'concluido_em', i.concluido_em)
                          FROM public.rede_importacao i WHERE i.id = ant),
           'novos',      count(*) FILTER (WHERE antes IS NULL AND ativo_depois),
           'inativados', count(*) FILTER (WHERE ativo_antes AND NOT ativo_depois),
           'reativados', count(*) FILTER (WHERE antes IS NOT NULL AND NOT ativo_antes AND ativo_depois),
           'iguais',     count(*) FILTER (WHERE ativo_antes AND ativo_depois AND antes = depois),
           'mudaram',    count(*) FILTER (WHERE ativo_antes AND ativo_depois AND antes <> depois),
           'transicoes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('de', x.antes, 'para', x.depois, 'n', x.n)
                                                    ORDER BY x.n DESC), '[]'::jsonb)
                            FROM (SELECT antes, depois, count(*) AS n FROM par
                                   WHERE ativo_antes AND ativo_depois AND antes <> depois
                                   GROUP BY 1, 2) x),
           'totais', totais)
    INTO r FROM par;
  RETURN r;
END $fn$;

-- A conclusão da carga passa a gravar histórico, regras vigentes e mudanças.
CREATE OR REPLACE FUNCTION public.rede_concluir_carga(p_importacao_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE prom JSONB; g RECORD; j RECORD; n_cel INT;
BEGIN
  prom := public.rede_promover_nucleo(p_importacao_id);
  UPDATE public.rede_distribuidora d SET data_base = i.data_base, atualizado_em = now()
    FROM public.rede_importacao i
   WHERE i.id = p_importacao_id AND d.id = i.distribuidora_id;
  SELECT * INTO g FROM public.rede_regras();
  SELECT * INTO j FROM public.rede_janela_geracao();
  PERFORM public.rede_aplicar_trafos(g.fator, g.atencao, g.risco);
  PERFORM public.rede_aplicar_alimentadores(g.fator, g.atencao, g.risco);
  PERFORM public.rede_contar_trafos_alimentador();
  PERFORM public.rede_alimentador_simplificar();
  PERFORM public.rede_registrar_hist(p_importacao_id);
  UPDATE public.rede_importacao
     SET regras   = jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco', g.risco,
                                       'janela_inicio', j.inicio, 'janela_fim', j.fim),
         mudancas = public.rede_mudancas(p_importacao_id)
   WHERE id = p_importacao_id;
  PERFORM public.rede_celula_limpar();
  PERFORM public.rede_celula_inserir();
  SELECT count(*) INTO n_cel FROM public.rede_celula_agregada;
  RETURN prom || jsonb_build_object('celulas', n_cel);
END $fn$;

-- Backfill: a última carga concluída de cada distribuidora É o estado atual
-- das tabelas, então o histórico dela pode ser escrito agora. As regras
-- gravadas são as vigentes hoje (não mudaram desde a carga de 13/10/2026).
DO $do$
DECLARE r RECORD; g RECORD; j RECORD;
BEGIN
  SELECT * INTO g FROM public.rede_regras();
  SELECT * INTO j FROM public.rede_janela_geracao();
  FOR r IN SELECT DISTINCT ON (distribuidora_id) id FROM public.rede_importacao
            WHERE situacao = 'concluida' ORDER BY distribuidora_id, id DESC LOOP
    PERFORM public.rede_registrar_hist(r.id);
    UPDATE public.rede_importacao
       SET regras   = COALESCE(regras, jsonb_build_object('fator', g.fator, 'atencao', g.atencao,
                       'risco', g.risco, 'janela_inicio', j.inicio, 'janela_fim', j.fim)),
           mudancas = public.rede_mudancas(r.id)
     WHERE id = r.id;
  END LOOP;
END $do$;

-- ── 4. Amostra pela contagem, não pelo zoom ─────────────────────────────────
-- Conta com LIMIT teto+1: para de varrer assim que souber que passou. Até o
-- teto, pontos. Acima, o passo mais fino que caiba no teto de células.
CREATE OR REPLACE FUNCTION public.rede_amostra(cx geometry, so_risco BOOLEAN, teto_pontos INT, teto_celulas INT)
RETURNS TABLE(camada TEXT, nivel SMALLINT, contagem INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE n INT; w FLOAT8; h FLOAT8;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.rede_transformador t
     WHERE t.ativo AND t.geom && cx AND (NOT so_risco OR t.risco <> 'folga')
     LIMIT teto_pontos + 1) s;
  IF n <= teto_pontos THEN
    camada := 'ponto'; nivel := NULL; contagem := n;
    RETURN NEXT; RETURN;
  END IF;
  w := ST_XMax(cx) - ST_XMin(cx); h := ST_YMax(cx) - ST_YMin(cx);
  SELECT v.nv INTO nivel
    FROM (VALUES (5::SMALLINT, 0.0025), (4::SMALLINT, 0.005), (3::SMALLINT, 0.0125),
                 (2::SMALLINT, 0.05), (1::SMALLINT, 0.2)) v(nv, passo)
   WHERE ceil(w / v.passo) * ceil(h / v.passo) <= teto_celulas
   ORDER BY v.nv DESC LIMIT 1;
  camada := 'celula'; nivel := COALESCE(nivel, 1::SMALLINT); contagem := n;
  RETURN NEXT;
END $fn$;

-- Propriedades mínimas: o que a cor, o hover e a lista precisam. O resto vem
-- em rede_trafo_detalhe no clique. 5 casas = 1 m.
CREATE OR REPLACE FUNCTION public.rede_mapa_pontos_v3(cx geometry, so_risco BOOLEAN, teto INT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(z.id, z.geom,
           jsonb_build_object('id', z.id, 'codigo', z.codigo, 'risco', z.risco, 'ocupacao_pct', z.ocupacao_pct), 5))
    FROM (SELECT t.id, t.geom, t.codigo, t.risco, t.ocupacao_pct
            FROM public.rede_transformador t
           WHERE t.ativo AND t.geom && cx AND (NOT so_risco OR t.risco <> 'folga')
           ORDER BY t.ocupacao_pct DESC NULLS LAST
           LIMIT teto) z));
$fn$;

CREATE OR REPLACE FUNCTION public.rede_mapa_celulas_v3(cx geometry, n SMALLINT, so_risco BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(c.id, c.geom,
           jsonb_build_object('id', c.id, 'nivel', c.nivel, 'risco', c.risco, 'trafos', c.trafos,
                              'trafos_risco', c.trafos_risco, 'trafos_atencao', c.trafos_atencao),
           CASE WHEN n >= 4 THEN 5 ELSE 4 END))
    FROM (SELECT c.* FROM public.rede_celula_agregada c
           WHERE c.nivel = n AND c.geom && cx
             AND (NOT so_risco OR c.risco IN ('risco', 'atencao'))
           LIMIT 4000) c));
$fn$;

-- Traçado: um nível mais grosso por faixa do que na v2. No zoom 11–12 o nível
-- 1 (ramos < 330 m somem; 1 px = 76 m no 11) — medido abaixo na migração
-- aplicada: ver spec §12. A regra "só risco/atenção até o 10" e os tetos ficam.
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
                CASE WHEN p_zoom < 13 THEN v.geom_z1 WHEN p_zoom < 15 THEN v.geom_z2
                     WHEN p_zoom < 17 THEN v.geom_z3 ELSE v.geom END AS g
           FROM public.rede_alimentador_no_mapa v JOIN ids USING (id)),
       w AS (
         SELECT z.id, z.j, ST_Multi(ST_CollectionExtract(ST_ClipByBox2D(z.g, jan.g::box2d), 2)) AS g
           FROM z, jan WHERE z.g IS NOT NULL)
  SELECT public.rede_colecao((SELECT jsonb_agg(public.rede_feicao(w.id, w.g, w.j,
                                CASE WHEN p_zoom < 13 THEN 4 ELSE 5 END))
                                FROM w WHERE w.g IS NOT NULL AND NOT ST_IsEmpty(w.g)));
$fn$;

CREATE OR REPLACE FUNCTION public.rede_no_mapa_v3(
  p_oeste NUMERIC, p_sul NUMERIC, p_leste NUMERIC, p_norte NUMERIC,
  p_zoom INTEGER DEFAULT 10, p_so_risco BOOLEAN DEFAULT FALSE,
  p_camadas TEXT[] DEFAULT ARRAY['pontos']
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE cx geometry; am RECORD; g RECORD;
        teto_pontos CONSTANT INT := 4000; teto_celulas CONSTANT INT := 3000;
        pontos JSONB; celulas JSONB; alim JSONB; subs JSONB;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  cx := ST_MakeEnvelope(p_oeste, p_sul, p_leste, p_norte, 4326);
  SELECT * INTO am FROM public.rede_amostra(cx, p_so_risco, teto_pontos, teto_celulas);
  SELECT * INTO g FROM public.rede_regras();
  IF 'pontos' = ANY(p_camadas) THEN
    IF am.camada = 'ponto' THEN pontos  := public.rede_mapa_pontos_v3(cx, p_so_risco, teto_pontos);
    ELSE                        celulas := public.rede_mapa_celulas_v3(cx, am.nivel, p_so_risco); END IF;
  END IF;
  IF 'alimentadores' = ANY(p_camadas) THEN alim := public.rede_mapa_alimentadores(cx, p_zoom, p_so_risco); END IF;
  IF 'subestacoes'   = ANY(p_camadas) THEN subs := public.rede_mapa_subestacoes(cx); END IF;
  RETURN jsonb_build_object(
    'base',   COALESCE(public.rede_base_atual(), '{}'::jsonb),
    'regras', jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco', g.risco),
    'zoom', p_zoom, 'camada', am.camada, 'nivel', am.nivel,
    'contagem', am.contagem, 'teto_pontos', teto_pontos,
    'resumo', public.rede_mapa_resumo(cx, am.nivel),
    'pontos', pontos, 'celulas', celulas, 'alimentadores', alim, 'subestacoes', subs);
END $fn$;

-- ── 5. Detalhe do trafo: a conta aberta, os campos brutos, a base anterior ──
CREATE OR REPLACE FUNCTION public.rede_trafo_detalhe(p_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE g RECORD; j RECORD; r JSONB;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  SELECT * INTO g FROM public.rede_regras();
  SELECT * INTO j FROM public.rede_janela_geracao();
  SELECT jsonb_build_object(
           'id', t.id, 'codigo', t.codigo, 'risco', t.risco, 'ativo', t.ativo,
           'lng', ST_X(t.geom), 'lat', ST_Y(t.geom),
           'potencia_nominal_kva', t.potencia_nominal_kva, 'fases', t.fases,
           'tensao_secundaria_v', t.tensao_secundaria_v,
           'carga_min_diurna_kw', t.carga_min_diurna_kw, 'gd_conectada_kw', t.gd_conectada_kw,
           'margem_kw', t.margem_kw, 'ocupacao_pct', t.ocupacao_pct,
           'unidades_consumidoras', t.unidades_consumidoras, 'gd_unidades', t.gd_unidades,
           'atualizado_em', t.atualizado_em,
           'alimentador', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', a.id, 'codigo', a.codigo, 'risco', a.risco, 'ocupacao_pct', a.ocupacao_pct,
             'trafos', a.trafos, 'trafos_risco', a.trafos_risco) END,
           'subestacao', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('codigo', s.codigo, 'nome', s.nome) END,
           'distribuidora', jsonb_build_object('nome', d.nome, 'sigla', d.sigla, 'data_base', d.data_base),
           'regras', jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco', g.risco,
                                        'janela_inicio', j.inicio, 'janela_fim', j.fim),
           -- o que veio da BDGD, com o nome de lá: para conferir no arquivo da ANEEL
           'bdgd', jsonb_build_object('camada', 'UNTRMT', 'COD_ID', t.codigo, 'POT_NOM', t.potencia_nominal_kva,
                                      'CTMT', a.codigo, 'SUB', s.codigo, 'FAS_CON_P', t.fases,
                                      'TEN_LIN_SE_kV', CASE WHEN t.tensao_secundaria_v IS NULL THEN NULL
                                                            ELSE round(t.tensao_secundaria_v / 1000, 3) END),
           'fonte', (SELECT jsonb_build_object('importacao_id', i.id, 'arquivo_origem', i.arquivo_origem,
                              'versao_bdgd', i.versao_bdgd, 'data_base', i.data_base, 'hash_sha256', i.hash_sha256,
                              'tamanho_bytes', i.tamanho_bytes, 'baixado_em', i.baixado_em, 'concluido_em', i.concluido_em)
                       FROM public.rede_importacao i
                      WHERE i.distribuidora_id = t.distribuidora_id AND i.situacao = 'concluida'
                      ORDER BY i.id DESC LIMIT 1),
           'anterior', (SELECT jsonb_build_object('importacao_id', h.importacao_id, 'data_base', i.data_base,
                               'risco', h.risco, 'ocupacao_pct', h.ocupacao_pct, 'margem_kw', h.margem_kw,
                               'carga_min_diurna_kw', h.carga_min_diurna_kw, 'gd_conectada_kw', h.gd_conectada_kw,
                               'ativo', h.ativo)
                          FROM public.rede_transformador_hist h
                          JOIN public.rede_importacao i ON i.id = h.importacao_id
                         WHERE h.transformador_id = t.id
                           AND h.importacao_id < (SELECT max(i2.id) FROM public.rede_importacao i2
                                                   WHERE i2.distribuidora_id = t.distribuidora_id AND i2.situacao = 'concluida')
                         ORDER BY h.importacao_id DESC LIMIT 1))
    INTO r
    FROM public.rede_transformador t
    JOIN public.rede_distribuidora d ON d.id = t.distribuidora_id
    LEFT JOIN public.rede_alimentador a ON a.id = t.alimentador_id
    LEFT JOIN public.rede_subestacao  s ON s.id = a.subestacao_id
   WHERE t.id = p_id;
  RETURN r;   -- NULL quando não existe
END $fn$;

-- ── 6. Ficha da fonte: tudo que a tela precisa para a auditoria ─────────────
CREATE OR REPLACE FUNCTION public.rede_fontes() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE g RECORD; j RECORD; r JSONB;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  SELECT * INTO g FROM public.rede_regras();
  SELECT * INTO j FROM public.rede_janela_geracao();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'distribuidora', jsonb_build_object('id', d.id, 'nome', d.nome, 'sigla', d.sigla,
                              'codigo_aneel', d.codigo_aneel, 'uf', d.uf, 'data_base', d.data_base),
           'trafos', (SELECT jsonb_build_object(
                        'ativos',   count(*) FILTER (WHERE t.ativo),
                        'inativos', count(*) FILTER (WHERE NOT t.ativo),
                        'risco',    count(*) FILTER (WHERE t.ativo AND t.risco = 'risco'),
                        'atencao',  count(*) FILTER (WHERE t.ativo AND t.risco = 'atencao'),
                        'folga',    count(*) FILTER (WHERE t.ativo AND t.risco = 'folga'),
                        'sem_dado', count(*) FILTER (WHERE t.ativo AND t.risco = 'sem_dado'),
                        'com_ucs',  count(*) FILTER (WHERE t.ativo AND t.unidades_consumidoras IS NOT NULL))
                        FROM public.rede_transformador t WHERE t.distribuidora_id = d.id),
           'alimentadores', (SELECT jsonb_build_object(
                        'ativos',      count(*) FILTER (WHERE a.ativo),
                        'com_tracado', count(*) FILTER (WHERE a.ativo AND a.geom IS NOT NULL))
                        FROM public.rede_alimentador a WHERE a.distribuidora_id = d.id),
           'importacoes', (SELECT COALESCE(jsonb_agg(to_jsonb(i) - 'distribuidora_id' ORDER BY i.id DESC), '[]'::jsonb)
                             FROM (SELECT * FROM public.rede_importacao
                                    WHERE distribuidora_id = d.id ORDER BY id DESC LIMIT 8) i))
         ORDER BY d.nome), '[]'::jsonb)
    INTO r FROM public.rede_distribuidora d;
  RETURN jsonb_build_object(
    'regras_atuais', jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco', g.risco,
                                        'janela_inicio', j.inicio, 'janela_fim', j.fim),
    'distribuidoras', r);
END $fn$;

-- ── 7. Permissões: TODO objeto novo, varrido ────────────────────────────────
REVOKE ALL ON public.rede_transformador_hist FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_registrar_hist(BIGINT)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_importacao_anterior(BIGINT)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mudancas(BIGINT)                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_amostra(geometry, BOOLEAN, INT, INT)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_pontos_v3(geometry, BOOLEAN, INT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_celulas_v3(geometry, SMALLINT, BOOLEAN)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_mapa_alimentadores(geometry, INT, BOOLEAN)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_promover_trafo(BIGINT, BIGINT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_concluir_carga(BIGINT)                          FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rede_no_mapa_v3(NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,BOOLEAN,TEXT[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_no_mapa_v3(NUMERIC,NUMERIC,NUMERIC,NUMERIC,INTEGER,BOOLEAN,TEXT[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_trafo_detalhe(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_trafo_detalhe(BIGINT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_fontes()              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_fontes()              TO authenticated;

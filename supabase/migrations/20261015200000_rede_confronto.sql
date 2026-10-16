-- Confronto com a distribuidora: o parecer/orçamento real registrado no trafo.
-- Spec §13. Nasceu do orçamento OC00693/10-2026 da CPFL Paulista (posto de
-- transformação 189049 = nosso trafo 33820988): o número do posto não existe
-- na BDGD, e a GD declarada pela CPFL (18,85 kW) era 3,5x a nossa (5,42 kW) —
-- o que levou à correção do DEM_CONT. Registrar o documento no trafo resolve
-- os dois: o número vira pesquisável e o modelo ganha uma taxa de acerto.

DO $t$ BEGIN
  CREATE TYPE public.rede_parecer_resultado AS ENUM
    ('inversao_sem_novo', 'inversao_com_novo', 'sem_inversao', 'aprovado', 'aprovado_com_obra', 'reprovado');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

CREATE TABLE IF NOT EXISTS public.rede_parecer (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transformador_id           BIGINT NOT NULL REFERENCES public.rede_transformador(id) ON DELETE CASCADE,
  distribuidora_id           BIGINT NOT NULL REFERENCES public.rede_distribuidora(id) ON DELETE CASCADE,
  tipo                       TEXT NOT NULL CHECK (tipo IN ('orcamento_conexao', 'parecer_acesso', 'outro')),
  codigo_distribuidora       TEXT,            -- o "posto de transformação" da concessionária (ex.: 189049)
  numero_estudo              TEXT,            -- ex.: OC00693/10-2026
  numero_pedido              TEXT,            -- ex.: 2248586925
  data_documento             DATE,
  potencia_solicitada_kw     NUMERIC(10,2),
  resultado                  public.rede_parecer_resultado NOT NULL,
  potencia_injetavel_kw      NUMERIC(10,2),   -- alternativa viável, quando há
  -- o que a distribuidora declarou sobre o trafo (para comparar com a BDGD)
  ucs_distribuidora          INTEGER,
  gd_unidades_distribuidora  INTEGER,
  gd_kw_distribuidora        NUMERIC(12,2),
  carga_min_distribuidora_kw NUMERIC(12,2),
  -- o documento
  arquivo_nome               TEXT,
  arquivo_hash_sha256        TEXT,
  arquivo_caminho            TEXT,            -- no bucket rede-pareceres
  observacoes                TEXT,
  -- o que o modelo dizia NA HORA do registro (congelado; a base muda)
  risco_modelo               public.rede_risco NOT NULL,
  ocupacao_modelo            NUMERIC(8,2),
  gd_modelo_kw               NUMERIC(12,2),
  carga_modelo_kw            NUMERIC(12,2),
  importacao_id              BIGINT REFERENCES public.rede_importacao(id) ON DELETE SET NULL,
  acerto                     BOOLEAN,         -- NULL = sem conta (modelo sem dado)
  anulado                    BOOLEAN NOT NULL DEFAULT FALSE,
  registrado_por             UUID,
  criado_em                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rede_parecer IS
  'Orçamentos de conexão e pareceres de acesso reais, registrados no trafo. Só master lê; escrita por RPC.';
CREATE INDEX IF NOT EXISTS rede_parecer_trafo_idx ON public.rede_parecer (transformador_id);
CREATE INDEX IF NOT EXISTS rede_parecer_dist_idx  ON public.rede_parecer (distribuidora_id);
CREATE INDEX IF NOT EXISTS rede_parecer_codigo_trgm ON public.rede_parecer
  USING gin (codigo_distribuidora extensions.gin_trgm_ops);

ALTER TABLE public.rede_parecer ENABLE ROW LEVEL SECURITY;
CREATE POLICY rede_parecer_master_le ON public.rede_parecer FOR SELECT TO authenticated
  USING ((SELECT public.is_master(auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.rede_parecer FROM anon, authenticated;
REVOKE ALL ON public.rede_parecer FROM anon;

-- Acerto do modelo. "Inversão já existe" (ou reprovado) só é acerto se o
-- modelo dizia risco. "Inverte só com o novo", "sem inversão", aprovado (com
-- ou sem obra) são acerto quando o modelo dizia atenção ou folga. Sem dado
-- não conta: não há previsão para confrontar.
CREATE OR REPLACE FUNCTION public.rede_parecer_acerto(p_risco public.rede_risco, p_resultado public.rede_parecer_resultado)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE
    WHEN p_risco = 'sem_dado' THEN NULL
    WHEN p_resultado IN ('inversao_sem_novo', 'reprovado') THEN p_risco = 'risco'
    ELSE p_risco IN ('atencao', 'folga')
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rede_parecer_registrar(p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE t RECORD; imp BIGINT; novo public.rede_parecer; res public.rede_parecer_resultado;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  SELECT * INTO t FROM public.rede_transformador WHERE id = (p->>'transformador_id')::BIGINT;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transformador % nao existe', p->>'transformador_id'; END IF;
  res := (p->>'resultado')::public.rede_parecer_resultado;
  SELECT i.id INTO imp FROM public.rede_importacao i
   WHERE i.distribuidora_id = t.distribuidora_id AND i.situacao = 'concluida' ORDER BY i.id DESC LIMIT 1;
  INSERT INTO public.rede_parecer
    (transformador_id, distribuidora_id, tipo, codigo_distribuidora, numero_estudo, numero_pedido, data_documento,
     potencia_solicitada_kw, resultado, potencia_injetavel_kw,
     ucs_distribuidora, gd_unidades_distribuidora, gd_kw_distribuidora, carga_min_distribuidora_kw,
     arquivo_nome, arquivo_hash_sha256, arquivo_caminho, observacoes,
     risco_modelo, ocupacao_modelo, gd_modelo_kw, carga_modelo_kw, importacao_id, acerto, registrado_por)
  VALUES
    (t.id, t.distribuidora_id, COALESCE(p->>'tipo', 'orcamento_conexao'),
     NULLIF(btrim(p->>'codigo_distribuidora'), ''), NULLIF(btrim(p->>'numero_estudo'), ''),
     NULLIF(btrim(p->>'numero_pedido'), ''), (p->>'data_documento')::DATE,
     (p->>'potencia_solicitada_kw')::NUMERIC, res, (p->>'potencia_injetavel_kw')::NUMERIC,
     (p->>'ucs_distribuidora')::INT, (p->>'gd_unidades_distribuidora')::INT,
     (p->>'gd_kw_distribuidora')::NUMERIC, (p->>'carga_min_distribuidora_kw')::NUMERIC,
     NULLIF(p->>'arquivo_nome', ''), NULLIF(p->>'arquivo_hash_sha256', ''), NULLIF(p->>'arquivo_caminho', ''),
     NULLIF(btrim(p->>'observacoes'), ''),
     t.risco, t.ocupacao_pct, t.gd_conectada_kw, t.carga_min_diurna_kw, imp,
     public.rede_parecer_acerto(t.risco, res), auth.uid())
  RETURNING * INTO novo;
  RETURN to_jsonb(novo);
END $fn$;

-- Anular é UPDATE, nunca DELETE: o registro é prova.
CREATE OR REPLACE FUNCTION public.rede_parecer_anular(p_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  UPDATE public.rede_parecer SET anulado = TRUE WHERE id = p_id AND NOT anulado;
  RETURN FOUND;
END $fn$;

-- O trafo mais próximo de uma coordenada: o orçamento traz lat/long da UC,
-- não o código da BDGD. KNN pelo índice GiST, com raio em metros.
CREATE OR REPLACE FUNCTION public.rede_trafo_mais_proximo(p_lng FLOAT8, p_lat FLOAT8, p_raio_m INT DEFAULT 300)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE r JSONB; pt geometry;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Capacidade de rede e restrita a administracao da plataforma';
  END IF;
  pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  SELECT jsonb_build_object('id', t.id, 'codigo', t.codigo, 'risco', t.risco, 'ocupacao_pct', t.ocupacao_pct,
           'dist_m', round(ST_Distance(t.geom::geography, pt::geography)), 'lng', ST_X(t.geom), 'lat', ST_Y(t.geom))
    INTO r
    FROM public.rede_transformador t
   WHERE t.ativo AND ST_DWithin(t.geom::geography, pt::geography, LEAST(GREATEST(p_raio_m, 10), 5000))
   ORDER BY t.geom <-> pt LIMIT 1;
  RETURN r;
END $fn$;

-- A busca passa a achar o número do posto da distribuidora.
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
      UNION ALL
      -- o número do posto da concessionária, registrado num parecer
      (SELECT 3, 'trafo', t.id, t.codigo, 'posto ' || pr.codigo_distribuidora || COALESCE(' · ' || al.codigo, ''),
              t.risco::TEXT, ST_X(t.geom), ST_Y(t.geom), NULL, NULL, NULL, NULL
         FROM (SELECT DISTINCT ON (pr.transformador_id) pr.transformador_id, pr.codigo_distribuidora
                 FROM public.rede_parecer pr
                WHERE NOT pr.anulado AND pr.codigo_distribuidora ILIKE pad
                ORDER BY pr.transformador_id, pr.criado_em DESC LIMIT lim) pr
         JOIN public.rede_transformador t ON t.id = pr.transformador_id
         LEFT JOIN public.rede_alimentador al ON al.id = t.alimentador_id)
    ) x), '[]'::jsonb);
END $fn$;

-- O detalhe do trafo traz os confrontos registrados.
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
           'distribuidora', jsonb_build_object('id', d.id, 'nome', d.nome, 'sigla', d.sigla, 'data_base', d.data_base),
           'regras', jsonb_build_object('fator', g.fator, 'atencao', g.atencao, 'risco', g.risco,
                                        'janela_inicio', j.inicio, 'janela_fim', j.fim),
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
                         ORDER BY h.importacao_id DESC LIMIT 1),
           'pareceres', (SELECT COALESCE(jsonb_agg(to_jsonb(pr) ORDER BY pr.criado_em DESC), '[]'::jsonb)
                           FROM public.rede_parecer pr WHERE pr.transformador_id = t.id AND NOT pr.anulado))
    INTO r
    FROM public.rede_transformador t
    JOIN public.rede_distribuidora d ON d.id = t.distribuidora_id
    LEFT JOIN public.rede_alimentador a ON a.id = t.alimentador_id
    LEFT JOIN public.rede_subestacao  s ON s.id = a.subestacao_id
   WHERE t.id = p_id;
  RETURN r;
END $fn$;

-- A ficha da fonte ganha a taxa de acerto por distribuidora.
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
           'confrontos', (SELECT jsonb_build_object(
                        'n',         count(*),
                        'acertos',   count(*) FILTER (WHERE pr.acerto),
                        'erros',     count(*) FILTER (WHERE pr.acerto = FALSE),
                        'sem_conta', count(*) FILTER (WHERE pr.acerto IS NULL))
                        FROM public.rede_parecer pr WHERE pr.distribuidora_id = d.id AND NOT pr.anulado),
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

-- Bucket privado para o PDF do orçamento/parecer. Só master lê e grava; o
-- caminho é <transformador_id>/<sha256>.pdf — o hash no nome evita duplicata.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rede-pareceres', 'rede-pareceres', FALSE, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY rede_pareceres_master_le ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rede-pareceres' AND (SELECT public.is_master(auth.uid())));
CREATE POLICY rede_pareceres_master_grava ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rede-pareceres' AND (SELECT public.is_master(auth.uid())));

-- Permissões: TODO objeto novo, varrido.
REVOKE ALL ON FUNCTION public.rede_parecer_acerto(public.rede_risco, public.rede_parecer_resultado) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_parecer_registrar(JSONB)                   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_parecer_registrar(JSONB)                   TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_parecer_anular(BIGINT)                     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_parecer_anular(BIGINT)                     TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_trafo_mais_proximo(FLOAT8, FLOAT8, INT)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_trafo_mais_proximo(FLOAT8, FLOAT8, INT)    TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_buscar(TEXT, INTEGER)                      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_buscar(TEXT, INTEGER)                      TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_trafo_detalhe(BIGINT)                      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_trafo_detalhe(BIGINT)                      TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rede_fontes()                                   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rede_fontes()                                   TO authenticated;

# Capacidade de rede — mapa v2 (desempenho, busca, camadas, alimentadores) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o mapa de capacidade de rede do console `/painel` parar de travar, ganhar busca (município/endereço e código de trafo/alimentador/subestação), camadas ligáveis (transformadores, alimentadores com traçado, subestações) e o painel lateral do mockup — com os dados das duas CPFL já carregadas.

**Architecture:** O servidor passa a devolver **GeoJSON pronto** por camada (`rede_no_mapa_v2`), com dois níveis novos de célula para os zooms 11–13 e o traçado dos alimentadores simplificado por zoom. A tela troca mil `<Marker>` React por **camadas vetoriais nativas** (`google.maps.Data`), uma por tipo de feição, alimentadas por um hook imperativo. O traçado vem da camada `SSDMT` da BDGD, agregada por alimentador no `ogr2ogr` durante a ingestão (reingestão das duas CPFL com `--forcar`).

**Tech Stack:** Postgres/PostGIS + pg_trgm (Supabase) · ogr2ogr/SpatiaLite (VPS) · React 18 + React Query + `@react-google-maps/api` 2.20 (`useJsApiLoader`, `google.maps.Data`, Places `AutocompleteService`/`Geocoder`) · vitest (front) · node:test (worker).

**Spec:** `docs/superpowers/specs/2026-10-10-capacidade-rede-design.md`, §11 (revisão de 13/10/2026). §7 continua valendo como princípio.

## Global Constraints

- Só master vê qualquer coisa: toda RPC nova é `SECURITY DEFINER` com `IF NOT public.is_master(auth.uid()) THEN RAISE`. Nenhuma tabela `rede_*` tem `tenant_id` (ADR 0009).
- **Varrer privilégios de TODO objeto novo** (função e view): `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, e `GRANT EXECUTE ... TO authenticated` só nas três entradas (`rede_no_mapa_v2`, `rede_buscar`, `rede_alimentador_detalhe`). Supabase concede EXECUTE a `anon`/`authenticated` nominalmente; revogar de PUBLIC não basta.
- Views novas ou recriadas: `ALTER VIEW ... SET (security_invoker = true)` logo depois do `CREATE OR REPLACE`.
- Migrações são aplicadas **direto no banco** (padrão da casa; `deploy.yml` não roda `db push`). O servidor MCP barra `DROP`/`DELETE` literais: nada disso nas migrações desta entrega.
- Baseline de tipos do app: `npx tsc --noEmit -p tsconfig.app.json` tem de continuar em **65 erros** (queda grande = falha de parse). `npm run build` limpo. Testes do worker: 243 passam, 24 falham só por falta do Chromium no container.
- `useJsApiLoader` tem de receber `libraries: ['places']` (as outras telas recebem; opções diferentes na mesma sessão são rejeitadas pela biblioteca).
- Cores do semáforo não mudam: `#1F7A3D` / `#F5A800` / `#F0523F` / `#8A8A96`. Cor nunca sozinha: forma por estado nos pontos, traço por estado nas linhas.
- Identificadores em português, comentários explicam o PORQUÊ com o número medido. Nada de "TODO".
- Segredos: nenhum. A chave do Maps já vem de `VITE_GOOGLE_MAPS_API_KEY`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261013170000_rede_mapa_v2.sql` (criar) | pg_trgm + índices; níveis 3 e 4 de célula; contagens por alimentador; `geom_wkt` no staging e promoção com traçado; views/funções GeoJSON; `rede_no_mapa_v2`, `rede_buscar`, `rede_alimentador_detalhe`; privilégios |
| `worker/ludmilla/src/bdgd/extrair.ts` (alterar) | `sqlTracadoAlimentadores()` e o CSV `tracado-alim.csv` |
| `worker/ludmilla/src/bdgd/carregar.ts` (alterar) | `wktDeLinhas`, `montarAlimentadores` (puros, testáveis) |
| `worker/ludmilla/src/bdgd/index.ts` (alterar) | usa `montarAlimentadores`; lotes de 100 para alimentadores |
| `worker/ludmilla/test/extrair.test.ts`, `test/carregar.test.ts` (alterar) | testes do SQL e da montagem |
| `src/pages/painel/rede/tipos.ts` (criar) | contratos da RPC v2 |
| `src/pages/painel/rede/formato.ts` + `.test.ts` (criar) | kW/kVA/%, idade do dado |
| `src/pages/painel/rede/zoom.ts` + `.test.ts` (criar) | nível por zoom, caixa de consulta com folga, "a vista saiu da caixa?" |
| `src/pages/painel/rede/estilos.ts` + `.test.ts` (criar) | símbolos e estilos por estado/camada/satélite (puros, sem `google.*`) |
| `src/pages/painel/rede/busca.ts` + `.test.ts` (criar) | termo, sugestões, mescla Places × rede |
| `src/pages/painel/rede/consultas.ts` (criar) | hooks React Query: `useRedeNoMapa`, `useBuscaRede`, `useDetalheAlimentador` |
| `src/pages/painel/rede/useCamadaVetorial.ts` (criar) | o `google.maps.Data` imperativo: addGeoJson/setStyle/listeners uma vez |
| `src/pages/painel/rede/Busca.tsx` (criar) | combobox acessível: Places + rede |
| `src/pages/painel/rede/PainelLateral.tsx` (criar) | resumo, listas contextuais, detalhe de trafo e de alimentador |
| `src/pages/painel/rede/Legenda.tsx` (criar) | legenda com forma + cor + limiares reais |
| `src/pages/painel/NetworkSection.tsx` (reescrever) | layout tela cheia e orquestração |
| `docs/modules/engineering/overview.md`, spec §11, `CLAUDE.md` (alterar) | documentação |

---

### Task 1: Banco — níveis de célula, traçado, GeoJSON, busca e detalhe

**Files:**
- Create: `supabase/migrations/20261013170000_rede_mapa_v2.sql`

**Interfaces:**
- Consumes: `rede_regras()`, `rede_margem()`, `rede_base_atual()`, `is_master()`, tabelas `rede_*`, views `rede_ponto_no_mapa`/`rede_celula_no_mapa` (migração `20261012130000`).
- Produces: `rede_no_mapa_v2(p_oeste NUMERIC, p_sul NUMERIC, p_leste NUMERIC, p_norte NUMERIC, p_zoom INT, p_so_risco BOOL, p_camadas TEXT[]) → JSONB` (contrato em spec §11.3); `rede_buscar(p_texto TEXT, p_limite INT) → JSONB[]`; `rede_alimentador_detalhe(p_id BIGINT) → JSONB`; coluna `rede_stg_alimentador.geom_wkt TEXT`; colunas `rede_alimentador.trafos*`.

- [ ] **Step 1: Escrever a migração**

```sql
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
```

- [ ] **Step 2: Aplicar** via MCP `apply_migration` (nome `rede_mapa_v2`). Se engasgar por tamanho, aplicar em blocos na ordem do arquivo (extensão+índices · células · alimentador · staging/promoção · views · funções · permissões).

- [ ] **Step 3: Recalcular células e contagens** (sem RPC de entrada, que exige `auth`):

```sql
select public.rede_celula_limpar(); select public.rede_celula_inserir();
select public.rede_contar_trafos_alimentador();
select nivel, count(*) from public.rede_celula_agregada group by 1 order by 1;
select count(*) filter (where trafos > 0) com_trafos, sum(trafos) soma from public.rede_alimentador;
```
Esperado: 4 níveis (1 ≈ 292, 2 ≈ 3.542, 3 e 4 maiores); `soma` = 295.197 (todo trafo ativo tem alimentador, medido em 13/10).

- [ ] **Step 4: Varrer privilégios**

```sql
select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
       has_function_privilege('authenticated', p.oid, 'execute') auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'rede\_%' order by 1;
select table_name, has_table_privilege('anon', 'public.'||table_name, 'select') anon,
       has_table_privilege('authenticated', 'public.'||table_name, 'select') auth
  from information_schema.views where table_schema = 'public' and table_name like 'rede\_%';
```
Esperado: `anon` falso em tudo; `auth` verdadeiro **só** em `rede_no_mapa`, `rede_no_mapa_v2`, `rede_buscar`, `rede_alimentador_detalhe`; views todas falso.

- [ ] **Step 5: Medir a RPC** chamando as internas como postgres (a entrada exige master):

```sql
explain (analyze, timing off, summary) select public.rede_mapa_celulas_v2(ST_MakeEnvelope(-47.15,-22.98,-46.98,-22.83,4326), 3::smallint, false);
explain (analyze, timing off, summary) select public.rede_mapa_pontos_v2(ST_MakeEnvelope(-47.08,-22.92,-47.04,-22.895,4326), false, 4000);
explain (analyze, timing off, summary) select public.rede_mapa_resumo(ST_MakeEnvelope(-47.15,-22.98,-46.98,-22.83,4326), 3::smallint);
select length(public.rede_mapa_pontos_v2(ST_MakeEnvelope(-47.08,-22.92,-47.04,-22.895,4326), false, 4000)::text) bytes_z14;
```
Registrar os números na seção "Decisões medidas" deste plano. Alvo: < 300 ms cada.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261013170000_rede_mapa_v2.sql
git commit -m "feat(rede): mapa v2 no banco — níveis 3 e 4 de célula, traçado, GeoJSON, busca e detalhe"
```

---

### Task 2: Worker — traçado dos alimentadores na ingestão

**Files:**
- Modify: `worker/ludmilla/src/bdgd/extrair.ts`, `worker/ludmilla/src/bdgd/carregar.ts`, `worker/ludmilla/src/bdgd/index.ts`
- Test: `worker/ludmilla/test/extrair.test.ts`, `worker/ludmilla/test/carregar.test.ts`

**Interfaces:**
- Produces: `sqlTracadoAlimentadores(): string`; `extrair()` passa a devolver também `tracado: string` (caminho do CSV com colunas `alimentador,wkt`); `wktDeLinhas(wkt?: string): string | null`; `montarAlimentadores(alims, cargaAlim, gdAlim, tracado): LinhaAlimentador[]` com `geom_wkt`.

- [ ] **Step 1: Testes vermelhos** — acrescentar a `test/extrair.test.ts`:

```ts
import { sqlTracadoAlimentadores, TOLERANCIA_TRACADO } from '../src/bdgd/extrair.js';

// 13/10/2026, Piratininga: 396.983 trechos da SSDMT -> 550 linhas, 3,3 s, 5,4 MB.
// ST_LineMerge ANTES do simplify e obrigatorio: cada trecho tem 2 pontos, e
// sem o merge o simplify nao tira nada (8.582 -> 8.582; com merge, -> 2.210).
test('o tracado agrega a SSDMT por alimentador com LineMerge antes do Simplify', () => {
  const sql = sqlTracadoAlimentadores();
  assert.ok(/ST_SimplifyPreserveTopology\(\s*ST_LineMerge\(\s*ST_Collect\(\s*SHAPE\s*\)\s*\)/i.test(sql), sql);
  assert.ok(sql.includes('FROM SSDMT'));
  assert.ok(sql.includes('GROUP BY CTMT'));
  assert.ok(/ST_AsText\(/.test(sql), 'a geometria vem no SELECT, como nos trafos');
  assert.ok(!/\bJOIN\b/i.test(sql));
  assert.equal(TOLERANCIA_TRACADO, 0.00005);
});
```

E a `test/carregar.test.ts`:

```ts
import { wktDeLinhas, montarAlimentadores } from '../src/bdgd/carregar.js';

test('wktDeLinhas aceita LINESTRING e MULTILINESTRING e rejeita o resto', () => {
  assert.equal(wktDeLinhas(' MULTILINESTRING((-47.7 -23.2, -47.8 -23.3)) '), 'MULTILINESTRING((-47.7 -23.2, -47.8 -23.3))');
  assert.equal(wktDeLinhas('LINESTRING(-47.7 -23.2, -47.8 -23.3)'), 'LINESTRING(-47.7 -23.2, -47.8 -23.3)');
  assert.equal(wktDeLinhas('POINT(1 2)'), null);
  assert.equal(wktDeLinhas(''), null);
  assert.equal(wktDeLinhas(undefined), null);
});

test('montarAlimentadores junta carga, GD e tracado pelo codigo', () => {
  const saida = montarAlimentadores(
    [{ COD_ID: 'TAQ06', NOME: 'Taquaral 6', SUB: 'SE1' }, { COD_ID: 'BBS12', NOME: '', SUB: '' }],
    [{ alimentador: 'TAQ06', carga_min_diurna_kw: '1234.567' }],
    [{ alimentador: 'TAQ06', gd_kw: '99.999' }],
    [{ alimentador: 'TAQ06', wkt: 'MULTILINESTRING((1 2, 3 4))' }, { alimentador: 'BBS12', wkt: 'POINT(1 1)' }],
  );
  assert.equal(saida.length, 2);
  assert.deepEqual(saida[0], {
    codigo: 'TAQ06', subestacao_codigo: 'SE1', tensao_kv: null,
    carga_min_diurna_kw: 1234.57, gd_conectada_kw: 100, geom_wkt: 'MULTILINESTRING((1 2, 3 4))',
  });
  // sem carga = nulo (nao sei); sem GD = zero (sei que e zero); WKT invalido = nulo
  assert.deepEqual(saida[1], {
    codigo: 'BBS12', subestacao_codigo: null, tensao_kv: null,
    carga_min_diurna_kw: null, gd_conectada_kw: 0, geom_wkt: null,
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**: `cd worker/ludmilla && npm test 2>&1 | grep -E "not ok|# (pass|fail)"` — as novas falham por import inexistente.

- [ ] **Step 3: Implementar** em `extrair.ts` (depois de `sqlGdPorAlimentador`):

```ts
/**
 * Traçado dos alimentadores: a SSDMT (trechos de média tensão) agregada por
 * CTMT, UMA linha por alimentador. Medido na Piratininga em 13/10/2026:
 * 396.983 trechos → 550 linhas em 3,3 s, 5,4 MB (máx. 69 KB, mediana 6,4 KB).
 *
 * `ST_LineMerge` ANTES do simplify é obrigatório. Cada trecho tem 2 pontos;
 * sem o merge o simplify não remove nada (8.582 → 8.582 pontos num CTMT); com
 * o merge, 8.582 → 2.210. `PreserveTopology` para a linha não se cruzar.
 * 0,00005° ≈ 5 m: a resolução guardada; o servidor simplifica mais por zoom.
 */
export const TOLERANCIA_TRACADO = 0.00005;

export function sqlTracadoAlimentadores(): string {
  return `SELECT CTMT AS alimentador,
       ST_AsText(ST_SimplifyPreserveTopology(ST_LineMerge(ST_Collect(SHAPE)), ${TOLERANCIA_TRACADO})) AS wkt
  FROM SSDMT
 WHERE CTMT <> ''
 GROUP BY CTMT`;
}
```

Em `extrair()`: tipo de retorno ganha `tracado: string`; antes do `return`:

```ts
  // 3,3 s na Piratininga (396.983 trechos -> 550 alimentadores, 5,4 MB).
  const tracado = await paraCsv(gdb, join(dir, 'tracado-alim.csv'), sqlTracadoAlimentadores());

  return { trafos, carga, gd, alimentadores, cargaAlim, gdAlim, subestacoes, tracado };
```

Em `carregar.ts` (depois de `montarTrafos`):

```ts
export interface LinhaAlimentador {
  codigo: string;
  subestacao_codigo: string | null;
  tensao_kv: null;                  // TEN_NOM e codigo de dominio, nao kV
  carga_min_diurna_kw: number | null;
  gd_conectada_kw: number;
  geom_wkt: string | null;
}

/** Só linhas entram em `rede_alimentador.geom` (MultiLineString); o resto vira nulo. */
export function wktDeLinhas(wkt: string | undefined): string | null {
  const w = (wkt ?? '').trim();
  return /^(MULTI)?LINESTRING\s*\(/i.test(w) ? w : null;
}

export function montarAlimentadores(
  alims: Record<string, string>[],
  cargaAlim: Record<string, string>[],
  gdAlim: Record<string, string>[],
  tracado: Record<string, string>[],
): LinhaAlimentador[] {
  const porCarga = new Map(cargaAlim.map(c => [c.alimentador, num(c.carga_min_diurna_kw)]));
  const porGd = new Map(gdAlim.map(g => [g.alimentador, num(g.gd_kw)]));
  const porWkt = new Map(tracado.map(t => [t.alimentador, wktDeLinhas(t.wkt)]));
  const saida = alims.map(a => ({
    codigo: a.COD_ID,
    subestacao_codigo: a.SUB || null,
    tensao_kv: null as null,
    carga_min_diurna_kw: duasCasas(porCarga.get(a.COD_ID) ?? null),
    // GD ausente E zero de verdade: ninguem conectou nada neste alimentador.
    gd_conectada_kw: duasCasas(porGd.get(a.COD_ID) ?? 0) ?? 0,
    geom_wkt: porWkt.get(a.COD_ID) ?? null,
  }));
  const semTracado = saida.filter(s => s.geom_wkt === null).length;
  if (semTracado > 0) console.warn(`[bdgd] ${semTracado} de ${saida.length} alimentadores sem tracado na SSDMT`);
  return saida;
}
```

Em `index.ts`: importar `montarAlimentadores`; trocar o bloco `cargaPorAlim`/`gdPorAlim`/`n2`/`alims` por:

```ts
    const alims = montarAlimentadores(
      lerCsv(await readFile(csv.alimentadores, 'utf8')),
      lerCsv(await readFile(csv.cargaAlim, 'utf8')),
      lerCsv(await readFile(csv.gdAlim, 'utf8')),
      lerCsv(await readFile(csv.tracado, 'utf8')),
    ).map(a => ({ importacao_id: imp.id, ...a }));
```

e o envio: `await enviarEmLotes('rede_stg_alimentador', alims, 100);` — com o WKT (mediana 6 KB, máx. 69 KB) 100 linhas são ~1 MB por requisição.

- [ ] **Step 4: Rodar**: `npm test` → as novas passam; total 243 + 3 passando, 24 falhando (Chromium). `npm run build` limpo.

- [ ] **Step 5: Commit**

```bash
git add worker/ludmilla/src/bdgd worker/ludmilla/test
git commit -m "feat(bdgd): traçado dos alimentadores — SSDMT agregada por CTMT no ogr2ogr"
```

---

### Task 3: Front — módulos puros (tipos, formato, zoom, estilos, busca)

**Files:**
- Create: `src/pages/painel/rede/tipos.ts`, `formato.ts`, `formato.test.ts`, `zoom.ts`, `zoom.test.ts`, `estilos.ts`, `estilos.test.ts`, `busca.ts`, `busca.test.ts`

**Interfaces (Produces):**
- `tipos.ts`: `Risco`, `Camada`, `RespostaMapa`, `Colecao<P>`, `PropsPonto`, `PropsCelula`, `PropsAlimentador`, `PropsSubestacao`, `ResultadoBusca`, `DetalheAlimentador`, `Regras`.
- `formato.ts`: `kw`, `kva`, `pct`, `inteiro`, `mesesDesde(iso, agora?)`, `rotuloIdade(meses)`, `percentualDe(parte, total)`.
- `zoom.ts`: `ZOOM_PONTOS = 14`, `nivelPorZoom(z)`, `Caixa`, `caixaDeConsulta(vista, folga=0.2)`, `contemCaixa(externa, interna)`, `chaveDaCaixa(c)`.
- `estilos.ts`: `CORES`, `ROTULOS`, `ORDEM`, `descricaoDe(risco, regras)`, `Simbolo`, `simboloPonto`, `estiloPonto`, `estiloCelula`, `estiloAlimentador`, `estiloContornoAlimentador`, `simboloSubestacao`, `estiloSubestacao`, `COR_SUBESTACAO`.
- `busca.ts`: `Sugestao`, `SugestaoLugar`, `SugestaoRede`, `prepararTermo`, `sugestoesDaRede`, `mesclarSugestoes`.

- [ ] **Step 1: `tipos.ts`**

```ts
/** Contratos da RPC `rede_no_mapa_v2` e companheiras (spec §11.3). */
export type Risco = 'folga' | 'atencao' | 'risco' | 'sem_dado';
export type Camada = 'pontos' | 'alimentadores' | 'subestacoes';

export interface Base { distribuidora?: string; sigla?: string; data_base?: string | null; importado_em?: string | null }
export interface Regras { fator: number; atencao: number; risco: number }
export interface Resumo { total: number; risco: number; atencao: number; folga: number; sem_dado: number }

export interface PropsPonto {
  id: number; codigo: string; risco: Risco; lng: number; lat: number;
  potencia_nominal_kva: number | null; carga_min_diurna_kw: number | null;
  gd_conectada_kw: number | null; margem_kw: number | null; ocupacao_pct: number | null;
  alimentador: string | null; alimentador_id: number | null; subestacao: string | null;
}
export interface PropsCelula {
  id: number; nivel: number; risco: Risco; trafos: number; trafos_risco: number;
  trafos_atencao: number; trafos_folga: number; trafos_sem_dado: number;
  oeste: number; sul: number; leste: number; norte: number;
}
export interface PropsAlimentador {
  id: number; codigo: string; risco: Risco; ocupacao_pct: number | null;
  carga_min_diurna_kw: number | null; gd_conectada_kw: number | null;
  trafos: number; trafos_risco: number; subestacao: string | null;
  oeste: number; sul: number; leste: number; norte: number;
}
export interface PropsSubestacao {
  id: number; codigo: string; nome: string | null; lng: number; lat: number;
  alimentadores: number; alimentadores_risco: number;
}

export interface Feicao<P> { type: 'Feature'; id: number; geometry: unknown; properties: P }
export interface Colecao<P> { type: 'FeatureCollection'; features: Feicao<P>[] }

export interface RespostaMapa {
  base: Base; regras: Regras; zoom: number;
  camada: 'celula' | 'ponto'; nivel: number | null; resumo: Resumo;
  pontos: Colecao<PropsPonto> | null; celulas: Colecao<PropsCelula> | null;
  alimentadores: Colecao<PropsAlimentador> | null; subestacoes: Colecao<PropsSubestacao> | null;
  teto: number; excedeu: boolean;
}

export interface ResultadoBusca {
  tipo: 'subestacao' | 'alimentador' | 'trafo'; id: number; codigo: string; nome: string | null;
  risco: Risco | null; lng: number | null; lat: number | null;
  oeste: number | null; sul: number | null; leste: number | null; norte: number | null;
}

export interface DetalheAlimentador {
  id: number; codigo: string; risco: Risco; ocupacao_pct: number | null;
  carga_min_diurna_kw: number | null; gd_conectada_kw: number | null; margem_kw: number | null;
  trafos: number; trafos_risco: number; trafos_atencao: number; trafos_folga: number; trafos_sem_dado: number;
  subestacao: string | null; distribuidora: string | null; tem_tracado: boolean;
  oeste: number | null; sul: number | null; leste: number | null; norte: number | null;
}

/** O que está aberto na gaveta lateral. */
export type Selecao =
  | { tipo: 'trafo'; props: PropsPonto }
  | { tipo: 'alimentador'; id: number; props?: PropsAlimentador }
  | null;
```

- [ ] **Step 2: Testes de `formato`, `zoom`, `estilos`, `busca`** (vitest, `src/pages/painel/rede/*.test.ts`)

```ts
// formato.test.ts
import { describe, it, expect } from 'vitest';
import { kw, kva, pct, inteiro, mesesDesde, rotuloIdade, percentualDe } from './formato';

describe('formato', () => {
  it('kW com 1 casa abaixo de 100 e inteiro acima', () => {
    expect(kw(28)).toBe('28,0 kW'); expect(kw(1234.5)).toBe('1.235 kW'); expect(kw(null)).toBe('—');
  });
  it('kVA e % inteiros; % sem dado em texto', () => {
    expect(kva(75)).toBe('75 kVA'); expect(pct(187.4)).toBe('187%'); expect(pct(null)).toBe('sem dado');
    expect(inteiro(242226)).toBe('242.226');
  });
  it('idade do dado em meses, com rótulo humano', () => {
    const agora = Date.UTC(2026, 9, 13);
    expect(mesesDesde('2025-12-31', agora)).toBe(9);
    expect(rotuloIdade(0)).toBe('deste mês'); expect(rotuloIdade(1)).toBe('1 mês atrás');
    expect(rotuloIdade(9)).toBe('9 meses atrás'); expect(rotuloIdade(26)).toBe('2 anos atrás');
  });
  it('percentual arredondado e seguro com total zero', () => {
    expect(percentualDe(37, 212)).toBe(17); expect(percentualDe(1, 0)).toBe(0);
  });
});
```

```ts
// zoom.test.ts
import { describe, it, expect } from 'vitest';
import { nivelPorZoom, caixaDeConsulta, contemCaixa, chaveDaCaixa, ZOOM_PONTOS } from './zoom';

describe('zoom', () => {
  it('espelha rede_nivel_celula do banco', () => {
    expect(nivelPorZoom(5)).toBe(1); expect(nivelPorZoom(8)).toBe(1);
    expect(nivelPorZoom(9)).toBe(2); expect(nivelPorZoom(10)).toBe(2);
    expect(nivelPorZoom(11)).toBe(3); expect(nivelPorZoom(12)).toBe(3);
    expect(nivelPorZoom(13)).toBe(4);
    expect(nivelPorZoom(14)).toBeNull(); expect(ZOOM_PONTOS).toBe(14);
  });
  it('a caixa de consulta é 20% maior que a vista em cada lado', () => {
    const c = caixaDeConsulta({ oeste: -47.1, sul: -23.0, leste: -47.0, norte: -22.9 });
    expect(c.oeste).toBeCloseTo(-47.12); expect(c.leste).toBeCloseTo(-46.98);
    expect(c.sul).toBeCloseTo(-23.02); expect(c.norte).toBeCloseTo(-22.88);
  });
  it('só reconsulta quando a vista sai da caixa já carregada', () => {
    const carregada = { oeste: -47.12, sul: -23.02, leste: -46.98, norte: -22.88 };
    expect(contemCaixa(carregada, { oeste: -47.11, sul: -23.01, leste: -46.99, norte: -22.89 })).toBe(true);
    expect(contemCaixa(carregada, { oeste: -47.13, sul: -23.01, leste: -47.0, norte: -22.89 })).toBe(false);
  });
  it('a chave arredonda a 4 casas', () => {
    expect(chaveDaCaixa({ oeste: -47.123456, sul: -23, leste: -46.9, norte: -22.8 })).toBe('-47.1235,-23.0000,-46.9000,-22.8000');
  });
});
```

```ts
// estilos.test.ts
import { describe, it, expect } from 'vitest';
import { simboloPonto, estiloCelula, estiloAlimentador, estiloContornoAlimentador, simboloSubestacao, descricaoDe, CORES } from './estilos';

describe('estilos — cor nunca sozinha', () => {
  it('cada estado tem uma forma própria', () => {
    const f = ['folga', 'atencao', 'risco', 'sem_dado'].map(r => simboloPonto(r as never, false).path);
    expect(new Set(f).size).toBe(3);                // círculo (folga e atenção), triângulo, quadrado
    expect(simboloPonto('atencao', false).fillOpacity).toBe(0);   // anel vazado no mapa liso
    expect(simboloPonto('atencao', true).fillOpacity).toBeGreaterThan(0.8); // miolo opaco no satélite
  });
  it('sobre satélite o contorno é escuro e a marca maior', () => {
    expect(simboloPonto('folga', true).strokeColor).toBe('#07070B');
    expect(simboloPonto('folga', true).scale).toBeGreaterThan(simboloPonto('folga', false).scale);
  });
  it('destaque engrossa e sobe', () => {
    expect(simboloPonto('risco', false, true).strokeWeight).toBeGreaterThan(simboloPonto('risco', false).strokeWeight);
    expect(estiloAlimentador('risco', 14, false, true).zIndex).toBeGreaterThan(estiloAlimentador('risco', 14, false).zIndex);
  });
  it('alimentador: traço por estado além da cor, e mais grosso ao aproximar', () => {
    const r = estiloAlimentador('risco', 14, false), f = estiloAlimentador('folga', 14, false);
    expect(r.strokeWeight).toBeGreaterThan(f.strokeWeight);
    expect(r.strokeOpacity).toBeGreaterThan(f.strokeOpacity);
    expect(estiloAlimentador('risco', 8, false).strokeWeight).toBeLessThan(r.strokeWeight);
    expect(estiloContornoAlimentador(14).strokeWeight).toBeGreaterThan(r.strokeWeight);
    expect(estiloContornoAlimentador(14).clickable).toBe(false);
  });
  it('célula: miolo mais fraco e borda mais forte sobre satélite', () => {
    expect(estiloCelula('risco', 3, true).fillOpacity).toBeLessThan(estiloCelula('risco', 3, false).fillOpacity);
    expect(estiloCelula('risco', 3, true).strokeWeight).toBeGreaterThan(estiloCelula('risco', 3, false).strokeWeight);
    expect(estiloCelula('risco', 3, false).fillColor).toBe(CORES.risco);
  });
  it('subestação é losango, cor fora do semáforo', () => {
    expect(simboloSubestacao(false).path).toMatch(/^M 0 -8 L 8 0/);
    expect(Object.values(CORES)).not.toContain(simboloSubestacao(false).fillColor);
  });
  it('a legenda usa os limiares reais', () => {
    expect(descricaoDe('atencao', { fator: 0.8, atencao: 60, risco: 100 })).toBe('entre 60% e 100% da margem');
    expect(descricaoDe('folga', { fator: 0.8, atencao: 60, risco: 100 })).toBe('abaixo de 60% da margem');
  });
});
```

```ts
// busca.test.ts
import { describe, it, expect } from 'vitest';
import { prepararTermo, sugestoesDaRede, mesclarSugestoes } from './busca';

const sub = { tipo: 'subestacao', id: 1, codigo: 'SE1', nome: 'CAMPINAS CENTRO', risco: null, lng: -47, lat: -22, oeste: null, sul: null, leste: null, norte: null } as const;
const alim = { tipo: 'alimentador', id: 2, codigo: 'TAQ06', nome: 'TAQUARAL', risco: 'risco', lng: null, lat: null, oeste: -47.1, sul: -23, leste: -47, norte: -22.9 } as const;
const trafo = { tipo: 'trafo', id: 3, codigo: '34104122', nome: 'TAQ06', risco: 'folga', lng: -47, lat: -22, oeste: null, sul: null, leste: null, norte: null } as const;

describe('busca', () => {
  it('termo: apara, exige 2 caracteres, corta em 60', () => {
    expect(prepararTermo('  ca ')).toBe('ca'); expect(prepararTermo(' c ')).toBeNull();
    expect(prepararTermo('x'.repeat(80))?.length).toBe(60);
  });
  it('sugestões da rede ganham título e subtítulo legíveis', () => {
    const s = sugestoesDaRede([sub, alim, trafo]);
    expect(s[0]).toMatchObject({ tipo: 'subestacao', titulo: 'SE Campinas Centro', subtitulo: 'Subestação · SE1' });
    expect(s[1]).toMatchObject({ tipo: 'alimentador', titulo: 'Alimentador TAQ06', subtitulo: 'SE Taquaral · Risco' });
    expect(s[2]).toMatchObject({ tipo: 'trafo', titulo: 'Trafo 34104122', subtitulo: 'Alimentador TAQ06 · Sem risco aparente' });
  });
  it('com dígito no termo a rede vem antes; sem dígito, os lugares', () => {
    const lugar = { tipo: 'lugar', id: 'p1', titulo: 'Campinas', subtitulo: 'SP, Brasil' } as const;
    const rede = sugestoesDaRede([trafo]);
    expect(mesclarSugestoes('341', rede, [lugar])[0].tipo).toBe('trafo');
    expect(mesclarSugestoes('camp', rede, [lugar])[0].tipo).toBe('lugar');
  });
  it('no máximo 8, sem derrubar um tipo inteiro', () => {
    const muitos = sugestoesDaRede(Array.from({ length: 12 }, (_, i) => ({ ...trafo, id: i, codigo: String(i) })));
    const lugares = Array.from({ length: 6 }, (_, i) => ({ tipo: 'lugar', id: `p${i}`, titulo: `L${i}`, subtitulo: '' } as const));
    const m = mesclarSugestoes('1', muitos, lugares);
    expect(m.length).toBe(8);
    expect(m.filter(x => x.tipo === 'lugar').length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**: `npx vitest run src/pages/painel/rede` → falham por módulo inexistente.

- [ ] **Step 4: Implementar `formato.ts`**

```ts
const fmt = (casas: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const kw  = (v: number | null | undefined) => v == null ? '—' : `${fmt(Math.abs(v) >= 100 ? 0 : 1).format(v)} kW`;
export const kva = (v: number | null | undefined) => v == null ? '—' : `${fmt(0).format(v)} kVA`;
export const pct = (v: number | null | undefined) => v == null ? 'sem dado' : `${fmt(0).format(v)}%`;
export const inteiro = (n: number) => fmt(0).format(n);

export function mesesDesde(iso: string, agora = Date.now()): number {
  const meses = (agora - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30.4);
  return Math.max(0, Math.round(meses));
}

export function rotuloIdade(meses: number): string {
  if (meses <= 0) return 'deste mês';
  if (meses === 1) return '1 mês atrás';
  if (meses < 24) return `${meses} meses atrás`;
  return `${Math.floor(meses / 12)} anos atrás`;
}

export const percentualDe = (parte: number, total: number) =>
  total > 0 ? Math.round((parte / total) * 100) : 0;
```

- [ ] **Step 5: Implementar `zoom.ts`**

```ts
/**
 * Espelho de `rede_nivel_celula()` do banco. Quem decide a camada é a RPC;
 * a tela só precisa saber ANTES da resposta se vai mostrar células ou pontos
 * (para o rótulo da lista e para escolher o que destacar).
 */
export const ZOOM_PONTOS = 14;

export function nivelPorZoom(zoom: number): 1 | 2 | 3 | 4 | null {
  if (zoom < 9) return 1;
  if (zoom < 11) return 2;
  if (zoom < 13) return 3;
  if (zoom < ZOOM_PONTOS) return 4;
  return null;
}

export interface Caixa { oeste: number; sul: number; leste: number; norte: number }

/**
 * Consulta uma caixa 20% maior que a vista em cada lado e só volta ao servidor
 * quando a vista SAI dela (ou o zoom muda). A v1 arredondava a caixa a 2 casas
 * na chave do cache: arrastar 500 m reaproveitava dado que não cobria a área.
 */
export function caixaDeConsulta(vista: Caixa, folga = 0.2): Caixa {
  const dx = (vista.leste - vista.oeste) * folga;
  const dy = (vista.norte - vista.sul) * folga;
  return {
    oeste: Math.max(-180, vista.oeste - dx), sul: Math.max(-90, vista.sul - dy),
    leste: Math.min(180, vista.leste + dx),  norte: Math.min(90, vista.norte + dy),
  };
}

export const contemCaixa = (externa: Caixa, interna: Caixa) =>
  interna.oeste >= externa.oeste && interna.leste <= externa.leste &&
  interna.sul >= externa.sul && interna.norte <= externa.norte;

export const chaveDaCaixa = (c: Caixa) =>
  [c.oeste, c.sul, c.leste, c.norte].map(v => v.toFixed(4)).join(',');
```

- [ ] **Step 6: Implementar `estilos.ts`** (puro: sem `google.*` em tempo de módulo — por isso os caminhos SVG em vez de `SymbolPath.CIRCLE`)

```ts
import type { Risco, Regras } from './tipos';

/**
 * Cores validadas contra daltonismo (ΔE 12,6 em protanopia) — NÃO mudam entre
 * camadas nem entre mapa liso e satélite. O que muda é miolo, contorno e
 * tamanho. Cor nunca sozinha: forma por estado nos pontos, traço nas linhas.
 */
export const CORES: Record<Risco, string> = {
  folga: '#1F7A3D', atencao: '#F5A800', risco: '#F0523F', sem_dado: '#8A8A96',
};
export const ROTULOS: Record<Risco, string> = {
  folga: 'Sem risco aparente', atencao: 'Atenção', risco: 'Risco', sem_dado: 'Sem dado',
};
export const ORDEM: Risco[] = ['risco', 'atencao', 'folga', 'sem_dado'];
export const COR_SUBESTACAO = '#8A8AF0';
const CONTORNO_ESCURO = '#07070B';
const MIOLO_ESCURO = '#0E0E14';

export function descricaoDe(risco: Risco, r: Regras): string {
  if (risco === 'folga') return `abaixo de ${r.atencao}% da margem`;
  if (risco === 'atencao') return `entre ${r.atencao}% e ${r.risco}% da margem`;
  if (risco === 'risco') return `margem esgotada (${r.risco}% ou mais)`;
  return 'sem carga ou geração na base';
}

/** Mesmo formato de `google.maps.Symbol`, sem depender do namespace carregado. */
export interface Simbolo {
  path: string; fillColor: string; fillOpacity: number;
  strokeColor: string; strokeWeight: number; scale: number;
}

// caminhos centrados em (0,0), em px no scale 1
const CIRCULO = 'M 0 -6 A 6 6 0 1 1 0 6 A 6 6 0 1 1 0 -6 Z';
const TRIANGULO = 'M 0 -8 L 7 6 L -7 6 Z';
const QUADRADO = 'M -5.5 -5.5 L 5.5 -5.5 L 5.5 5.5 L -5.5 5.5 Z';
const LOSANGO = 'M 0 -8 L 8 0 L 0 8 L -8 0 Z';

/**
 * Sobre satélite todo marcador ganha miolo opaco e contorno escuro: é o
 * contorno que separa a marca da foto (15,9:1 em telhado claro, 9,8:1 em
 * concreto; fraco só em vegetação e asfalto — medido em 13/10/2026).
 */
export function simboloPonto(risco: Risco, satelite: boolean, destaque = false): Simbolo {
  const cor = CORES[risco] ?? CORES.sem_dado;
  const s = (satelite ? 1.25 : 1) * (destaque ? 1.35 : 1);
  const contorno = satelite ? CONTORNO_ESCURO : 'rgba(255,255,255,0.45)';
  const peso = (satelite ? 2.2 : 1.6) + (destaque ? 1.4 : 0);
  if (risco === 'risco') {
    return { path: TRIANGULO, fillColor: cor, fillOpacity: 1,
             strokeColor: satelite ? CONTORNO_ESCURO : MIOLO_ESCURO,
             strokeWeight: (satelite ? 2 : 1.5) + (destaque ? 1.4 : 0), scale: s };
  }
  if (risco === 'atencao') {
    // anel: vazado no mapa liso, miolo escuro opaco sobre imagem
    return { path: CIRCULO, fillColor: MIOLO_ESCURO, fillOpacity: satelite ? 0.92 : 0,
             strokeColor: cor, strokeWeight: 4 + (destaque ? 1.4 : 0), scale: s };
  }
  if (risco === 'sem_dado') {
    // quadrado, não anel fino: espessura não se lê sobre imagem
    return { path: QUADRADO, fillColor: satelite ? cor : MIOLO_ESCURO,
             fillOpacity: satelite ? 0.85 : 0, strokeColor: satelite ? CONTORNO_ESCURO : cor,
             strokeWeight: 2 + (destaque ? 1.4 : 0), scale: s };
  }
  return { path: CIRCULO, fillColor: cor, fillOpacity: 1,
           strokeColor: contorno, strokeWeight: peso, scale: s };
}

export function estiloPonto(risco: Risco, satelite: boolean, destaque = false) {
  const z = { risco: 4, atencao: 3, sem_dado: 2, folga: 1 }[risco] ?? 1;
  return { icon: simboloPonto(risco, satelite, destaque), zIndex: destaque ? 100 : z, cursor: 'pointer' };
}

/** Sobre imagem, 0,3 de cor saturada vira barro: miolo mais fraco, borda forte. */
export function estiloCelula(risco: Risco, nivel: number, satelite: boolean) {
  const cor = risco === 'sem_dado' && !satelite ? '#3A3A48' : (CORES[risco] ?? CORES.sem_dado);
  return {
    fillColor: cor, fillOpacity: satelite ? 0.22 : (nivel >= 3 ? 0.26 : 0.3),
    strokeColor: cor, strokeOpacity: satelite ? 1 : 0.6, strokeWeight: satelite ? 2 : 1,
    clickable: true, cursor: 'zoom-in', zIndex: risco === 'risco' ? 3 : risco === 'atencao' ? 2 : 1,
  };
}

/** Traço por estado além da cor: risco grosso e contínuo, folga fino e tênue. */
export function estiloAlimentador(risco: Risco, zoom: number, satelite: boolean, destaque = false) {
  const base = zoom < 11 ? 1.5 : zoom < 14 ? 2.5 : 3.5;
  const fator = { risco: 1.3, atencao: 1.0, folga: 0.7, sem_dado: 0.6 }[risco] ?? 0.6;
  const opac  = { risco: 0.95, atencao: 0.9, folga: 0.7, sem_dado: 0.65 }[risco] ?? 0.65;
  return {
    strokeColor: CORES[risco] ?? CORES.sem_dado,
    strokeOpacity: destaque ? 1 : opac,
    strokeWeight: base * fator + (satelite ? 0.5 : 0) + (destaque ? 2.5 : 0),
    zIndex: destaque ? 90 : ({ risco: 13, atencao: 12, folga: 11, sem_dado: 10 }[risco] ?? 10),
    cursor: 'pointer',
  };
}

/** Segunda camada com as MESMAS linhas, por baixo: o contorno que as separa da foto. */
export function estiloContornoAlimentador(zoom: number) {
  const base = zoom < 11 ? 1.5 : zoom < 14 ? 2.5 : 3.5;
  return { strokeColor: CONTORNO_ESCURO, strokeOpacity: 0.85, strokeWeight: base * 1.3 + 3, zIndex: 1, clickable: false };
}

export function simboloSubestacao(satelite: boolean, destaque = false): Simbolo {
  return { path: LOSANGO, fillColor: COR_SUBESTACAO, fillOpacity: 0.95,
           strokeColor: satelite ? CONTORNO_ESCURO : MIOLO_ESCURO,
           strokeWeight: destaque ? 3.5 : 2, scale: (satelite ? 1.2 : 1) * (destaque ? 1.3 : 1) };
}
export function estiloSubestacao(satelite: boolean, destaque = false) {
  return { icon: simboloSubestacao(satelite, destaque), zIndex: destaque ? 100 : 20, cursor: 'pointer' };
}
```

- [ ] **Step 7: Implementar `busca.ts`**

```ts
import type { ResultadoBusca, Risco } from './tipos';
import { ROTULOS } from './estilos';

export const TERMO_MINIMO = 2;
export interface SugestaoLugar { tipo: 'lugar'; id: string; titulo: string; subtitulo: string }
export interface SugestaoRede {
  tipo: 'subestacao' | 'alimentador' | 'trafo'; id: number;
  titulo: string; subtitulo: string; risco: Risco | null; item: ResultadoBusca;
}
export type Sugestao = SugestaoLugar | SugestaoRede;

export function prepararTermo(t: string): string | null {
  const limpo = t.replace(/\s+/g, ' ').trim().slice(0, 60);
  return limpo.length >= TERMO_MINIMO ? limpo : null;
}

const capitalizar = (s: string) =>
  s.toLowerCase().replace(/(^|\s|-)\S/g, m => m.toUpperCase());

export function sugestoesDaRede(itens: ResultadoBusca[]): SugestaoRede[] {
  return itens.map(i => {
    const risco = i.risco ? ` · ${ROTULOS[i.risco]}` : '';
    if (i.tipo === 'subestacao') {
      return { tipo: i.tipo, id: i.id, risco: i.risco, item: i,
               titulo: `SE ${capitalizar(i.nome ?? i.codigo)}`, subtitulo: `Subestação · ${i.codigo}` };
    }
    if (i.tipo === 'alimentador') {
      return { tipo: i.tipo, id: i.id, risco: i.risco, item: i, titulo: `Alimentador ${i.codigo}`,
               subtitulo: `${i.nome ? `SE ${capitalizar(i.nome)}` : 'sem subestação'}${risco}` };
    }
    return { tipo: i.tipo, id: i.id, risco: i.risco, item: i, titulo: `Trafo ${i.codigo}`,
             subtitulo: `${i.nome ? `Alimentador ${i.nome}` : 'sem alimentador'}${risco}` };
  });
}

/**
 * Uma lista só. Código tem dígito; nome de cidade não — é o que decide quem
 * vem primeiro. Nenhum tipo é derrubado inteiro: cada um garante ao menos 2.
 */
export function mesclarSugestoes(termo: string, rede: SugestaoRede[], lugares: SugestaoLugar[], maximo = 8): Sugestao[] {
  const redePrimeiro = /\d/.test(termo);
  const [a, b]: [Sugestao[], Sugestao[]] = redePrimeiro ? [rede, lugares] : [lugares, rede];
  const minB = Math.min(2, b.length);
  const deA = a.slice(0, Math.max(0, maximo - minB));
  return [...deA, ...b.slice(0, maximo - deA.length)];
}
```

- [ ] **Step 8: Rodar**: `npx vitest run src/pages/painel/rede` → tudo verde. `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → 65.

- [ ] **Step 9: Commit**

```bash
git add src/pages/painel/rede
git commit -m "feat(rede): módulos puros do mapa v2 — tipos, formato, zoom, estilos e busca, com testes"
```

---

### Task 4: Front — consultas e a camada vetorial

**Files:**
- Create: `src/pages/painel/rede/consultas.ts`, `src/pages/painel/rede/useCamadaVetorial.ts`

**Interfaces:**
- Consumes: `tipos.ts`, `zoom.ts` (`Caixa`, `chaveDaCaixa`).
- Produces: `useRedeNoMapa({ caixa, zoom, soRisco, camadas })`, `useBuscaRede(termo)`, `useDetalheAlimentador(id)`; `useCamadaVetorial({ mapa, colecao, visivel, estilo, aoClicar?, aoPassar? }) → MutableRefObject<google.maps.Data | null>`; tipo `Alvo { id, props, latLng }`.

- [ ] **Step 1: `consultas.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Camada, DetalheAlimentador, RespostaMapa, ResultadoBusca } from './tipos';
import { chaveDaCaixa, type Caixa } from './zoom';

export function useRedeNoMapa(p: { caixa: Caixa | null; zoom: number; soRisco: boolean; camadas: Camada[] }) {
  const camadas = [...p.camadas].sort();
  return useQuery({
    queryKey: ['rede-no-mapa-v2', p.caixa ? chaveDaCaixa(p.caixa) : '-', p.zoom, p.soRisco, camadas.join('+')],
    enabled: p.caixa !== null,
    queryFn: async (): Promise<RespostaMapa> => {
      const c = p.caixa!;
      const { data, error } = await supabase.rpc('rede_no_mapa_v2' as never, {
        p_oeste: c.oeste, p_sul: c.sul, p_leste: c.leste, p_norte: c.norte,
        p_zoom: p.zoom, p_so_risco: p.soRisco, p_camadas: camadas,
      } as never);
      if (error) throw error;
      return data as RespostaMapa;
    },
    staleTime: 60_000,
    placeholderData: anterior => anterior,   // o mapa não pisca: o dado velho fica até o novo chegar
  });
}

export function useBuscaRede(termo: string | null) {
  return useQuery({
    queryKey: ['rede-buscar', termo],
    enabled: termo !== null,
    queryFn: async (): Promise<ResultadoBusca[]> => {
      const { data, error } = await supabase.rpc('rede_buscar' as never, { p_texto: termo, p_limite: 5 } as never);
      if (error) throw error;
      return (data ?? []) as ResultadoBusca[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useDetalheAlimentador(id: number | null) {
  return useQuery({
    queryKey: ['rede-alimentador', id],
    enabled: id !== null,
    queryFn: async (): Promise<DetalheAlimentador | null> => {
      const { data, error } = await supabase.rpc('rede_alimentador_detalhe' as never, { p_id: id } as never);
      if (error) throw error;
      return (data as DetalheAlimentador | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 2: `useCamadaVetorial.ts`**

```ts
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Colecao } from './tipos';

/**
 * UMA `google.maps.Data` por tipo de feição, imperativa de propósito.
 *
 * A v1 renderizava cada trafo como `<Marker>` React. A biblioteca compara
 * `icon` e `position` por identidade, a tela criava objetos novos a cada
 * render, e todo arrasto chamava setIcon+setPosition+setTitle em até 1.500
 * marcadores legados — era isso que travava. Aqui: um `addGeoJson` por
 * resposta, um `setStyle` por mudança de estilo, listeners registrados uma
 * vez (os handlers ficam em refs, para não religar nada a cada render).
 */
export interface Alvo { id: number; props: Record<string, unknown>; latLng: google.maps.LatLng | null }

const propsDe = (f: google.maps.Data.Feature) => {
  const props: Record<string, unknown> = {};
  f.forEachProperty((v, k) => { props[k] = v; });
  return props;
};

export function useCamadaVetorial(o: {
  mapa: google.maps.Map | null;
  colecao: Colecao<unknown> | null | undefined;
  visivel: boolean;
  estilo: (props: Record<string, unknown>) => google.maps.Data.StyleOptions;
  aoClicar?: (a: Alvo) => void;
  aoPassar?: (a: Alvo | null) => void;
}): MutableRefObject<google.maps.Data | null> {
  const ref = useRef<google.maps.Data | null>(null);
  const clicar = useRef(o.aoClicar); clicar.current = o.aoClicar;
  const passar = useRef(o.aoPassar); passar.current = o.aoPassar;

  useEffect(() => {
    if (!o.mapa) return;
    const camada = new google.maps.Data({ map: o.mapa });
    ref.current = camada;
    const alvo = (e: google.maps.Data.MouseEvent): Alvo =>
      ({ id: Number(e.feature.getId()), props: propsDe(e.feature), latLng: e.latLng ?? null });
    const ls = [
      camada.addListener('click', (e: google.maps.Data.MouseEvent) => clicar.current?.(alvo(e))),
      camada.addListener('mouseover', (e: google.maps.Data.MouseEvent) => passar.current?.(alvo(e))),
      camada.addListener('mouseout', () => passar.current?.(null)),
    ];
    return () => { ls.forEach(l => l.remove()); camada.setMap(null); ref.current = null; };
  }, [o.mapa]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.forEach(f => c.remove(f));
    if (o.colecao) c.addGeoJson(o.colecao as object);
  }, [o.colecao, o.mapa]);

  useEffect(() => {
    ref.current?.setStyle(f => o.estilo(propsDe(f)));
  }, [o.estilo, o.mapa]);

  useEffect(() => {
    ref.current?.setMap(o.visivel ? o.mapa : null);
  }, [o.visivel, o.mapa]);

  return ref;
}
```

- [ ] **Step 3: Tipos**: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → 65.

- [ ] **Step 4: Commit**

```bash
git add src/pages/painel/rede/consultas.ts src/pages/painel/rede/useCamadaVetorial.ts
git commit -m "feat(rede): consultas da RPC v2 e camada vetorial imperativa (google.maps.Data)"
```

---

### Task 5: Front — Busca, Legenda e PainelLateral

**Files:**
- Create: `src/pages/painel/rede/Busca.tsx`, `src/pages/painel/rede/Legenda.tsx`, `src/pages/painel/rede/PainelLateral.tsx`

**Interfaces:**
- `Busca`: `{ mapa: google.maps.Map | null; aoEscolherRede: (s: SugestaoRede) => void }`.
- `Legenda`: `{ regras: Regras | undefined; satelite: boolean; alimentadores: boolean; subestacoes: boolean }`.
- `PainelLateral`: `{ resposta: RespostaMapa | undefined; carregando: boolean; selecao: Selecao; aoSelecionar: (s: Selecao) => void; aoEnquadrar: (c: Caixa) => void; aoCentrar: (lng: number, lat: number) => void }`.

- [ ] **Step 1: `Busca.tsx`**

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import { Search, MapPin, Zap, Factory, GitBranch } from 'lucide-react';
import { useBuscaRede } from './consultas';
import { mesclarSugestoes, prepararTermo, sugestoesDaRede, type Sugestao, type SugestaoLugar, type SugestaoRede } from './busca';
import { CORES } from './estilos';

/**
 * Um campo só: Places (município, bairro, endereço) e a RPC `rede_buscar`
 * (código de trafo/alimentador, nome de subestação) em paralelo, numa lista
 * única navegável por teclado. Escolher um lugar enquadra a vista; escolher
 * um item da rede enquadra E abre o detalhe (quem chama decide como).
 */
export function Busca({ mapa, aoEscolherRede }: { mapa: google.maps.Map | null; aoEscolherRede: (s: SugestaoRede) => void }) {
  const [texto, setTexto] = useState('');
  const [termo, setTermo] = useState<string | null>(null);
  const [lugares, setLugares] = useState<SugestaoLugar[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const id = useId();
  const servico = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessao = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // 250 ms de debounce: digitar "Campinas" não pode disparar 8 consultas
  useEffect(() => {
    const t = setTimeout(() => setTermo(prepararTermo(texto)), 250);
    return () => clearTimeout(t);
  }, [texto]);

  const rede = useBuscaRede(termo);

  useEffect(() => {
    if (!termo || !window.google?.maps?.places) { setLugares([]); return; }
    servico.current ??= new google.maps.places.AutocompleteService();
    sessao.current ??= new google.maps.places.AutocompleteSessionToken();
    let vivo = true;
    servico.current.getPlacePredictions({
      input: termo, sessionToken: sessao.current,
      componentRestrictions: { country: 'br' },
      locationBias: mapa?.getBounds() ?? undefined,
    }, (preds) => {
      if (!vivo) return;
      setLugares((preds ?? []).slice(0, 5).map(p => ({
        tipo: 'lugar', id: p.place_id,
        titulo: p.structured_formatting.main_text, subtitulo: p.structured_formatting.secondary_text ?? '',
      })));
    });
    return () => { vivo = false; };
  }, [termo, mapa]);

  const sugestoes: Sugestao[] = termo
    ? mesclarSugestoes(termo, sugestoesDaRede(rede.data ?? []), lugares) : [];
  const mostrar = aberto && termo !== null && (sugestoes.length > 0 || rede.isFetching);

  const escolher = (s: Sugestao) => {
    setAberto(false);
    setTexto(s.titulo);
    if (s.tipo === 'lugar') {
      if (!mapa) return;
      new google.maps.Geocoder().geocode({ placeId: s.id }, (res, st) => {
        const g = res?.[0]?.geometry;
        if (st !== 'OK' || !g) return;
        if (g.viewport) mapa.fitBounds(g.viewport); else { mapa.setCenter(g.location); mapa.setZoom(15); }
      });
      sessao.current = null;   // a sessão do Places fecha na escolha
      return;
    }
    aoEscolherRede(s);
  };

  const teclado = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo(a => Math.min(a + 1, sugestoes.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && mostrar && sugestoes[ativo]) { e.preventDefault(); escolher(sugestoes[ativo]); }
    else if (e.key === 'Escape') setAberto(false);
  };

  const Icone = ({ s }: { s: Sugestao }) => {
    const cor = s.tipo !== 'lugar' && s.risco ? CORES[s.risco] : '#9A9AA8';
    if (s.tipo === 'lugar') return <MapPin size={14} style={{ color: '#9A9AA8' }} />;
    if (s.tipo === 'subestacao') return <Factory size={14} style={{ color: '#8A8AF0' }} />;
    if (s.tipo === 'alimentador') return <GitBranch size={14} style={{ color: cor }} />;
    return <Zap size={14} style={{ color: cor }} />;
  };

  return (
    <div style={{ position: 'relative', width: 'min(360px, 100%)' }}>
      <label htmlFor={`${id}-busca`} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Buscar município, endereço, trafo, alimentador ou subestação
      </label>
      <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: '#6B6B78', pointerEvents: 'none' }} />
      <input id={`${id}-busca`} type="search" role="combobox" aria-expanded={mostrar} autoComplete="off"
             aria-controls={`${id}-lista`} aria-activedescendant={mostrar ? `${id}-op-${ativo}` : undefined}
             value={texto} placeholder="Município, endereço, trafo, alimentador ou SE"
             onChange={e => { setTexto(e.target.value); setAberto(true); setAtivo(0); }}
             onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 120)}
             onKeyDown={teclado}
             style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 9, boxSizing: 'border-box',
                      border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(14,14,20,0.92)',
                      color: '#fff', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
      {mostrar && (
        <ul id={`${id}-lista`} role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: 40,
              margin: 0, padding: 4, listStyle: 'none', background: 'rgba(14,14,20,0.97)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
          {sugestoes.length === 0 && (
            <li style={{ padding: '9px 10px', fontSize: 12, color: '#8A8A96' }}>Procurando…</li>
          )}
          {sugestoes.map((s, i) => (
            <li key={`${s.tipo}-${s.id}`} id={`${id}-op-${i}`} role="option" aria-selected={i === ativo}
                onMouseDown={e => { e.preventDefault(); escolher(s); }} onMouseEnter={() => setAtivo(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 7,
                         cursor: 'pointer', background: i === ativo ? 'rgba(245,168,0,0.14)' : 'transparent' }}>
              <Icone s={s} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, color: '#fff', fontWeight: 600,
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.titulo}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: '#8A8A96' }}>{s.subtitulo}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `Legenda.tsx`**

```tsx
import { CORES, COR_SUBESTACAO, ORDEM, ROTULOS, descricaoDe } from './estilos';
import type { Regras, Risco } from './tipos';

const Forma = ({ risco, satelite }: { risco: Risco; satelite: boolean }) => {
  const cor = CORES[risco];
  if (risco === 'risco') return <span style={{ width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: `12px solid ${cor}` }} />;
  if (risco === 'atencao') return <span style={{ width: 13, height: 13, borderRadius: 7, border: `4px solid ${cor}`, background: satelite ? '#0E0E14' : 'transparent', boxSizing: 'border-box' }} />;
  if (risco === 'sem_dado') return <span style={{ width: 12, height: 12, background: satelite ? cor : 'transparent', border: `2px solid ${cor}`, boxSizing: 'border-box' }} />;
  return <span style={{ width: 12, height: 12, borderRadius: 6, background: cor, border: `1.6px solid ${satelite ? '#07070B' : 'rgba(255,255,255,0.45)'}`, boxSizing: 'border-box' }} />;
};

/** Forma + cor + o limiar REAL (lido de rede_regras pela RPC), nunca cor sozinha. */
export function Legenda({ regras, satelite, alimentadores, subestacoes }:
  { regras: Regras | undefined; satelite: boolean; alimentadores: boolean; subestacoes: boolean }) {
  return (
    <div aria-label="Legenda" style={{ background: 'rgba(14,14,20,0.92)', border: '1px solid rgba(255,255,255,0.1)',
                                       borderRadius: 11, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
        Risco de inversão de fluxo
      </p>
      {ORDEM.map(r => (
        <span key={r} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}><Forma risco={r} satelite={satelite} /></span>
          <span>{ROTULOS[r]}{regras && <span style={{ color: '#8A8A96' }}> — {descricaoDe(r, regras)}</span>}</span>
        </span>
      ))}
      {alimentadores && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5, color: '#D5D5DD',
                       paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ width: 14, display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ height: 3, background: CORES.risco }} /><span style={{ height: 1.5, background: CORES.folga, opacity: 0.7 }} />
          </span>
          Alimentador — traço grosso em risco, fino com folga
        </span>
      )}
      {subestacoes && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5, color: '#D5D5DD' }}>
          <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>
            <span style={{ width: 10, height: 10, background: COR_SUBESTACAO, transform: 'rotate(45deg)' }} />
          </span>
          Subestação
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `PainelLateral.tsx`**

```tsx
import { AlertTriangle, ArrowLeft, Crosshair, GitBranch } from 'lucide-react';
import { GOLD } from '../ConsoleSections';
import { useDetalheAlimentador } from './consultas';
import { CORES, ORDEM, ROTULOS } from './estilos';
import { inteiro, kva, kw, mesesDesde, pct, percentualDe, rotuloIdade } from './formato';
import type { PropsAlimentador, PropsPonto, RespostaMapa, Risco, Selecao } from './tipos';
import type { Caixa } from './zoom';

/**
 * O equivalente acessível do mapa — não enfeite. Mil marcadores não se
 * navegam por teclado; esta coluna sim. Tem os mesmos dados do mapa, na
 * mesma ordem de importância: resumo da área, lista contextual, detalhe.
 */
interface Props {
  resposta: RespostaMapa | undefined; carregando: boolean; selecao: Selecao;
  aoSelecionar: (s: Selecao) => void; aoEnquadrar: (c: Caixa) => void; aoCentrar: (lng: number, lat: number) => void;
}

const rotuloSecao: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 };
const linha: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '9px 12px', background: '#16161F' };
const bloco: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 10, overflow: 'hidden' };
const botaoLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' };

const Ponto = ({ risco }: { risco: Risco }) =>
  <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0, background: CORES[risco] }} />;

function Resumo({ r }: { r: RespostaMapa['resumo'] }) {
  const tile = (risco: Risco, rotulo: string) => (
    <div key={risco} style={{ background: `${CORES[risco]}1A`, border: `1px solid ${CORES[risco]}47`, borderRadius: 10, padding: '10px 12px' }}>
      <p style={{ fontSize: 19, fontWeight: 800, color: risco === 'folga' ? '#5DD372' : risco === 'risco' ? '#FF7A6B' : CORES[risco], margin: 0 }}>
        {percentualDe(r[risco], r.total)}%
      </p>
      <p style={{ fontSize: 11, color: '#9A9AA8', margin: '2px 0 0' }}>{rotulo} · {inteiro(r[risco])}</p>
    </div>
  );
  return (
    <div>
      <p style={{ ...rotuloSecao, marginBottom: 9 }}>Área visível · {inteiro(r.total)} trafos</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {tile('folga', 'com folga')}{tile('atencao', 'em atenção')}{tile('risco', 'em risco')}{tile('sem_dado', 'sem dado')}
      </div>
    </div>
  );
}

function BarraOcupacao({ ocupacao, risco, limiarRisco }: { ocupacao: number | null; risco: Risco; limiarRisco: number }) {
  if (ocupacao === null) return null;
  const escala = Math.max(limiarRisco * 1.5, ocupacao);   // a marca dos 100% nunca cola na borda
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, color: '#6B6B78', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Ocupação da margem</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: CORES[risco] }}>{pct(ocupacao)}</span>
      </div>
      <div style={{ height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (ocupacao / escala) * 100)}%`, height: '100%', background: CORES[risco], borderRadius: 5 }} />
        <div aria-hidden style={{ position: 'absolute', left: `${(limiarRisco / escala) * 100}%`, top: -2, bottom: -2, width: 2, background: '#E8E8EE' }} />
      </div>
      <p style={{ fontSize: 10.5, color: '#6B6B78', margin: '5px 0 0' }}>
        A marca clara é o limite de {limiarRisco}%{ocupacao >= limiarRisco ? ' — a barra passou dele.' : '.'}
      </p>
    </div>
  );
}

function Procedencia({ base }: { base: RespostaMapa['base'] }) {
  const idade = base.data_base ? mesesDesde(base.data_base) : null;
  const d = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <p style={rotuloSecao}>Procedência do dado</p>
      {[['Fonte', 'BDGD · ANEEL'], ['Distribuidora', base.distribuidora ?? '—'], ['Data-base', d(base.data_base)],
        ['Importada em', d(base.importado_em)]].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#9A9AA8' }}>{k}</span><span style={{ color: '#D5D5DD', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
      {idade !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#9A9AA8' }}>Idade do dado</span><span style={{ color: '#E3B341', fontWeight: 700 }}>{rotuloIdade(idade)}</span>
        </div>
      )}
    </div>
  );
}

function ContextoAlimentador({ id, aoAbrir }: { id: number | null; aoAbrir: (id: number) => void }) {
  const q = useDetalheAlimentador(id);
  if (id === null) return <span style={{ fontSize: 12, color: '#8A8A96' }}>alimentador não informado</span>;
  if (!q.data) return <span style={{ fontSize: 12, color: '#8A8A96' }}>{q.isLoading ? 'lendo o alimentador…' : '—'}</span>;
  const a = q.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[['Alimentador', a.codigo], ['Subestação', a.subestacao ?? '—'],
        ['Trafos no alimentador', `${inteiro(a.trafos)} · ${inteiro(a.trafos_risco)} em risco`],
        ['Ocupação do alimentador', pct(a.ocupacao_pct)]].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#9A9AA8' }}>{k}</span><span style={{ color: '#D5D5DD', fontWeight: 600, textAlign: 'right' }}>{v}</span>
        </div>
      ))}
      <button type="button" onClick={() => aoAbrir(a.id)} style={botaoLink}><GitBranch size={12} /> Ver o alimentador</button>
    </div>
  );
}

function DetalheTrafo({ p, regras, base, aoVoltar, aoAbrirAlimentador }:
  { p: PropsPonto; regras: RespostaMapa['regras']; base: RespostaMapa['base']; aoVoltar: () => void; aoAbrirAlimentador: (id: number) => void }) {
  const veredito: Record<Risco, [string, string]> = {
    risco: ['Margem esgotada', 'A geração já conectada supera a carga mínima diurna estimada. Um novo projeto neste trafo tende a inverter o fluxo.'],
    atencao: ['Margem apertada', `A geração conectada já passa de ${regras.atencao}% da margem estimada. Cabe pouco antes da inversão.`],
    folga: ['Há margem aparente', `A geração conectada fica abaixo de ${regras.atencao}% da carga mínima diurna estimada.`],
    sem_dado: ['Sem dado para avaliar', 'A base não traz carga ou geração para este trafo. Ausência de dado não é ausência de risco.'],
  };
  const [titulo, texto] = veredito[p.risco];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={aoVoltar} style={botaoLink}><ArrowLeft size={13} /> Voltar à lista</button>
      <div>
        <p style={rotuloSecao}>Transformador de distribuição</p>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '4px 0 0' }}>{p.codigo}</h3>
        <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
          {p.alimentador ? `Alimentador ${p.alimentador}` : 'alimentador não informado'}{p.subestacao ? ` · SE ${p.subestacao}` : ''}
        </p>
      </div>
      <div style={{ background: `${CORES[p.risco]}1A`, border: `1px solid ${CORES[p.risco]}59`, borderRadius: 11, padding: 13 }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800, color: CORES[p.risco], margin: '0 0 6px' }}>
          <AlertTriangle size={14} /> {titulo}
        </p>
        <p style={{ fontSize: 12.5, color: '#D5D5DD', margin: 0, lineHeight: 1.5 }}>{texto}</p>
      </div>
      <div style={bloco}>
        <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>Potência nominal</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kva(p.potencia_nominal_kva)}</span></div>
        <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>Carga mínima diurna estimada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(p.carga_min_diurna_kw)}</span></div>
        <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>GD já conectada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(p.gd_conectada_kw)}</span></div>
        <div style={{ ...linha, background: `${CORES[p.risco]}17` }}><span style={{ fontSize: 12, color: '#D5D5DD', fontWeight: 600 }}>Margem até a inversão</span><span style={{ fontSize: 14, fontWeight: 800, color: CORES[p.risco] }}>{kw(p.margem_kw)}</span></div>
      </div>
      <BarraOcupacao ocupacao={p.ocupacao_pct} risco={p.risco} limiarRisco={regras.risco} />
      <ContextoAlimentador id={p.alimentador_id} aoAbrir={aoAbrirAlimentador} />
      <Procedencia base={base} />
    </div>
  );
}

function DetalheAlimentadorView({ id, props, regras, base, aoVoltar, aoEnquadrar }:
  { id: number; props?: PropsAlimentador; regras: RespostaMapa['regras']; base: RespostaMapa['base']; aoVoltar: () => void; aoEnquadrar: (c: Caixa) => void }) {
  const q = useDetalheAlimentador(id);
  const a = q.data;
  const risco: Risco = a?.risco ?? props?.risco ?? 'sem_dado';
  const codigo = a?.codigo ?? props?.codigo ?? `#${id}`;
  const caixa = a && a.oeste !== null ? { oeste: a.oeste, sul: a.sul!, leste: a.leste!, norte: a.norte! } : props ? { oeste: props.oeste, sul: props.sul, leste: props.leste, norte: props.norte } : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={aoVoltar} style={botaoLink}><ArrowLeft size={13} /> Voltar à lista</button>
      <div>
        <p style={rotuloSecao}>Alimentador de média tensão</p>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: '4px 0 0' }}>{codigo}</h3>
        <p style={{ fontSize: 11.5, color: '#8A8A96', margin: '3px 0 0' }}>
          {a?.subestacao ? `SE ${a.subestacao}` : props?.subestacao ? `SE ${props.subestacao}` : 'subestação não informada'}
          {a?.distribuidora ? ` · ${a.distribuidora}` : ''}
        </p>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600,
                     color: '#ddd', padding: '4px 9px', borderRadius: 20, background: `${CORES[risco]}2E`, border: `1px solid ${CORES[risco]}80` }}>
        <AlertTriangle size={11} style={{ color: CORES[risco] }} /> {ROTULOS[risco]}
      </span>
      {a && (
        <>
          <div style={bloco}>
            <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>Carga mínima diurna estimada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(a.carga_min_diurna_kw)}</span></div>
            <div style={linha}><span style={{ fontSize: 12, color: '#9A9AA8' }}>GD já conectada</span><span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{kw(a.gd_conectada_kw)}</span></div>
            <div style={{ ...linha, background: `${CORES[risco]}17` }}><span style={{ fontSize: 12, color: '#D5D5DD', fontWeight: 600 }}>Margem até a inversão</span><span style={{ fontSize: 14, fontWeight: 800, color: CORES[risco] }}>{kw(a.margem_kw)}</span></div>
          </div>
          <BarraOcupacao ocupacao={a.ocupacao_pct} risco={risco} limiarRisco={regras.risco} />
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 7 }}>Trafos neste alimentador · {inteiro(a.trafos)}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {ORDEM.map(r => {
                const n = { risco: a.trafos_risco, atencao: a.trafos_atencao, folga: a.trafos_folga, sem_dado: a.trafos_sem_dado }[r];
                return (
                  <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Ponto risco={r} /><span style={{ flex: 1, color: '#D5D5DD' }}>{ROTULOS[r]}</span>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{inteiro(n)}</span>
                    <span style={{ width: 36, textAlign: 'right', color: '#8A8A96' }}>{percentualDe(n, a.trafos)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          {!a.tem_tracado && <p style={{ fontSize: 11.5, color: '#9A9AA8', margin: 0 }}>Este alimentador ainda não tem traçado na base; a caixa vem dos trafos.</p>}
        </>
      )}
      {caixa && <button type="button" onClick={() => aoEnquadrar(caixa)} style={botaoLink}><Crosshair size={13} /> Enquadrar este alimentador</button>}
      <Procedencia base={base} />
    </div>
  );
}

export function PainelLateral({ resposta, carregando, selecao, aoSelecionar, aoEnquadrar, aoCentrar }: Props) {
  const pontos = resposta?.pontos?.features.map(f => f.properties) ?? [];
  const alims = (resposta?.alimentadores?.features.map(f => f.properties) ?? [])
    .slice().sort((a, b) => (b.ocupacao_pct ?? -1) - (a.ocupacao_pct ?? -1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
      {resposta && !selecao && <Resumo r={resposta.resumo} />}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy={carregando}>
        {selecao?.tipo === 'trafo' && resposta && (
          <DetalheTrafo p={selecao.props} regras={resposta.regras} base={resposta.base}
                        aoVoltar={() => aoSelecionar(null)} aoAbrirAlimentador={id => aoSelecionar({ tipo: 'alimentador', id })} />
        )}
        {selecao?.tipo === 'alimentador' && resposta && (
          <DetalheAlimentadorView id={selecao.id} props={selecao.props} regras={resposta.regras} base={resposta.base}
                                  aoVoltar={() => aoSelecionar(null)} aoEnquadrar={aoEnquadrar} />
        )}

        {!selecao && resposta?.camada === 'ponto' && (
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 6 }}>
              Transformadores nesta vista{resposta.excedeu ? ` · os ${inteiro(resposta.teto)} mais ocupados` : ''}
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {pontos.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => { aoSelecionar({ tipo: 'trafo', props: p }); aoCentrar(p.lng, p.lat); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: 'none',
                                   border: 'none', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <Ponto risco={p.risco} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#ddd' }}>{p.codigo}</span>
                    <span style={{ fontSize: 11, color: '#8A8A96', whiteSpace: 'nowrap' }}>{pct(p.ocupacao_pct)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!selecao && resposta?.camada === 'celula' && alims.length === 0 && (
          <p style={{ fontSize: 12, color: '#8A8A96', margin: 0, lineHeight: 1.5 }}>
            Aproxime até o zoom 14 para listar os transformadores, ou ligue a camada de alimentadores para ver os mais saturados.
          </p>
        )}

        {!selecao && alims.length > 0 && (
          <div>
            <p style={{ ...rotuloSecao, marginBottom: 6 }}>Alimentadores mais saturados na vista</p>
            <div style={bloco}>
              {alims.slice(0, 12).map(a => (
                <button key={a.id} type="button" onClick={() => aoSelecionar({ tipo: 'alimentador', id: a.id, props: a })}
                        style={{ ...linha, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', alignItems: 'center' }}>
                  <Ponto risco={a.risco} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{a.codigo}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: '#8A8A96' }}>
                      {a.subestacao ? `SE ${a.subestacao} · ` : ''}{inteiro(a.trafos)} trafos · {inteiro(a.trafos_risco)} em risco
                    </span>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: CORES[a.risco] }}>{pct(a.ocupacao_pct)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ fontSize: 11.5, color: '#9A9AA8', margin: 0, lineHeight: 1.55 }}>
          <strong style={{ color: '#D5D5DD' }}>Indicativo, não é parecer.</strong>{' '}
          A carga mínima é estimada da curva das unidades consumidoras. Só a distribuidora emite o parecer de acesso.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Tipos** → 65. **Commit**

```bash
git add src/pages/painel/rede/Busca.tsx src/pages/painel/rede/Legenda.tsx src/pages/painel/rede/PainelLateral.tsx
git commit -m "feat(rede): busca unificada, legenda com limiares reais e painel lateral do mapa v2"
```

---

### Task 6: Front — `NetworkSection` v2 (layout tela cheia e orquestração)

**Files:**
- Rewrite: `src/pages/painel/NetworkSection.tsx`

**Interfaces:** Consumes tudo de `./rede/*`. Mantém o export `NetworkSection` usado por `PainelConsole.tsx`.

- [ ] **Step 1: Reescrever o arquivo**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { AlertTriangle, Clock, Satellite, Map as MapIcon, Zap, GitBranch, Factory } from 'lucide-react';
import { card, GOLD, Loading } from './ConsoleSections';
import { Busca } from './rede/Busca';
import { Legenda } from './rede/Legenda';
import { PainelLateral } from './rede/PainelLateral';
import { useRedeNoMapa } from './rede/consultas';
import { useCamadaVetorial, type Alvo } from './rede/useCamadaVetorial';
import { estiloAlimentador, estiloCelula, estiloContornoAlimentador, estiloPonto, estiloSubestacao, ROTULOS } from './rede/estilos';
import { inteiro, mesesDesde, pct, rotuloIdade } from './rede/formato';
import { caixaDeConsulta, contemCaixa, type Caixa } from './rede/zoom';
import type { Camada, PropsAlimentador, PropsCelula, PropsPonto, PropsSubestacao, Risco, Selecao } from './rede/tipos';
import type { SugestaoRede } from './rede/busca';

/**
 * Capacidade de rede e risco de inversão de fluxo — 2ª entrega (spec §11).
 *
 * O dado é a BDGD da ANEEL, pública e anual. NÃO cruza com projetos do GD
 * Manager e NÃO é parecer de acesso. O servidor decide a camada pelo zoom e
 * devolve GeoJSON pronto; aqui cada tipo de feição é UMA `google.maps.Data`
 * (ver useCamadaVetorial — era a recriação de 1.500 <Marker> que travava).
 *
 * A vista só volta ao servidor quando sai da caixa já carregada (20% maior
 * que a tela) ou quando o zoom muda. A lista lateral é o equivalente
 * acessível do mapa.
 */
const LIBRARIES: ('places')[] = ['places'];   // as outras telas usam as mesmas; opções diferentes quebram o loader
const CENTRO_PADRAO = { lat: -22.9056, lng: -47.0616 };
const CHAVE_VISTA = 'painel.rede.vista';

interface Vista { lat: number; lng: number; zoom: number; camadas: Camada[]; satelite: boolean }
const lerVista = (): Vista | null => { try { const v = sessionStorage.getItem(CHAVE_VISTA); return v ? JSON.parse(v) as Vista : null; } catch { return null; } };
const guardarVista = (v: Vista) => { try { sessionStorage.setItem(CHAVE_VISTA, JSON.stringify(v)); } catch { /* sem storage, sem memória de vista */ } };

const caixaDe = (b: google.maps.LatLngBounds): Caixa => {
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  return { oeste: sw.lng(), sul: sw.lat(), leste: ne.lng(), norte: ne.lat() };
};
const limitesDe = (c: Caixa) => new google.maps.LatLngBounds({ lat: c.sul, lng: c.oeste }, { lat: c.norte, lng: c.leste });

export function NetworkSection() {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script', libraries: LIBRARIES,
    googleMapsApiKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ?? '',
  });
  const inicial = useRef(lerVista());
  const [mapa, setMapa] = useState<google.maps.Map | null>(null);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [zoom, setZoom] = useState(inicial.current?.zoom ?? 13);
  const [soRisco, setSoRisco] = useState(false);
  const [satelite, setSatelite] = useState(inicial.current?.satelite ?? true);
  const [camadas, setCamadas] = useState<Camada[]>(inicial.current?.camadas ?? ['pontos', 'alimentadores']);
  const [selecao, setSelecao] = useState<Selecao>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const q = useRedeNoMapa({ caixa, zoom, soRisco, camadas });
  const r = q.data;

  // ── vista → consulta: só quando sai da caixa carregada ou o zoom muda ──────
  const onIdle = useCallback(() => {
    if (!mapa) return;
    const b = mapa.getBounds(); const z = mapa.getZoom() ?? 13;
    if (!b) return;
    const vista = caixaDe(b);
    setZoom(z);
    setCaixa(atual => (atual && z === zoom && contemCaixa(atual, vista)) ? atual : caixaDeConsulta(vista));
    const c = mapa.getCenter();
    if (c) guardarVista({ lat: c.lat(), lng: c.lng(), zoom: z, camadas, satelite });
  }, [mapa, zoom, camadas, satelite]);

  useEffect(() => { if (mapa) guardarVista({ lat: mapa.getCenter()?.lat() ?? CENTRO_PADRAO.lat, lng: mapa.getCenter()?.lng() ?? CENTRO_PADRAO.lng, zoom, camadas, satelite }); }, [mapa, zoom, camadas, satelite]);

  // ── estilos: funções memoizadas (um setStyle por mudança, não por render) ──
  const estPonto = useMemo(() => (p: Record<string, unknown>) => estiloPonto(p.risco as Risco, satelite), [satelite]);
  const estCelula = useMemo(() => (p: Record<string, unknown>) => estiloCelula(p.risco as Risco, Number(p.nivel), satelite), [satelite]);
  const estAlim = useMemo(() => (p: Record<string, unknown>) => estiloAlimentador(p.risco as Risco, zoom, satelite), [zoom, satelite]);
  const estContorno = useMemo(() => () => estiloContornoAlimentador(zoom), [zoom]);
  const estSub = useMemo(() => () => estiloSubestacao(satelite), [satelite]);

  const sobrePonto = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const p = a.props as unknown as PropsPonto;
    setSobre(`Trafo ${p.codigo} · ${ROTULOS[p.risco]} · ${pct(p.ocupacao_pct)}`);
  };
  const sobreCelula = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const c = a.props as unknown as PropsCelula;
    setSobre(`${inteiro(c.trafos)} trafos · ${inteiro(c.trafos_risco)} em risco · clique para aproximar`);
  };
  const sobreAlim = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const al = a.props as unknown as PropsAlimentador;
    setSobre(`Alimentador ${al.codigo} · ${ROTULOS[al.risco]} · ${pct(al.ocupacao_pct)}`);
  };
  const sobreSub = (a: Alvo | null) => {
    if (!a) return setSobre(null);
    const s = a.props as unknown as PropsSubestacao;
    setSobre(`SE ${s.nome ?? s.codigo} · ${inteiro(s.alimentadores)} alimentadores · ${inteiro(s.alimentadores_risco)} em risco`);
  };

  const pontosRef = useCamadaVetorial({
    mapa, colecao: r?.pontos, visivel: camadas.includes('pontos'), estilo: estPonto, aoPassar: sobrePonto,
    aoClicar: a => setSelecao({ tipo: 'trafo', props: a.props as unknown as PropsPonto }),
  });
  useCamadaVetorial({
    mapa, colecao: r?.celulas, visivel: camadas.includes('pontos'), estilo: estCelula, aoPassar: sobreCelula,
    aoClicar: a => { const c = a.props as unknown as PropsCelula; mapa?.fitBounds(limitesDe(c)); },
  });
  useCamadaVetorial({ mapa, colecao: r?.alimentadores, visivel: camadas.includes('alimentadores') && satelite, estilo: estContorno });
  const alimRef = useCamadaVetorial({
    mapa, colecao: r?.alimentadores, visivel: camadas.includes('alimentadores'), estilo: estAlim, aoPassar: sobreAlim,
    aoClicar: a => setSelecao({ tipo: 'alimentador', id: a.id, props: a.props as unknown as PropsAlimentador }),
  });
  useCamadaVetorial({ mapa, colecao: r?.subestacoes, visivel: camadas.includes('subestacoes'), estilo: estSub, aoPassar: sobreSub });

  // ── destaque da seleção: overrideStyle, sem re-render de camada ────────────
  useEffect(() => {
    pontosRef.current?.revertStyle(); alimRef.current?.revertStyle();
    if (selecao?.tipo === 'trafo') {
      const f = pontosRef.current?.getFeatureById(selecao.props.id);
      if (f) pontosRef.current?.overrideStyle(f, estiloPonto(selecao.props.risco, satelite, true));
    } else if (selecao?.tipo === 'alimentador') {
      const f = alimRef.current?.getFeatureById(selecao.id);
      const risco = (selecao.props?.risco ?? (f?.getProperty('risco') as Risco | undefined)) ?? 'sem_dado';
      if (f) alimRef.current?.overrideStyle(f, estiloAlimentador(risco, zoom, satelite, true));
    }
  }, [selecao, satelite, zoom, r, pontosRef, alimRef]);

  const enquadrar = (c: Caixa) => mapa?.fitBounds(limitesDe(c), 40);
  const centrar = (lng: number, lat: number) => { mapa?.panTo({ lat, lng }); if ((mapa?.getZoom() ?? 0) < 16) mapa?.setZoom(16); };

  const escolherDaBusca = (s: SugestaoRede) => {
    const i = s.item;
    if (s.tipo === 'alimentador') {
      setCamadas(c => c.includes('alimentadores') ? c : [...c, 'alimentadores']);
      if (i.oeste !== null) enquadrar({ oeste: i.oeste, sul: i.sul!, leste: i.leste!, norte: i.norte! });
      setSelecao({ tipo: 'alimentador', id: i.id });
    } else if (s.tipo === 'trafo' && i.lng !== null && i.lat !== null) {
      centrar(i.lng, i.lat);
      // o detalhe abre quando a resposta com este trafo chegar (ver efeito abaixo)
      pendente.current = i.id;
    } else if (i.lng !== null && i.lat !== null) {
      setCamadas(c => c.includes('subestacoes') ? c : [...c, 'subestacoes']);
      mapa?.panTo({ lat: i.lat, lng: i.lng }); mapa?.setZoom(14);
    }
  };
  const pendente = useRef<number | null>(null);
  useEffect(() => {
    if (pendente.current === null || !r?.pontos) return;
    const f = r.pontos.features.find(x => x.id === pendente.current);
    if (f) { setSelecao({ tipo: 'trafo', props: f.properties }); pendente.current = null; }
  }, [r]);

  const alternar = (c: Camada) => setCamadas(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]);
  const base = r?.base ?? {};
  const idade = base.data_base ? mesesDesde(base.data_base) : null;

  const chip: React.CSSProperties = { fontSize: 11, color: '#9A9AA8', padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' };
  const alternador = (ativo: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', border: 'none', cursor: 'pointer',
    fontSize: 11.5, fontWeight: ativo ? 700 : 500, fontFamily: 'inherit',
    background: ativo ? 'rgba(245,168,0,0.16)' : 'transparent', color: ativo ? GOLD : '#9A9AA8',
  });
  const grupo: React.CSSProperties = { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 48px)', minHeight: 560 }}>
      {/* cabeçalho: título, procedência, filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0, marginRight: 6 }}>Capacidade de rede e inversão de fluxo</h2>
        {base.distribuidora && <span style={chip}>{base.distribuidora}</span>}
        {base.data_base && (
          <span style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 5, color: '#E3B341',
                         background: 'rgba(245,168,0,0.1)', border: '1px solid rgba(245,168,0,0.25)' }}>
            <Clock size={11} /> Base de {new Date(base.data_base).toLocaleDateString('pt-BR')}{idade !== null && ` · ${rotuloIdade(idade)}`}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="Camadas" style={grupo}>
            <button type="button" aria-pressed={camadas.includes('pontos')} onClick={() => alternar('pontos')} style={alternador(camadas.includes('pontos'))}><Zap size={12} /> Transformadores</button>
            <button type="button" aria-pressed={camadas.includes('alimentadores')} onClick={() => alternar('alimentadores')} style={alternador(camadas.includes('alimentadores'))}><GitBranch size={12} /> Alimentadores</button>
            <button type="button" aria-pressed={camadas.includes('subestacoes')} onClick={() => alternar('subestacoes')} style={alternador(camadas.includes('subestacoes'))}><Factory size={12} /> Subestações</button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#C6C6D0', cursor: 'pointer' }}>
            <input type="checkbox" checked={soRisco} onChange={e => setSoRisco(e.target.checked)} style={{ width: 15, height: 15, accentColor: GOLD, cursor: 'pointer' }} />
            Só o que não está com folga
          </label>
          <div role="group" aria-label="Camada do mapa" style={grupo}>
            <button type="button" aria-pressed={satelite} onClick={() => setSatelite(true)} style={alternador(satelite)}><Satellite size={12} /> Satélite</button>
            <button type="button" aria-pressed={!satelite} onClick={() => setSatelite(false)} style={alternador(!satelite)}><MapIcon size={12} /> Mapa</button>
          </div>
        </div>
      </div>

      {q.isError && (
        <div style={{ ...card, color: '#FF7A6B', fontSize: 13, padding: '10px 14px' }}>
          Não consegui ler a base de rede.{' '}
          <button type="button" onClick={() => void q.refetch()} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>Tentar de novo</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        {/* mapa */}
        <div style={{ flex: '999 1 480px', minWidth: 0, minHeight: 420, position: 'relative', ...card, padding: 0, overflow: 'hidden' }}>
          {!isLoaded ? <Loading /> : (
            <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }}
              center={inicial.current ? { lat: inicial.current.lat, lng: inicial.current.lng } : CENTRO_PADRAO} zoom={zoom}
              onLoad={m => setMapa(m)} onUnmount={() => setMapa(null)} onIdle={onIdle}
              mapTypeId={satelite ? 'hybrid' : 'roadmap'}
              options={{ mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
                         gestureHandling: 'greedy', zoomControlOptions: { position: 7 /* RIGHT_TOP */ } }} />
          )}
          {/* faixa de carregamento: fina, sem esconder o mapa */}
          {q.isFetching && <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />}
          {/* busca flutuante */}
          <div style={{ position: 'absolute', top: 12, left: 12, right: 60, display: 'flex', gap: 8, flexWrap: 'wrap', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto', flex: '0 1 360px' }}><Busca mapa={mapa} aoEscolherRede={escolherDaBusca} /></div>
            {r?.excedeu && (
              <span style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#E3B341',
                             background: 'rgba(14,14,20,0.92)', border: '1px solid rgba(245,168,0,0.3)', borderRadius: 9, padding: '7px 10px' }}>
                <AlertTriangle size={13} /> {inteiro(r.resumo.total)} trafos aqui — mostrando os {inteiro(r.teto)} mais ocupados. Aproxime para ver todos.
              </span>
            )}
          </div>
          {/* faixa do que está sob o mouse: fixa, não esconde o ponto */}
          <div role="status" aria-live="polite" style={{ position: 'absolute', left: 12, bottom: 12, right: 12, display: 'flex', gap: 10, alignItems: 'flex-end', justifyContent: 'space-between', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}>
              <Legenda regras={r?.regras} satelite={satelite} alimentadores={camadas.includes('alimentadores')} subestacoes={camadas.includes('subestacoes')} />
            </div>
            <span style={{ fontSize: 11.5, color: sobre ? '#fff' : '#8A8A96', background: 'rgba(14,14,20,0.9)', border: '1px solid rgba(255,255,255,0.1)',
                           borderRadius: 8, padding: '6px 10px', maxWidth: 420, textAlign: 'right' }}>
              {sobre ?? (r?.camada === 'celula' ? 'Clique numa célula para aproximar' : 'Passe o mouse sobre um ponto')}
            </span>
          </div>
          {r && r.resumo.total === 0 && !q.isFetching && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 12.5, color: '#D5D5DD', background: 'rgba(14,14,20,0.9)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px' }}>
                Nenhum ponto de rede nesta área — fora da concessão carregada (CPFL Paulista e Piratininga).
              </span>
            </div>
          )}
        </div>

        {/* painel lateral: o equivalente acessível */}
        <div style={{ flex: '1 1 320px', maxWidth: 380, minHeight: 420, ...card, padding: 14 }}>
          <PainelLateral resposta={r} carregando={q.isFetching} selecao={selecao} aoSelecionar={setSelecao}
                         aoEnquadrar={enquadrar} aoCentrar={centrar} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar**: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"` → 65; `npm run build` limpo; `npx vitest run` tudo verde.

- [ ] **Step 3: Revisão adversarial do próprio diff** (o que faria o mapa travar de novo?): nenhum `useMemo` de estilo com dependência que muda a cada render; `onIdle` não dispara `setCaixa` quando a vista cabe na caixa; `useCamadaVetorial` não religa listeners; `placeholderData` mantém o dado anterior.

- [ ] **Step 4: Commit**

```bash
git add src/pages/painel/NetworkSection.tsx
git commit -m "feat(rede): NetworkSection v2 — camadas vetoriais, busca, camadas ligáveis e tela cheia"
```

---

### Task 7: Publicar, reingerir as duas CPFL e medir

**Files:** nenhum novo (usa `.github/workflows/ludmilla-worker.yml` com `bdgd` + `bdgd_forcar`).

- [ ] **Step 1: Push + PR** da branch `feat/rede-mapa-ux` para `main` (o usuário pediu PR). Mesclar com squash depois da verificação local (mesmo critério do PR #3).
- [ ] **Step 2: Deploy do worker + ingestão**: disparar `ludmilla-worker.yml` com `bdgd=CPFL_Piratininga`, `bdgd_forcar=true`; esperar o run; conferir `rede_importacao` (situação `concluida`, `linhas_por_camada`). Repetir para `CPFL_Paulista`.
- [ ] **Step 3: Conferir o traçado**

```sql
select d.sigla, count(*) alims, count(a.geom) com_tracado, round(avg(ST_NPoints(a.geom))) pts_medio, max(ST_NPoints(a.geom)) pts_max
  from rede_alimentador a join rede_distribuidora d on d.id = a.distribuidora_id where a.ativo group by 1;
explain (analyze, timing off, summary) select public.rede_mapa_alimentadores(ST_MakeEnvelope(-47.15,-22.98,-46.98,-22.83,4326), 12, false);
explain (analyze, timing off, summary) select public.rede_mapa_alimentadores(ST_MakeEnvelope(-53.2,-25.4,-44.0,-19.7,4326), 7, false);
```
Esperado: Piratininga ≈ 550/553 com traçado; Paulista a maioria; < 400 ms cada.

- [ ] **Step 4: Teste de uso** pelo usuário em `/painel` → Capacidade de rede, com a lista de verificação da §11.2 (arrastar sem travar, zoom 11–13 com células, zoom 14 com pontos, busca "Campinas", busca por código de alimentador, camadas, detalhe com barra e contexto, satélite/mapa). Correções que surgirem viram commits nesta mesma branch/PR.

---

### Task 8: Documentação

**Files:**
- Modify: `docs/modules/engineering/overview.md` (depois de "A camada de satélite no mapa"), `docs/superpowers/specs/2026-10-10-capacidade-rede-design.md` §11 (números finais), `CLAUDE.md` (linha da tabela), este plano ("Decisões medidas").

- [ ] **Step 1: overview.md** — nova subseção `### Mapa v2 (13/10/2026): camada vetorial, busca, alimentadores` com: o diagnóstico em três linhas (marcadores recriados; células até o 11; 12.274 trafos em Campinas no 12), a tabela zoom → camada da spec §11.2, a nota do `ST_LineMerge` antes do `ST_Simplify`, os contratos novos e os tempos medidos na Task 7.
- [ ] **Step 2: CLAUDE.md** — linha "Capacidade de rede (BDGD)": acrescentar "mapa v2 com traçado dos alimentadores, busca e camadas".
- [ ] **Step 3: Commit** `docs(rede): mapa v2 — diagnóstico medido, camadas por zoom, traçado dos alimentadores`.

---

## Decisões medidas (preencher na execução)

| O quê | Medido | Decisão |
|---|---|---|
| Agregação da SSDMT no ogr2ogr (Piratininga) | 3,25 s · 5,4 MB · 550 linhas · máx. 69 KB · mediana 6,4 KB | `ST_SimplifyPreserveTopology(ST_LineMerge(ST_Collect(SHAPE)), 0.00005)`; lotes de 100 |
| `ST_Simplify` sem `ST_LineMerge` | 8.582 → 8.582 pontos (nada) | LineMerge obrigatório (→ 2.210) |
| RPC v1 zoom 12 Campinas | 624 ms · 432 KB · 12.274 candidatos, 1.500 devolvidos | níveis 3 e 4; pontos só do 14; teto 4.000 |
| RPC v2 (Task 1, Step 5) | células n3 Campinas: 397 ms frio / **18 ms** quente, 192 feições, 79 KB · células n4 (zoom 13): 17 ms · pontos z14 centro de Campinas: **272 ms**, 2.183 feições, 934 KB · resumo n3: 18 ms · busca `%3410%` com trgm: 241 ms (9.387 candidatos) | teto 4.000 aguenta; resposta do zoom 14 é o maior peso (gzip do PostgREST ajuda) |
| Células por nível depois do recálculo | 1: 292 · 2: 3.542 · 3: 32.348 · 4: 83.945 | o CHECK `nivel IN (1,2)` da Fase A barrou a 1ª recarga; trocado por `BETWEEN 1 AND 4` |
| Contagens por alimentador | 2.068 de 2.330 com trafos; soma 295.197 (= trafos ativos); 49.444 em risco | — |
| Alimentadores por vista (Task 7, Step 3) | _preencher_ | |

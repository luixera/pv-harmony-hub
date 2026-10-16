-- ============================================================================
-- Eletropostos — passo por LEITURA (16/10/2026, pedido do usuário via estação)
--
-- Os carregadores AC de 7 kW passam a ser lidos a cada ~16 min (duas metades
-- alternadas a cada ciclo de 8), enquanto DC e Cury seguem em 8 e a Tupi em 5.
-- Cada linha pode trazer `passo_min`; a conta usa o passo da leitura e, sem
-- ele, o da fonte (`eletropostos_passo`). Sem isso, as horas de uso dos AC
-- sairiam pela metade.
--
-- Muda: eletroposto_leitura.passo_min · gravar_interno grava o campo ·
-- conectores/detalhe ponderam pela leitura · assertividade: tentativas por
-- local = minutos em que a fonte leu ÷ passo do local (um AC lido em 1 de
-- cada 2 ciclos não sai mais com 50 %).
-- ============================================================================

ALTER TABLE public.eletroposto_leitura ADD COLUMN IF NOT EXISTS passo_min integer CHECK (passo_min BETWEEN 1 AND 120);

CREATE OR REPLACE FUNCTION public.eletropostos_gravar_interno(p_fonte text, p_linhas jsonb, p_erro text, p_falhas jsonb DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _t    uuid := public.eletropostos_tenant();
  _ts   timestamptz := date_trunc('second', now());
  _slot timestamptz := to_timestamp(floor(extract(epoch FROM now()) / 300) * 300);
  _n    integer := 0;
  l     record;
  _vinc uuid;
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'sem tenant biblioteca'; END IF;
  IF p_fonte IS NULL OR p_fonte = '' THEN RAISE EXCEPTION 'fonte obrigatória'; END IF;

  FOR l IN SELECT * FROM jsonb_to_recordset(COALESCE(p_linhas, '[]'::jsonb))
             AS x(local_fonte text, local_nome text, lat double precision, lng double precision,
                  conector text, potencia_kw numeric, status_bruto text, status text, upstream_ts text, passo_min integer)
  LOOP
    CONTINUE WHEN l.local_fonte IS NULL;
    IF EXISTS (SELECT 1 FROM public.eletroposto_fonte_local WHERE fonte = p_fonte AND local_fonte = l.local_fonte) THEN
      UPDATE public.eletroposto_fonte_local
         SET nome = COALESCE(l.local_nome, nome), lat = COALESCE(l.lat, lat), lng = COALESCE(l.lng, lng), visto_em = _ts
       WHERE fonte = p_fonte AND local_fonte = l.local_fonte;
    ELSE
      _vinc := NULL;
      IF l.lat IS NOT NULL AND l.lng IS NOT NULL THEN
        SELECT el.id INTO _vinc
          FROM public.eletroposto_local el
         WHERE el.lat IS NOT NULL AND el.lng IS NOT NULL
           AND public.eletropostos_distancia_m(l.lat, l.lng, el.lat, el.lng) < 150
         ORDER BY public.eletropostos_distancia_m(l.lat, l.lng, el.lat, el.lng)
         LIMIT 1;
      END IF;
      INSERT INTO public.eletroposto_fonte_local (tenant_id, fonte, local_fonte, nome, lat, lng, local_id, visto_em)
      VALUES (_t, p_fonte, l.local_fonte, l.local_nome, l.lat, l.lng, _vinc, _ts);
    END IF;

    INSERT INTO public.eletroposto_leitura
      (tenant_id, ts_utc, slot, fonte, local_fonte, local_nome, conector, potencia_kw, status_bruto, status, upstream_ts, passo_min)
    VALUES (_t, _ts, _slot, p_fonte, l.local_fonte, l.local_nome, COALESCE(l.conector, '*'), l.potencia_kw,
            l.status_bruto, COALESCE(l.status, 'desconhecido'), l.upstream_ts, l.passo_min)
    ON CONFLICT (slot, fonte, local_fonte, conector) DO UPDATE
      SET ts_utc = EXCLUDED.ts_utc, local_nome = EXCLUDED.local_nome, potencia_kw = EXCLUDED.potencia_kw,
          status_bruto = EXCLUDED.status_bruto, status = EXCLUDED.status, upstream_ts = EXCLUDED.upstream_ts,
          passo_min = EXCLUDED.passo_min;
    _n := _n + 1;
  END LOOP;

  INSERT INTO public.eletroposto_varredura (tenant_id, ts_utc, fonte, ok, n, erro, falhas)
  VALUES (_t, _ts, p_fonte, p_erro IS NULL, _n, left(p_erro, 300),
          CASE WHEN jsonb_typeof(p_falhas) = 'array' AND jsonb_array_length(p_falhas) > 0 THEN p_falhas END);
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.eletropostos_gravar_interno(text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.eletropostos_conectores(a timestamptz, b timestamptz, p_local uuid DEFAULT NULL)
RETURNS SETOF public.eletroposto_conector_agg
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH l AS (
    SELECT le.slot, le.fonte, le.local_fonte, le.conector, le.potencia_kw, le.status, le.status_bruto,
           fl.local_id AS cad,
           COALESCE(le.passo_min, c.passo_min, 5) AS passo,   -- passo da LEITURA, senão o da fonte
           lag(le.status) OVER w AS st_ant, lag(le.slot) OVER w AS slot_ant
      FROM public.eletroposto_leitura le
      LEFT JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
      LEFT JOIN public.eletroposto_fonte_config c ON c.fonte = le.fonte
     WHERE le.slot >= a AND le.slot < b
       AND (p_local IS NULL OR fl.local_id = p_local)
    WINDOW w AS (PARTITION BY le.fonte, le.local_fonte, le.conector ORDER BY le.slot)
  )
  SELECT cad, fonte, local_fonte, conector,
         COALESCE(sum(passo) FILTER (WHERE status = 'livre'), 0)::numeric,
         COALESCE(sum(passo) FILTER (WHERE status = 'ocupado'), 0)::numeric,
         COALESCE(sum(passo) FILTER (WHERE status = 'fora'), 0)::numeric,
         COALESCE(sum(passo) FILTER (WHERE status = 'desconhecido'), 0)::numeric,
         count(*) FILTER (WHERE status = 'ocupado'
                            AND NOT COALESCE(st_ant = 'ocupado' AND slot - slot_ant <= make_interval(mins => passo + 1), false))::integer,
         (array_agg(status ORDER BY slot DESC))[1],
         (array_agg(status_bruto ORDER BY slot DESC))[1],
         max(slot),
         (array_agg(potencia_kw ORDER BY slot DESC) FILTER (WHERE potencia_kw IS NOT NULL))[1],
         max(passo)::integer
    FROM l
   GROUP BY cad, fonte, local_fonte, conector
$$;

REVOKE ALL ON FUNCTION public.eletropostos_conectores(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.eletropostos_detalhe(p_local uuid, p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  per record; p jsonb; loc public.eletroposto_local; base jsonb; cons jsonb;
  diario jsonb; perfil jsonb; linha jsonb; vinc jsonb; kw numeric; preco numeric;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT * INTO loc FROM public.eletroposto_local WHERE id = p_local;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO per FROM public.eletropostos_periodo(p_de, p_ate);
  p := public.eletropostos_premissas();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fonte', c.fonte, 'local_fonte', c.local_fonte, 'conector', c.conector,
           'nome', c.fonte || ' · ' || c.local_fonte || ' · ' || c.conector,
           'm', public.eletropostos_metricas(c, per.esperadas))
         ORDER BY c.fonte, c.local_fonte, c.conector), '[]'::jsonb)
    INTO cons FROM public.eletropostos_conectores(per.a, per.b, p_local) c;

  base := public.eletropostos_montar_local(loc, cons, p, per.dias);
  cons := base->'conectores_detalhe';
  base := base - 'conectores_detalhe';
  kw := (base->>'potencia_kw')::numeric;
  preco := (base->>'preco_efetivo')::numeric;

  -- leituras do local no período, em horário de Brasília
  CREATE TEMP TABLE IF NOT EXISTS pg_temp._el (slot_local timestamp, status text, nome text, passo integer) ON COMMIT DROP;
  TRUNCATE pg_temp._el;   -- não DELETE: o safeupdate do PostgREST recusa DELETE sem WHERE
  INSERT INTO pg_temp._el
  SELECT le.slot AT TIME ZONE 'America/Sao_Paulo', le.status, le.fonte || ' · ' || le.local_fonte || ' · ' || le.conector,
         COALESCE(le.passo_min, public.eletropostos_passo(le.fonte))
    FROM public.eletroposto_leitura le
    JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
   WHERE fl.local_id = p_local AND le.slot >= per.a AND le.slot < per.b;

  -- série diária (todos os dias do período, mesmo sem leitura); minutos = Σ passo da fonte
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dia', d.dia::date, 'horas_ocupado', s.oc / 60.0, 'horas_observadas', s.ob / 60.0,
           'ocupacao', CASE WHEN s.ob > 0 THEN s.oc::numeric / s.ob END,
           'receita_min', e.e[1] * preco, 'receita_max', e.e[2] * preco) ORDER BY d.dia), '[]'::jsonb)
    INTO diario
    FROM generate_series(least(p_de, p_ate), greatest(p_de, p_ate), interval '1 day') AS d(dia)
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(passo) FILTER (WHERE status = 'ocupado'), 0) AS oc,
             COALESCE(sum(passo) FILTER (WHERE status IN ('livre', 'ocupado')), 0) AS ob
        FROM pg_temp._el WHERE slot_local::date = d.dia::date) s
    CROSS JOIN LATERAL (SELECT public.eletropostos_energia(s.oc / 60.0, kw, loc.tipo, p) AS e) e;

  -- perfil dia da semana (0 = segunda) × hora: fração do tempo carregando
  SELECT jsonb_agg(linha_dia ORDER BY w) INTO perfil
    FROM (
      SELECT w, jsonb_agg(CASE WHEN n > 0 THEN to_jsonb(oc::numeric / n) ELSE 'null'::jsonb END ORDER BY h) AS linha_dia
        FROM generate_series(0, 6) w
        CROSS JOIN generate_series(0, 23) h
        CROSS JOIN LATERAL (
          SELECT count(*) FILTER (WHERE status = 'ocupado') AS oc, count(*) AS n
            FROM pg_temp._el WHERE status IN ('livre', 'ocupado')
             AND extract(isodow FROM slot_local) - 1 = w AND extract(hour FROM slot_local) = h) x
       GROUP BY w) z;

  -- linha do tempo: últimas 48 h de cada conector (o que a tela desenha)
  SELECT COALESCE(jsonb_object_agg(nome, pts), '{}'::jsonb) INTO linha
    FROM (
      SELECT nome, jsonb_agg(jsonb_build_array(to_char(slot_local, 'YYYY-MM-DD"T"HH24:MI'), status) ORDER BY slot_local) AS pts
        FROM (SELECT *, max(slot_local) OVER (PARTITION BY nome) AS fim FROM pg_temp._el) t
       WHERE slot_local >= fim - interval '48 hours'
       GROUP BY nome) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('fonte', fonte, 'local_fonte', local_fonte, 'nome', nome)), '[]'::jsonb)
    INTO vinc FROM public.eletroposto_fonte_local WHERE local_id = p_local;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', least(p_de, p_ate), 'ate', greatest(p_de, p_ate)),
    'local', base, 'conectores', cons, 'diario', diario, 'perfil', perfil,
    'linha_do_tempo', linha, 'vinculos', vinc);
END;
$$;

REVOKE ALL ON FUNCTION public.eletropostos_detalhe(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_detalhe(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.eletropostos_assertividade(p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE per record; _por_fonte jsonb; _por_local jsonb; _ciclos jsonb;   -- com _ : não colidem com as colunas
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT * INTO per FROM public.eletropostos_periodo(p_de, p_ate);

  -- por fonte: ciclos, situação e leituras lidas × esperadas (máximo visto no período)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fonte', fonte, 'ciclos', ciclos, 'ok', oks, 'parciais', parciais, 'falhas', falhas,
           'leituras', leituras, 'esperado_por_ciclo', esperado,
           'taxa_ciclos_ok', CASE WHEN ciclos > 0 THEN oks::numeric / ciclos END,
           'taxa_leitura', CASE WHEN ciclos * esperado > 0 THEN least(1, leituras::numeric / (ciclos * esperado)) END,
           'ultimo_ok', ultimo_ok) ORDER BY fonte), '[]'::jsonb)
    INTO _por_fonte
    FROM (SELECT fonte, count(*) AS ciclos,
                 count(*) FILTER (WHERE ok) AS oks,
                 count(*) FILTER (WHERE NOT ok AND n > 0) AS parciais,
                 count(*) FILTER (WHERE NOT ok AND n = 0) AS falhas,
                 COALESCE(sum(n), 0) AS leituras,
                 -- esperado por ciclo = MEDIANA dos ciclos com leitura (o máximo penalizava o rodízio do ATM)
                 COALESCE(ceil(percentile_cont(0.5) WITHIN GROUP (ORDER BY n) FILTER (WHERE n > 0)), 0)::integer AS esperado,
                 max(ts_utc) FILTER (WHERE ok) AS ultimo_ok
            FROM public.eletroposto_varredura WHERE ts_utc >= per.a AND ts_utc < per.b GROUP BY fonte) f;

  -- por local: leituras obtidas × tentativas (ciclos da fonte com alguma leitura) × conectores lidos
  WITH tent AS (
    -- minutos em que a fonte esteve lendo = ciclos com leitura × passo da fonte
    SELECT v.fonte, count(*) FILTER (WHERE v.n > 0) AS ciclos_com_leitura,
           count(*) FILTER (WHERE v.n > 0) * public.eletropostos_passo(v.fonte) AS minutos_lendo
      FROM public.eletroposto_varredura v WHERE v.ts_utc >= per.a AND v.ts_utc < per.b GROUP BY v.fonte
  ),
  lidas AS (
    SELECT le.fonte, le.local_fonte, count(*) AS leituras, count(DISTINCT le.conector) AS conectores,
           count(*) FILTER (WHERE le.status = 'desconhecido') AS ilegiveis,
           -- passo do local: o da leitura (ex.: AC a cada 16 min), senão o da fonte
           max(COALESCE(le.passo_min, public.eletropostos_passo(le.fonte))) AS passo_local
      FROM public.eletroposto_leitura le WHERE le.slot >= per.a AND le.slot < per.b GROUP BY le.fonte, le.local_fonte
  ),
  falhas AS (
    SELECT v.fonte, f.nome, count(*) AS n, (array_agg(f.erro ORDER BY v.id DESC))[1] AS ultimo_erro,
           max(v.ts_utc) AS ultima
      FROM public.eletroposto_varredura v CROSS JOIN LATERAL public.eletropostos_falhas_do_ciclo(v) f
     WHERE v.ts_utc >= per.a AND v.ts_utc < per.b
     GROUP BY v.fonte, f.nome
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fonte', fl.fonte, 'local_fonte', fl.local_fonte, 'nome', COALESCE(fl.nome, fl.local_fonte),
           'local_id', fl.local_id, 'cadastro', el.nome,
           'leituras', COALESCE(li.leituras, 0), 'conectores', COALESCE(li.conectores, 0),
           'ilegiveis', COALESCE(li.ilegiveis, 0),
           'passo_min', li.passo_local,
           -- tentativas esperadas para ESTE local = minutos em que a fonte leu ÷ passo do local
           'tentativas', COALESCE(round(t.minutos_lendo::numeric / NULLIF(li.passo_local, 0)), 0),
           'taxa', CASE WHEN COALESCE(t.minutos_lendo, 0) > 0 AND COALESCE(li.passo_local, 0) > 0
                        THEN least(1, COALESCE(li.leituras, 0)::numeric
                                      / (GREATEST(round(t.minutos_lendo::numeric / li.passo_local), 1) * GREATEST(COALESCE(li.conectores, 0), 1))) END,
           'falhas', COALESCE(fa.n, 0), 'ultimo_erro', fa.ultimo_erro, 'ultima_falha', fa.ultima)
         ORDER BY fl.fonte, COALESCE(fl.nome, fl.local_fonte)), '[]'::jsonb)
    INTO _por_local
    FROM public.eletroposto_fonte_local fl
    LEFT JOIN public.eletroposto_local el ON el.id = fl.local_id
    LEFT JOIN lidas li ON li.fonte = fl.fonte AND li.local_fonte = fl.local_fonte
    LEFT JOIN tent t ON t.fonte = fl.fonte
    LEFT JOIN falhas fa ON fa.fonte = fl.fonte AND lower(fa.nome) = lower(COALESCE(fl.nome, fl.local_fonte))
   WHERE li.leituras IS NOT NULL OR fa.n IS NOT NULL;

  -- linha do tempo das últimas 24 h (independe do período): um ponto por ciclo
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ts', ts_utc, 'fonte', fonte, 'n', n,
           'situacao', CASE WHEN ok THEN 'ok' WHEN n > 0 THEN 'parcial' ELSE 'falha' END,
           'erro', left(erro, 160)) ORDER BY ts_utc), '[]'::jsonb)
    INTO _ciclos
    FROM public.eletroposto_varredura WHERE ts_utc >= now() - interval '24 hours';

  RETURN jsonb_build_object('periodo', jsonb_build_object('de', least(p_de, p_ate), 'ate', greatest(p_de, p_ate)),
                            'por_fonte', _por_fonte, 'por_local', _por_local, 'ciclos_24h', _ciclos);
END;
$$;

REVOKE ALL ON FUNCTION public.eletropostos_assertividade(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_assertividade(date, date) TO authenticated;

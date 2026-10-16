-- ============================================================================
-- Eletropostos — assertividade da leitura (16/10/2026)
--
-- Pedido do usuário: "marca pra mim as falhas de leitura, assim conseguimos
-- mensurar qual a assertividade da leitura". Dois movimentos:
--  1. `eletroposto_varredura.falhas jsonb`: as falhas POR LOCAL de um ciclo,
--     estruturadas — [{nome, erro, local_fonte?, conector?}] — enviadas pelos
--     coletores em `p_falhas`. Até a estação mandar, as falhas são lidas do
--     texto de `erro` ("Nome: erro; Nome2: erro", como o coletor_tela.py monta).
--  2. RPC `eletropostos_assertividade(p_de, p_ate)`: por fonte (ciclos ok /
--     parciais / falhos, leituras lidas vs esperadas) e por local (leituras
--     obtidas vs tentativas, falhas e último erro), mais a linha do tempo das
--     últimas 24 h de ciclos.
-- Vocabulário de um ciclo: ok (ok=true) · parcial (ok=false, n>0) · falha
-- (ok=false, n=0).
-- ============================================================================

ALTER TABLE public.eletroposto_varredura ADD COLUMN IF NOT EXISTS falhas jsonb;

-- ── gravar: aceita as falhas estruturadas ───────────────────────────────────
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
                  conector text, potencia_kw numeric, status_bruto text, status text, upstream_ts text)
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
      (tenant_id, ts_utc, slot, fonte, local_fonte, local_nome, conector, potencia_kw, status_bruto, status, upstream_ts)
    VALUES (_t, _ts, _slot, p_fonte, l.local_fonte, l.local_nome, COALESCE(l.conector, '*'), l.potencia_kw,
            l.status_bruto, COALESCE(l.status, 'desconhecido'), l.upstream_ts)
    ON CONFLICT (slot, fonte, local_fonte, conector) DO UPDATE
      SET ts_utc = EXCLUDED.ts_utc, local_nome = EXCLUDED.local_nome, potencia_kw = EXCLUDED.potencia_kw,
          status_bruto = EXCLUDED.status_bruto, status = EXCLUDED.status, upstream_ts = EXCLUDED.upstream_ts;
    _n := _n + 1;
  END LOOP;

  INSERT INTO public.eletroposto_varredura (tenant_id, ts_utc, fonte, ok, n, erro, falhas)
  VALUES (_t, _ts, p_fonte, p_erro IS NULL, _n, left(p_erro, 300),
          CASE WHEN jsonb_typeof(p_falhas) = 'array' AND jsonb_array_length(p_falhas) > 0 THEN p_falhas END);
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_gravar_interno(text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.eletropostos_gravar_interno(text, jsonb, text);

CREATE OR REPLACE FUNCTION public.eletropostos_gravar(p_fonte text, p_linhas jsonb, p_erro text DEFAULT NULL, p_falhas jsonb DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Só o service role grava leituras de eletropostos';
  END IF;
  RETURN public.eletropostos_gravar_interno(p_fonte, p_linhas, p_erro, p_falhas);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_gravar(text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eletropostos_gravar(text, jsonb, text, jsonb) TO service_role;
DROP FUNCTION IF EXISTS public.eletropostos_gravar(text, jsonb, text);

CREATE OR REPLACE FUNCTION public.eletropostos_gravar_local(p_fonte text, p_linhas jsonb, p_erro text DEFAULT NULL, p_falhas jsonb DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.eletropostos_estacao_ok() THEN
    RAISE EXCEPTION 'permission denied: só a estação registrada grava leituras';
  END IF;
  UPDATE public.eletroposto_estacao SET vista_em = now() WHERE operador = (select auth.uid()) AND ativa;
  RETURN public.eletropostos_gravar_interno(p_fonte, p_linhas, p_erro, p_falhas);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_gravar_local(text, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_gravar_local(text, jsonb, text, jsonb) TO authenticated;
DROP FUNCTION IF EXISTS public.eletropostos_gravar_local(text, jsonb, text);

-- ── falhas de um ciclo, estruturadas ou lidas do texto ──────────────────────
-- Devolve (nome, erro) por falha. Com `falhas` gravado usa ele; senão quebra o
-- texto "Nome: erro; Nome2: erro" (formato do coletor_tela.py, truncado a 300).
CREATE OR REPLACE FUNCTION public.eletropostos_falhas_do_ciclo(v public.eletroposto_varredura)
RETURNS TABLE (nome text, erro text) LANGUAGE sql IMMUTABLE
AS $$
  SELECT x->>'nome', x->>'erro' FROM jsonb_array_elements(v.falhas) x WHERE v.falhas IS NOT NULL
  UNION ALL
  SELECT trim(split_part(t, ': ', 1)), trim(substr(t, position(': ' IN t) + 2))
    FROM regexp_split_to_table(v.erro, '; ') t
   WHERE v.falhas IS NULL AND v.erro IS NOT NULL AND v.n > 0 AND position(': ' IN t) > 0
$$;

-- ── RPC: assertividade ──────────────────────────────────────────────────────
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
    SELECT fonte, count(*) FILTER (WHERE n > 0) AS ciclos_com_leitura
      FROM public.eletroposto_varredura WHERE ts_utc >= per.a AND ts_utc < per.b GROUP BY fonte
  ),
  lidas AS (
    SELECT le.fonte, le.local_fonte, count(*) AS leituras, count(DISTINCT le.conector) AS conectores,
           count(*) FILTER (WHERE le.status = 'desconhecido') AS ilegiveis
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
           'tentativas', COALESCE(t.ciclos_com_leitura, 0),
           'taxa', CASE WHEN COALESCE(t.ciclos_com_leitura, 0) * GREATEST(COALESCE(li.conectores, 0), 1) > 0
                        THEN least(1, COALESCE(li.leituras, 0)::numeric / (t.ciclos_com_leitura * GREATEST(COALESCE(li.conectores, 0), 1))) END,
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

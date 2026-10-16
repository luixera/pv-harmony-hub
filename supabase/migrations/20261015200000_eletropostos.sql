-- ============================================================================
-- Eletropostos — monitor de carregadores de VE (S. J. do Rio Preto e região)
-- Spec: docs/superpowers/specs/2026-10-15-eletropostos-design.md
--
-- Porta do sistema local (Python + SQLite) para o Supabase. As tabelas levam
-- tenant_id do tenant BIBLIOTECA (GD Manager) — o cadastro é editável, então
-- não cabe no critério do ADR 0009. Leitura só master; escrita só por RPC.
-- Regras de cálculo (intocáveis): janela de 5 min "ocupado" = 5 min de uso;
-- janela sem leitura e conector "fora" saem do denominador; energia e
-- receita são estimadas e sempre em faixa; nenhum dado de motorista.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eletropostos_tenant()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT id FROM public.tenants WHERE is_library LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.eletropostos_tenant() FROM PUBLIC, anon;

-- ── Tabelas ─────────────────────────────────────────────────────────────────
CREATE TABLE public.eletroposto_local (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome               text NOT NULL,
  operadora          text,
  cidade             text,
  endereco           text,
  lat                double precision,
  lng                double precision,
  tipo               text CHECK (tipo IN ('DC', 'AC')),
  potencia_kw        numeric,          -- potência nominal por conector
  conectores         integer,
  preco_kwh          numeric,          -- cobrado do motorista (R$/kWh)
  custo_energia_kwh  numeric,          -- custo da energia para o operador (R$/kWh)
  fonte_status       text,             -- de onde vem a disponibilidade
  observacoes        text,
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eletroposto_local_tenant_idx ON public.eletroposto_local (tenant_id);

-- Como cada fonte identifica um local (preenchido pelos coletores)
CREATE TABLE public.eletroposto_fonte_local (
  tenant_id    uuid NOT NULL DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  fonte        text NOT NULL,
  local_fonte  text NOT NULL,
  nome         text,
  lat          double precision,
  lng          double precision,
  local_id     uuid REFERENCES public.eletroposto_local(id) ON DELETE SET NULL,
  visto_em     timestamptz,
  PRIMARY KEY (fonte, local_fonte)
);
CREATE INDEX eletroposto_fonte_local_local_idx ON public.eletroposto_fonte_local (local_id);

-- Leituras cruas, append-only (uma por janela de 5 min, fonte, local e conector)
CREATE TABLE public.eletroposto_leitura (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ts_utc       timestamptz NOT NULL,
  slot         timestamptz NOT NULL,       -- janela de 5 min (UTC, arredondada para baixo)
  fonte        text NOT NULL,
  local_fonte  text NOT NULL,              -- id do local NA FONTE
  local_nome   text,
  conector     text NOT NULL DEFAULT '*',  -- '*' quando a fonte só informa o local
  potencia_kw  numeric,
  status_bruto text,
  status       text NOT NULL CHECK (status IN ('livre', 'ocupado', 'fora', 'desconhecido')),
  upstream_ts  text,
  UNIQUE (slot, fonte, local_fonte, conector)
);
CREATE INDEX eletroposto_leitura_slot_idx ON public.eletroposto_leitura (slot);
CREATE INDEX eletroposto_leitura_fonte_idx ON public.eletroposto_leitura (fonte, local_fonte, slot);

CREATE TABLE public.eletroposto_varredura (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ts_utc     timestamptz NOT NULL DEFAULT now(),
  fonte      text NOT NULL,
  ok         boolean NOT NULL,
  n          integer NOT NULL DEFAULT 0,
  erro       text
);
CREATE INDEX eletroposto_varredura_fonte_idx ON public.eletroposto_varredura (fonte, ts_utc DESC);

CREATE TABLE public.eletroposto_premissas (
  tenant_id  uuid PRIMARY KEY DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  valores    jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Estação local (PC com o BlueStacks): entra como um usuário staff dedicado
CREATE TABLE public.eletroposto_estacao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  operador   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vista_em   timestamptz,
  ativa      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Isolamento RESTRICTIVE por tenant (regra da casa) + leitura só master.
-- Nenhuma política de escrita para authenticated: só as RPCs escrevem.
DO $rls$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['eletroposto_local', 'eletroposto_fonte_local', 'eletroposto_leitura',
                               'eletroposto_varredura', 'eletroposto_premissas', 'eletroposto_estacao'])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (tenant_id = public.get_user_tenant_id((select auth.uid())))
         WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())))', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_master(auth.uid())))',
      t || '_master_le', t);
  END LOOP;
END $rls$;

-- ── Premissas padrão (os valores do servidor.py) ────────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_premissas_padrao()
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$ SELECT '{
  "dc_fator_min": 0.60, "dc_fator_max": 0.80,
  "ac_kw_min": 6.6, "ac_kw_max": 11.0,
  "ac_fator_min": 0.60, "ac_fator_max": 0.80,
  "preco_kwh_padrao": 2.12,
  "custo_energia_kwh_padrao": 0.90
}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.eletropostos_premissas()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.eletropostos_premissas_padrao()
      || COALESCE((SELECT valores FROM public.eletroposto_premissas WHERE tenant_id = public.eletropostos_tenant()), '{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.eletropostos_premissas() FROM PUBLIC, anon;

-- ── Seed: 72 locais do levantamento (config/inventario.csv, PlugShare out/2026)
INSERT INTO public.eletroposto_local (nome, cidade, lat, lng, tipo, conectores, operadora, fonte_status) VALUES
  ('Bady Bassit Posto HM 40kw', 'Bady Bassitt', -20.899, -49.439, 'DC', 1, 'Spott', 'Só app de celular'),
  ('Eletroposto 60kW Rede FF', 'Mirassol', -20.808, -49.504, 'DC', 2, 'sem rede', 'Nenhuma'),
  ('Posto HM Mirassol 40kW', 'Mirassol', -20.802, -49.505, 'DC', 1, 'Spott', 'Só app de celular'),
  ('Posto Monte Carlo', 'Mirassol', -20.814, -49.482, 'DC', 2, 'HS/RM (Tupi)', 'Mapa público Tupi – por conector'),
  ('Supermercado Antunes Loja 01', 'Mirassol', -20.814, -49.509, 'DC', 2, 'ATM EVS', 'App web com login (a testar)'),
  ('Audi Center', 'São José do Rio Preto', -20.854, -49.415, 'DC', 3, 'sem rede', 'Nenhuma'),
  ('BYD Allma', 'São José do Rio Preto', -20.821, -49.399, 'DC', 2, 'Tupi', 'Mapa público Tupi – por conector'),
  ('Carreg. Super Rápido R.Preto 80kW + 60kW', 'São José do Rio Preto', -20.803, -49.411, 'DC', 4, 'Spott', 'Só app de celular'),
  ('ChargeOn - Atacadão', 'São José do Rio Preto', -20.820, -49.373, 'DC', 1, 'ChargeOn', 'Só app de celular'),
  ('Charger Pro - Empório Jota 60kW', 'São José do Rio Preto', -20.808, -49.348, 'DC', 2, 'Tupi', 'Mapa público Tupi – por conector'),
  ('Cia Charge 60KW Madero (Rod. Washington Luís)', 'São José do Rio Preto', -20.815, -49.458, 'DC', 2, 'Cia Charge (Tupi)', 'Mapa público Tupi – por conector'),
  ('Eko Business Park', 'São José do Rio Preto', -20.820, -49.396, 'DC', 2, 'ATM EVS', 'App web com login (a testar)'),
  ('Eletroposto Kinsol - Rio Preto 2S', 'São José do Rio Preto', -20.821, -49.384, 'DC', 1, 'EvoltBR', 'Só app de celular'),
  ('Georgina Business Park Estacionamento', 'São José do Rio Preto', -20.845, -49.400, 'DC', 2, 'ATM EVS', 'App web com login (a testar)'),
  ('Madero', 'São José do Rio Preto', -20.812, -49.377, 'DC', 2, 'sem rede', 'Nenhuma'),
  ('Madero Container (em reparo)', 'São José do Rio Preto', -20.830, -49.404, 'DC', 2, 'sem rede', 'Nenhuma'),
  ('Max Atacadista Eldorado', 'São José do Rio Preto', -20.789, -49.411, 'DC', 4, 'ATM EVS', 'App web com login (a testar)'),
  ('Max Atacadista Potirendaba', 'São José do Rio Preto', -20.840, -49.370, 'DC', 4, 'ATM EVS', 'App web com login (a testar)'),
  ('Max Atacadista Zona Norte', 'São José do Rio Preto', -20.781, -49.379, 'DC', 7, 'ATM EVS', 'App web com login (a testar)'),
  ('Posto Brazilian', 'São José do Rio Preto', -20.803, -49.359, 'DC', 2, 'ATM EVS', 'App web com login (a testar)'),
  ('Posto Brazilian Convenience Talhado', 'São José do Rio Preto', -20.761, -49.344, 'DC', 2, 'ATM EVS', 'App web com login (a testar)'),
  ('Posto Brazilian JK (ATM EVs)', 'São José do Rio Preto', -20.851, -49.413, 'DC', 7, 'ATM EVS', 'App web com login (a testar)'),
  ('Posto Carrefour', 'São José do Rio Preto', -20.833, -49.355, 'DC', 1, 'ChargeOn', 'Só app de celular'),
  ('Sam''s Club', 'São José do Rio Preto', -20.825, -49.385, 'DC', 3, 'EZVolt', 'PlugShare – por local'),
  ('Super Muffato Damha', 'São José do Rio Preto', -20.800, -49.345, 'DC', 7, 'ATM EVS', 'App web com login (a testar)'),
  ('Super Muffato JK', 'São José do Rio Preto', -20.831, -49.406, 'DC', 4, 'ATM EVS', 'App web com login (a testar)'),
  ('The Week - Cury Energia 80kW', 'São José do Rio Preto', -20.856, -49.413, 'DC', 1, 'Spott', 'Só app de celular'),
  ('Auto Posto Mamian e JK Conveniência', 'Mirassol', -20.807, -49.507, 'AC', 1, NULL, NULL),
  ('Constru-Sol', 'Mirassol', -20.808, -49.505, 'AC', 1, NULL, NULL),
  ('G Auto Posto', 'Mirassol', -20.809, -49.507, 'AC', 1, NULL, NULL),
  ('Sup Alfredo Antunes Loja 01', 'Mirassol', -20.814, -49.509, 'AC', 1, NULL, NULL),
  ('Sup. Empório Alfredo Antunes Lj04', 'Mirassol', -20.805, -49.490, 'AC', 1, NULL, NULL),
  ('Aeroporto São José do Rio Preto', 'São José do Rio Preto', -20.812, -49.405, 'AC', 2, NULL, NULL),
  ('Automotiva Rio Preto (em reparo)', 'São José do Rio Preto', -20.788, -49.376, 'AC', 1, NULL, NULL),
  ('Bosch Car Service - Mecânica Fabio', 'São José do Rio Preto', -20.841, -49.369, 'AC', 1, NULL, NULL),
  ('Capelas Prever', 'São José do Rio Preto', -20.814, -49.413, 'AC', 2, NULL, NULL),
  ('Cemitério Jardim da Paz', 'São José do Rio Preto', -20.845, -49.391, 'AC', 1, NULL, NULL),
  ('Churrascaria Batistella', 'São José do Rio Preto', -20.796, -49.356, 'AC', 1, NULL, NULL),
  ('Corpore Rio Preto', 'São José do Rio Preto', -20.853, -49.412, 'AC', 1, NULL, NULL),
  ('EB Hotel Green Fields', 'São José do Rio Preto', -20.851, -49.403, 'AC', 1, NULL, NULL),
  ('EB Hotel Green Fields 2', 'São José do Rio Preto', -20.851, -49.403, 'AC', 1, NULL, NULL),
  ('EcoNoroeste SAU 08 - SP310 km 443', 'São José do Rio Preto', -20.822, -49.424, 'AC', 1, NULL, NULL),
  ('Empório Jota', 'São José do Rio Preto', -20.808, -49.347, 'AC', 1, NULL, NULL),
  ('Estacionamento Farroupilha', 'São José do Rio Preto', -20.829, -49.398, 'AC', 1, NULL, NULL),
  ('Estacionamento Renascer & Jales Imóveis', 'São José do Rio Preto', -20.854, -49.412, 'AC', 1, NULL, NULL),
  ('Fort Luz Materiais Elétricos', 'São José do Rio Preto', -20.800, -49.368, 'AC', 3, NULL, NULL),
  ('Frulle', 'São José do Rio Preto', -20.853, -49.412, 'AC', 1, NULL, NULL),
  ('Georgina Business Park', 'São José do Rio Preto', -20.845, -49.401, 'AC', 1, NULL, NULL),
  ('Grupo Impper - Av. JK', 'São José do Rio Preto', -20.853, -49.413, 'AC', 1, NULL, NULL),
  ('Hilton Garden Inn', 'São José do Rio Preto', -20.846, -49.402, 'AC', 2, NULL, NULL),
  ('Hotel Euro Suite', 'São José do Rio Preto', -20.826, -49.406, 'AC', 1, NULL, NULL),
  ('Hotel Nacional De Rio Preto', 'São José do Rio Preto', -20.824, -49.367, 'AC', 1, NULL, NULL),
  ('Hub House Automação Residencial', 'São José do Rio Preto', -20.805, -49.344, 'AC', 1, NULL, NULL),
  ('Ipê Park Hotel', 'São José do Rio Preto', -20.888, -49.311, 'AC', 1, NULL, NULL),
  ('Javep Chevrolet', 'São José do Rio Preto', -20.841, -49.395, 'AC', 1, NULL, NULL),
  ('LUPEMA - L. Store', 'São José do Rio Preto', -20.825, -49.408, 'AC', 1, NULL, NULL),
  ('Max Atacadista (em reparo)', 'São José do Rio Preto', -20.781, -49.379, 'AC', 1, NULL, NULL),
  ('Molecaggio - Pq das Amoras II', 'São José do Rio Preto', -20.859, -49.314, 'AC', 1, NULL, NULL),
  ('Neo7 Motors', 'São José do Rio Preto', -20.824, -49.390, 'AC', 1, NULL, NULL),
  ('O Rei do Pão de Queijo - Av. Bady Bassitt', 'São José do Rio Preto', -20.810, -49.384, 'AC', 1, NULL, NULL),
  ('Posto Continental', 'São José do Rio Preto', -20.814, -49.380, 'AC', 1, NULL, NULL),
  ('Quinta Jardins uso coletivo', 'São José do Rio Preto', -20.858, -49.419, 'AC', 1, NULL, NULL),
  ('Rancho do Cupim', 'São José do Rio Preto', -20.834, -49.406, 'AC', 1, NULL, NULL),
  ('SEC Energia Solar', 'São José do Rio Preto', -20.841, -49.410, 'AC', 1, NULL, NULL),
  ('SJP Energy', 'São José do Rio Preto', -20.811, -49.401, 'AC', 2, NULL, NULL),
  ('Saint James Barbearia', 'São José do Rio Preto', -20.844, -49.396, 'AC', 1, NULL, NULL),
  ('Serv-Seg Distribuidora - Intelbras', 'São José do Rio Preto', -20.823, -49.397, 'AC', 1, NULL, NULL),
  ('Shopping Iguatemi', 'São José do Rio Preto', -20.866, -49.414, 'AC', 2, NULL, 'Mapa público Tupi – por conector'),
  ('Shopping Iguatemi São José do Rio Preto (em reparo)', 'São José do Rio Preto', -20.866, -49.415, 'AC', 4, NULL, NULL),
  ('Shopping Plaza Avenida', 'São José do Rio Preto', -20.828, -49.387, 'AC', 1, NULL, NULL),
  ('Super Muffato Gourmet', 'São José do Rio Preto', -20.819, -49.390, 'AC', 1, NULL, NULL),
  ('Supermercado Kabral Schmitt', 'São José do Rio Preto', -20.861, -49.313, 'AC', 1, NULL, NULL);

INSERT INTO public.eletroposto_premissas (valores) VALUES ('{}'::jsonb);

-- ── Utilitários de cálculo ──────────────────────────────────────────────────
-- Distância em metros (haversine), para o vínculo automático (≤ 150 m).
CREATE OR REPLACE FUNCTION public.eletropostos_distancia_m(a double precision, b double precision, c double precision, d double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE
AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(c - a) / 2), 2) + cos(radians(a)) * cos(radians(c)) * power(sin(radians(d - b) / 2), 2)))
$$;

-- Energia estimada [min, max] em kWh a partir das horas carregando.
-- DC: potência média = nominal × fator. AC: quem limita é o carro (teto do
-- carregador de bordo) e nem todo o tempo plugado consome (fator).
CREATE OR REPLACE FUNCTION public.eletropostos_energia(horas numeric, kw numeric, tipo text, p jsonb)
RETURNS numeric[] LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN kw IS NULL OR kw = 0 OR horas IS NULL OR horas = 0 THEN ARRAY[0, 0]::numeric[]
    WHEN upper(COALESCE(tipo, 'DC')) = 'AC' THEN ARRAY[
      horas * least(kw, (p->>'ac_kw_min')::numeric) * (p->>'ac_fator_min')::numeric,
      horas * least(kw, (p->>'ac_kw_max')::numeric) * (p->>'ac_fator_max')::numeric]
    ELSE ARRAY[horas * kw * (p->>'dc_fator_min')::numeric, horas * kw * (p->>'dc_fator_max')::numeric]
  END
$$;

-- ── Escrita (coletores) ─────────────────────────────────────────────────────
-- Uma varredura de uma fonte: upsert de fonte_local (vínculo automático só no
-- PRIMEIRO avistamento do par), leituras da janela corrente e a linha de
-- varredura. Mesma semântica de gravar() + registrar_local_fonte() do Python.
-- p_linhas: [{local_fonte, local_nome, lat, lng, conector, potencia_kw,
--             status_bruto, status, upstream_ts}]
CREATE OR REPLACE FUNCTION public.eletropostos_gravar_interno(p_fonte text, p_linhas jsonb, p_erro text)
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

  INSERT INTO public.eletroposto_varredura (tenant_id, ts_utc, fonte, ok, n, erro)
  VALUES (_t, _ts, p_fonte, p_erro IS NULL, _n, left(p_erro, 300));
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_gravar_interno(text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- VPS (worker da Ludmilla): só service role.
CREATE OR REPLACE FUNCTION public.eletropostos_gravar(p_fonte text, p_linhas jsonb, p_erro text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Só o service role grava leituras de eletropostos';
  END IF;
  RETURN public.eletropostos_gravar_interno(p_fonte, p_linhas, p_erro);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_gravar(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eletropostos_gravar(text, jsonb, text) TO service_role;

-- Estação local: só o operador de uma estação ativa (padrão `_local` da Ludmilla).
CREATE OR REPLACE FUNCTION public.eletropostos_estacao_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.eletroposto_estacao e
                  WHERE e.operador = (select auth.uid()) AND e.ativa
                    AND e.tenant_id = public.get_user_tenant_id((select auth.uid())))
$$;
REVOKE ALL ON FUNCTION public.eletropostos_estacao_ok() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.eletropostos_gravar_local(p_fonte text, p_linhas jsonb, p_erro text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.eletropostos_estacao_ok() THEN
    RAISE EXCEPTION 'permission denied: só a estação registrada grava leituras';
  END IF;
  UPDATE public.eletroposto_estacao SET vista_em = now() WHERE operador = (select auth.uid()) AND ativa;
  RETURN public.eletropostos_gravar_interno(p_fonte, p_linhas, p_erro);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_gravar_local(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_gravar_local(text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.eletropostos_estacao_pulsa()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.eletropostos_estacao_ok() THEN
    RAISE EXCEPTION 'permission denied: estação não registrada';
  END IF;
  UPDATE public.eletroposto_estacao SET vista_em = now() WHERE operador = (select auth.uid()) AND ativa;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_estacao_pulsa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_estacao_pulsa() TO authenticated;

-- ── Leitura: métricas por conector ──────────────────────────────────────────
-- Porta de metricas_conector(): contagens por status na janela [a, b), sessões
-- (início de "ocupado" sem "ocupado" na janela imediatamente anterior), último
-- status e última potência informada. `cad` é o local do cadastro (pode ser
-- nulo: lido mas sem vínculo).
CREATE TYPE public.eletroposto_conector_agg AS (
  cad uuid, fonte text, local_fonte text, conector text,
  livre integer, ocupado integer, fora integer, desconhecido integer, sessoes integer,
  ultimo_status text, ultimo_bruto text, ultima_leitura timestamptz, potencia_kw numeric
);

CREATE OR REPLACE FUNCTION public.eletropostos_conectores(a timestamptz, b timestamptz, p_local uuid DEFAULT NULL)
RETURNS SETOF public.eletroposto_conector_agg
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH l AS (
    SELECT le.slot, le.fonte, le.local_fonte, le.conector, le.potencia_kw, le.status, le.status_bruto,
           fl.local_id AS cad,
           lag(le.status) OVER w AS st_ant, lag(le.slot) OVER w AS slot_ant
      FROM public.eletroposto_leitura le
      LEFT JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
     WHERE le.slot >= a AND le.slot < b
       AND (p_local IS NULL OR fl.local_id = p_local)
    WINDOW w AS (PARTITION BY le.fonte, le.local_fonte, le.conector ORDER BY le.slot)
  )
  SELECT cad, fonte, local_fonte, conector,
         count(*) FILTER (WHERE status = 'livre')::integer,
         count(*) FILTER (WHERE status = 'ocupado')::integer,
         count(*) FILTER (WHERE status = 'fora')::integer,
         count(*) FILTER (WHERE status = 'desconhecido')::integer,
         count(*) FILTER (WHERE status = 'ocupado'
                            AND NOT COALESCE(st_ant = 'ocupado' AND slot - slot_ant <= interval '5 minutes', false))::integer,
         (array_agg(status ORDER BY slot DESC))[1],
         (array_agg(status_bruto ORDER BY slot DESC))[1],
         max(slot),
         (array_agg(potencia_kw ORDER BY slot DESC) FILTER (WHERE potencia_kw IS NOT NULL))[1]
    FROM l
   GROUP BY cad, fonte, local_fonte, conector
$$;
REVOKE ALL ON FUNCTION public.eletropostos_conectores(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- Métricas de um conector em JSON (porta do dicionário de metricas_conector).
CREATE OR REPLACE FUNCTION public.eletropostos_metricas(c public.eletroposto_conector_agg, esperadas integer)
RETURNS jsonb LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'horas_ocupado',     c.ocupado * 5 / 60.0,
    'horas_observadas',  (c.livre + c.ocupado) * 5 / 60.0,
    'horas_fora',        c.fora * 5 / 60.0,
    'ocupacao',          CASE WHEN c.livre + c.ocupado > 0 THEN c.ocupado::numeric / (c.livre + c.ocupado) END,
    'cobertura',         CASE WHEN esperadas > 0 THEN least(1, (c.livre + c.ocupado + c.fora)::numeric / esperadas) END,
    'sessoes',           c.sessoes,
    'duracao_media_min', CASE WHEN c.sessoes > 0 THEN c.ocupado * 5.0 / c.sessoes END,
    'ultimo_status',     c.ultimo_status,
    'ultimo_bruto',      c.ultimo_bruto,
    'ultima_leitura',    c.ultima_leitura,
    'potencia_kw',       c.potencia_kw)
$$;

-- Período em horário de Brasília → [a, b) em UTC, e janelas esperadas.
CREATE OR REPLACE FUNCTION public.eletropostos_periodo(p_de date, p_ate date, OUT a timestamptz, OUT b timestamptz, OUT esperadas integer, OUT dias numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _de date := least(p_de, p_ate); _ate date := greatest(p_de, p_ate); _min timestamptz; _ini timestamptz; _fim timestamptz;
BEGIN
  a := _de::timestamp AT TIME ZONE 'America/Sao_Paulo';
  b := (_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  SELECT min(slot) INTO _min FROM public.eletroposto_leitura;
  IF _min IS NULL THEN
    esperadas := 0;
  ELSE
    _ini := greatest(a, _min); _fim := least(b, now());
    esperadas := greatest(0, floor(extract(epoch FROM (_fim - _ini)) / 300)::integer + 1);
  END IF;
  dias := CASE WHEN esperadas > 0 THEN greatest(esperadas * 5 / 1440.0, 1 / 288.0) ELSE (_ate - _de + 1) END;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_periodo(date, date) FROM PUBLIC, anon, authenticated;

-- Um local com seus conectores agregados (porta de montar_local()).
-- `cons` é um array JSON de {fonte, local_fonte, conector, m} — `m` ganha kwh_min/max.
CREATE OR REPLACE FUNCTION public.eletropostos_montar_local(loc public.eletroposto_local, cons jsonb, p jsonb, dias numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  c jsonb; m jsonb; e numeric[]; kw numeric; preco numeric; custo numeric;
  h_oc numeric := 0; h_obs numeric := 0; sess integer := 0; kmin numeric := 0; kmax numeric := 0;
  cob_soma numeric := 0; cob_n integer := 0;
  agora jsonb := '{}'::jsonb; st text;
  cons_out jsonb := '[]'::jsonb;
  n integer := COALESCE(jsonb_array_length(cons), 0);
BEGIN
  kw := loc.potencia_kw;
  IF kw IS NULL THEN
    SELECT (x->'m'->>'potencia_kw')::numeric INTO kw FROM jsonb_array_elements(COALESCE(cons, '[]'::jsonb)) x
     WHERE x->'m'->>'potencia_kw' IS NOT NULL LIMIT 1;
  END IF;
  preco := COALESCE(loc.preco_kwh, (p->>'preco_kwh_padrao')::numeric);
  custo := COALESCE(loc.custo_energia_kwh, (p->>'custo_energia_kwh_padrao')::numeric);

  FOR c IN SELECT x FROM jsonb_array_elements(COALESCE(cons, '[]'::jsonb)) x LOOP
    m := c->'m';
    e := public.eletropostos_energia((m->>'horas_ocupado')::numeric, COALESCE(loc.potencia_kw, (m->>'potencia_kw')::numeric), loc.tipo, p);
    m := m || jsonb_build_object('kwh_min', e[1], 'kwh_max', e[2]);
    h_oc := h_oc + (m->>'horas_ocupado')::numeric;
    h_obs := h_obs + (m->>'horas_observadas')::numeric;
    sess := sess + (m->>'sessoes')::integer;
    kmin := kmin + e[1]; kmax := kmax + e[2];
    IF m->>'cobertura' IS NOT NULL THEN cob_soma := cob_soma + (m->>'cobertura')::numeric; cob_n := cob_n + 1; END IF;
    st := COALESCE(m->>'ultimo_status', 'desconhecido');
    agora := agora || jsonb_build_object(st, COALESCE((agora->>st)::integer, 0) + 1);
    cons_out := cons_out || jsonb_build_array(c || jsonb_build_object('m', m));
  END LOOP;

  RETURN to_jsonb(loc) || jsonb_build_object(
    'potencia_kw', kw,
    'preco_efetivo', preco, 'custo_efetivo', custo,
    'preco_estimado', loc.preco_kwh IS NULL, 'custo_estimado', loc.custo_energia_kwh IS NULL,
    'monitorado', n > 0,
    'conectores_monitorados', n,
    'conectores_detalhe', cons_out,
    'horas_ocupado', h_oc,
    'horas_ocupado_dia', CASE WHEN dias > 0 THEN h_oc / dias ELSE 0 END,
    'ocupacao', CASE WHEN h_obs > 0 THEN h_oc / h_obs END,
    'cobertura', CASE WHEN cob_n > 0 THEN cob_soma / cob_n END,
    'sessoes', sess,
    'kwh_min', kmin, 'kwh_max', kmax,
    'receita_min', kmin * preco, 'receita_max', kmax * preco,
    'custo_min', kmin * custo, 'custo_max', kmax * custo,
    'margem_min', kmin * (preco - custo), 'margem_max', kmax * (preco - custo),
    'agora', agora);
END;
$$;

-- ── RPC: resumo (Visão geral, Carregadores, Mapa) ───────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_resumo(p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  per record; p jsonb; locais jsonb; kpis jsonb; nv jsonb;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT * INTO per FROM public.eletropostos_periodo(p_de, p_ate);
  p := public.eletropostos_premissas();

  WITH cons AS (
    SELECT c.cad, jsonb_agg(jsonb_build_object('fonte', c.fonte, 'local_fonte', c.local_fonte, 'conector', c.conector,
                                               'm', public.eletropostos_metricas(c, per.esperadas))
                            ORDER BY c.fonte, c.local_fonte, c.conector) AS arr
      FROM public.eletropostos_conectores(per.a, per.b) c
     WHERE c.cad IS NOT NULL
     GROUP BY c.cad
  ),
  montados AS (
    SELECT public.eletropostos_montar_local(el, COALESCE(cons.arr, '[]'::jsonb), p, per.dias) - 'conectores_detalhe' AS j
      FROM public.eletroposto_local el LEFT JOIN cons ON cons.cad = el.id
     WHERE el.ativo
     ORDER BY el.nome
  )
  SELECT COALESCE(jsonb_agg(j), '[]'::jsonb) INTO locais FROM montados;

  SELECT jsonb_build_object(
    'locais', count(*),
    'locais_dc', count(*) FILTER (WHERE x->>'tipo' = 'DC'),
    'monitorados', count(*) FILTER (WHERE (x->>'monitorado')::boolean),
    'conectores_monitorados', COALESCE(sum((x->>'conectores_monitorados')::integer), 0),
    'horas_ocupado', COALESCE(sum((x->>'horas_ocupado')::numeric) FILTER (WHERE (x->>'monitorado')::boolean), 0),
    'ocupacao_media', CASE WHEN sum(CASE WHEN x->>'ocupacao' IS NOT NULL THEN (x->>'horas_ocupado')::numeric / NULLIF((x->>'ocupacao')::numeric, 0) END) > 0
                           THEN sum((x->>'horas_ocupado')::numeric) FILTER (WHERE x->>'ocupacao' IS NOT NULL)
                              / sum(CASE WHEN x->>'ocupacao' IS NOT NULL THEN (x->>'horas_ocupado')::numeric / NULLIF((x->>'ocupacao')::numeric, 0) END) END,
    'kwh_min', COALESCE(sum((x->>'kwh_min')::numeric), 0), 'kwh_max', COALESCE(sum((x->>'kwh_max')::numeric), 0),
    'receita_min', COALESCE(sum((x->>'receita_min')::numeric), 0), 'receita_max', COALESCE(sum((x->>'receita_max')::numeric), 0),
    'sessoes', COALESCE(sum((x->>'sessoes')::integer), 0),
    'cobertura', avg((x->>'cobertura')::numeric) FILTER (WHERE (x->>'monitorado')::boolean AND x->>'cobertura' IS NOT NULL),
    'agora', jsonb_build_object(
      'livre',        COALESCE(sum(COALESCE((x->'agora'->>'livre')::integer, 0)), 0),
      'ocupado',      COALESCE(sum(COALESCE((x->'agora'->>'ocupado')::integer, 0)), 0),
      'fora',         COALESCE(sum(COALESCE((x->'agora'->>'fora')::integer, 0)), 0),
      'desconhecido', COALESCE(sum(COALESCE((x->'agora'->>'desconhecido')::integer, 0)), 0)),
    'dias', per.dias)
  INTO kpis FROM jsonb_array_elements(locais) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('fonte', fonte, 'local_fonte', local_fonte, 'nome', nome, 'lat', lat, 'lng', lng) ORDER BY nome), '[]'::jsonb)
    INTO nv FROM public.eletroposto_fonte_local WHERE local_id IS NULL;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('de', least(p_de, p_ate), 'ate', greatest(p_de, p_ate)),
    'kpis', kpis, 'locais', locais, 'nao_vinculados', nv, 'premissas', p);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_resumo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_resumo(date, date) TO authenticated;

-- ── RPC: detalhe de um local (painel lateral) ───────────────────────────────
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
  CREATE TEMP TABLE IF NOT EXISTS pg_temp._el (slot_local timestamp, status text, nome text) ON COMMIT DROP;
  TRUNCATE pg_temp._el;   -- não DELETE: o safeupdate do PostgREST recusa DELETE sem WHERE
  INSERT INTO pg_temp._el
  SELECT le.slot AT TIME ZONE 'America/Sao_Paulo', le.status, le.fonte || ' · ' || le.local_fonte || ' · ' || le.conector
    FROM public.eletroposto_leitura le
    JOIN public.eletroposto_fonte_local fl ON fl.fonte = le.fonte AND fl.local_fonte = le.local_fonte
   WHERE fl.local_id = p_local AND le.slot >= per.a AND le.slot < per.b;

  -- série diária (todos os dias do período, mesmo sem leitura)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dia', d.dia::date, 'horas_ocupado', s.oc * 5 / 60.0, 'horas_observadas', s.ob * 5 / 60.0,
           'ocupacao', CASE WHEN s.ob > 0 THEN s.oc::numeric / s.ob END,
           'receita_min', e.e[1] * preco, 'receita_max', e.e[2] * preco) ORDER BY d.dia), '[]'::jsonb)
    INTO diario
    FROM generate_series(least(p_de, p_ate), greatest(p_de, p_ate), interval '1 day') AS d(dia)
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE status = 'ocupado') AS oc, count(*) FILTER (WHERE status IN ('livre', 'ocupado')) AS ob
        FROM pg_temp._el WHERE slot_local::date = d.dia::date) s
    CROSS JOIN LATERAL (SELECT public.eletropostos_energia(s.oc * 5 / 60.0, kw, loc.tipo, p) AS e) e;

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

-- ── RPC: estado da coleta ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_coleta()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN NOT public.is_master(auth.uid()) THEN NULL ELSE jsonb_build_object(
    'fontes', COALESCE((SELECT jsonb_agg(f ORDER BY f->>'fonte') FROM (
                SELECT jsonb_build_object('fonte', fonte, 'ultima', max(ts_utc), 'oks', count(*) FILTER (WHERE ok),
                                          'total', count(*), 'ultima_ok', max(ts_utc) FILTER (WHERE ok)) f
                  FROM public.eletroposto_varredura GROUP BY fonte) z), '[]'::jsonb),
    'erros', COALESCE((SELECT jsonb_agg(jsonb_build_object('ts_utc', ts_utc, 'fonte', fonte, 'erro', erro) ORDER BY id DESC) FROM (
                SELECT id, ts_utc, fonte, erro FROM public.eletroposto_varredura WHERE NOT ok ORDER BY id DESC LIMIT 15) z), '[]'::jsonb),
    'por_dia', COALESCE((SELECT jsonb_agg(jsonb_build_object('dia', dia, 'fonte', fonte, 'leituras', n) ORDER BY dia DESC, fonte) FROM (
                SELECT (slot AT TIME ZONE 'America/Sao_Paulo')::date AS dia, fonte, count(*) n
                  FROM public.eletroposto_leitura GROUP BY 1, 2 ORDER BY dia DESC LIMIT 60) z), '[]'::jsonb),
    'inicio', (SELECT min(slot) FROM public.eletroposto_leitura),
    'total_leituras', (SELECT count(*) FROM public.eletroposto_leitura),
    'estacoes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'vista_em', vista_em, 'ativa', ativa)) FROM public.eletroposto_estacao), '[]'::jsonb),
    'agora', now()) END
$$;
REVOKE ALL ON FUNCTION public.eletropostos_coleta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_coleta() TO authenticated;

-- ── RPC: cadastro de local (cria ou atualiza as chaves presentes) ───────────
CREATE OR REPLACE FUNCTION public.eletropostos_local_salvar(p_local jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id uuid := (p_local->>'id')::uuid;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.eletroposto_local (nome, cidade, tipo)
    VALUES (COALESCE(NULLIF(p_local->>'nome', ''), 'Novo local'), COALESCE(p_local->>'cidade', 'São José do Rio Preto'), COALESCE(p_local->>'tipo', 'DC'))
    RETURNING id INTO _id;
  END IF;
  UPDATE public.eletroposto_local SET
    nome              = CASE WHEN p_local ? 'nome' THEN COALESCE(NULLIF(p_local->>'nome', ''), nome) ELSE nome END,
    operadora         = CASE WHEN p_local ? 'operadora' THEN NULLIF(p_local->>'operadora', '') ELSE operadora END,
    cidade            = CASE WHEN p_local ? 'cidade' THEN NULLIF(p_local->>'cidade', '') ELSE cidade END,
    endereco          = CASE WHEN p_local ? 'endereco' THEN NULLIF(p_local->>'endereco', '') ELSE endereco END,
    lat               = CASE WHEN p_local ? 'lat' THEN (p_local->>'lat')::double precision ELSE lat END,
    lng               = CASE WHEN p_local ? 'lng' THEN (p_local->>'lng')::double precision ELSE lng END,
    tipo              = CASE WHEN p_local ? 'tipo' THEN NULLIF(p_local->>'tipo', '') ELSE tipo END,
    potencia_kw       = CASE WHEN p_local ? 'potencia_kw' THEN (p_local->>'potencia_kw')::numeric ELSE potencia_kw END,
    conectores        = CASE WHEN p_local ? 'conectores' THEN (p_local->>'conectores')::integer ELSE conectores END,
    preco_kwh         = CASE WHEN p_local ? 'preco_kwh' THEN (p_local->>'preco_kwh')::numeric ELSE preco_kwh END,
    custo_energia_kwh = CASE WHEN p_local ? 'custo_energia_kwh' THEN (p_local->>'custo_energia_kwh')::numeric ELSE custo_energia_kwh END,
    fonte_status      = CASE WHEN p_local ? 'fonte_status' THEN NULLIF(p_local->>'fonte_status', '') ELSE fonte_status END,
    observacoes       = CASE WHEN p_local ? 'observacoes' THEN NULLIF(p_local->>'observacoes', '') ELSE observacoes END,
    ativo             = CASE WHEN p_local ? 'ativo' THEN COALESCE((p_local->>'ativo')::boolean, true) ELSE ativo END,
    atualizado_em     = now()
  WHERE id = _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_local_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_local_salvar(jsonb) TO authenticated;

-- ── RPC: vínculo manual fonte → cadastro ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_vincular(p_fonte text, p_local_fonte text, p_local uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  UPDATE public.eletroposto_fonte_local SET local_id = p_local WHERE fonte = p_fonte AND local_fonte = p_local_fonte;
  IF NOT FOUND THEN RAISE EXCEPTION 'fonte/local não encontrado'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_vincular(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_vincular(text, text, uuid) TO authenticated;

-- ── RPC: premissas (só as chaves conhecidas, como número) ───────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_premissas_salvar(p_valores jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _novo jsonb;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT COALESCE(jsonb_object_agg(k, to_jsonb((v)::numeric)), '{}'::jsonb) INTO _novo
    FROM jsonb_each_text(COALESCE(p_valores, '{}'::jsonb)) AS kv(k, v)
   WHERE public.eletropostos_premissas_padrao() ? k AND v IS NOT NULL;
  INSERT INTO public.eletroposto_premissas (tenant_id, valores, atualizado_em)
  VALUES (public.eletropostos_tenant(), _novo, now())
  ON CONFLICT (tenant_id) DO UPDATE SET valores = public.eletroposto_premissas.valores || _novo, atualizado_em = now();
  RETURN public.eletropostos_premissas();
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_premissas_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_premissas_salvar(jsonb) TO authenticated;

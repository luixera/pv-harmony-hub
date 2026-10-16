-- ============================================================================
-- Eletropostos — configuração da coleta na página (16/10/2026)
--
-- Pedido do usuário: "controle de periodicidade dentro da página, faixa de
-- potência de carregamento e as cidades que estão sendo monitoradas".
--
-- Uma linha de configuração no tenant biblioteca, editada só pelo master:
--   faixas  — [{ate_kw, intervalo_min}] em ordem crescente de ate_kw; a última
--             tem ate_kw = null (tudo acima). A estação escolhe a faixa pela
--             MAIOR potência do carregador e arredonda o intervalo a múltiplos
--             do ciclo de 8 min; a Tupi (VPS) continua em 5 min (API).
--   cidades — cidades do cadastro que são monitoradas. Local vinculado a um
--             cadastro de cidade fora da lista não é lido ("fora").
-- Contrato combinado com a estação: RPC `eletropostos_coleta_config()` devolve
-- {faixas, cidades, fora:[{fonte, local_fonte}]}, chamável pelo master, pelo
-- operador da estação e pela service role (VPS).
-- ============================================================================

CREATE TABLE public.eletroposto_coleta_config (
  tenant_id      uuid PRIMARY KEY DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  faixas         jsonb NOT NULL,
  cidades        text[] NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.eletroposto_coleta_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.eletroposto_coleta_config AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
CREATE POLICY eletroposto_coleta_config_master_le ON public.eletroposto_coleta_config FOR SELECT TO authenticated
  USING ((SELECT public.is_master(auth.uid())));

-- valor inicial: o que a estação já faz hoje (AC até 22 kW a cada 16 min, o resto a cada 8) e as 3 cidades do cadastro
INSERT INTO public.eletroposto_coleta_config (faixas, cidades)
VALUES ('[{"ate_kw": 22, "intervalo_min": 16}, {"ate_kw": null, "intervalo_min": 8}]'::jsonb,
        ARRAY['São José do Rio Preto', 'Mirassol', 'Bady Bassitt']);

-- ── leitura: master, operador da estação ou service role ────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_coleta_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.eletroposto_coleta_config; _fora jsonb;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_master(auth.uid()) OR public.eletropostos_estacao_ok()) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  SELECT * INTO c FROM public.eletroposto_coleta_config WHERE tenant_id = public.eletropostos_tenant();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('faixas', '[{"ate_kw": null, "intervalo_min": 8}]'::jsonb, 'cidades', '[]'::jsonb, 'fora', '[]'::jsonb);
  END IF;
  -- fora: vínculos cujo cadastro é de cidade NÃO monitorada (sem cadastro = monitorado)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('fonte', fl.fonte, 'local_fonte', fl.local_fonte) ORDER BY fl.fonte, fl.local_fonte), '[]'::jsonb)
    INTO _fora
    FROM public.eletroposto_fonte_local fl
    JOIN public.eletroposto_local el ON el.id = fl.local_id
   WHERE el.cidade IS NOT NULL AND NOT (el.cidade = ANY (c.cidades));
  RETURN jsonb_build_object('faixas', c.faixas, 'cidades', to_jsonb(c.cidades), 'fora', _fora, 'atualizado_em', c.atualizado_em);
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_coleta_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_coleta_config() TO authenticated, service_role;

-- ── escrita: só master, com validação ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_coleta_config_salvar(p_faixas jsonb, p_cidades text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE f jsonb; _faixas jsonb; _cid text; _anterior numeric := -1; _abertas integer := 0;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'permission denied'; END IF;
  IF jsonb_typeof(p_faixas) <> 'array' OR jsonb_array_length(p_faixas) = 0 THEN
    RAISE EXCEPTION 'faixas: informe ao menos uma faixa';
  END IF;
  -- normaliza: só as duas chaves, ordem crescente de ate_kw, a aberta (null) por último e única
  SELECT jsonb_agg(jsonb_build_object('ate_kw', (x->>'ate_kw')::numeric, 'intervalo_min', (x->>'intervalo_min')::integer)
                   ORDER BY (x->>'ate_kw')::numeric NULLS LAST)
    INTO _faixas
    FROM jsonb_array_elements(p_faixas) x;
  FOR f IN SELECT x FROM jsonb_array_elements(_faixas) x LOOP
    IF (f->>'intervalo_min') IS NULL OR (f->>'intervalo_min')::integer < 1 OR (f->>'intervalo_min')::integer > 240 THEN
      RAISE EXCEPTION 'faixas: o intervalo deve ficar entre 1 e 240 minutos';
    END IF;
    IF f->>'ate_kw' IS NULL THEN
      _abertas := _abertas + 1;
    ELSE
      IF (f->>'ate_kw')::numeric <= _anterior THEN RAISE EXCEPTION 'faixas: os limites de kW devem ser crescentes e distintos'; END IF;
      _anterior := (f->>'ate_kw')::numeric;
    END IF;
  END LOOP;
  IF _abertas <> 1 THEN RAISE EXCEPTION 'faixas: precisa de exatamente uma faixa "acima de tudo" (ate_kw nulo)'; END IF;

  IF p_cidades IS NULL OR cardinality(p_cidades) = 0 THEN RAISE EXCEPTION 'cidades: escolha ao menos uma cidade'; END IF;
  FOREACH _cid IN ARRAY p_cidades LOOP
    IF NOT EXISTS (SELECT 1 FROM public.eletroposto_local WHERE cidade = _cid) THEN
      RAISE EXCEPTION 'cidades: "%" não existe no cadastro', _cid;
    END IF;
  END LOOP;

  INSERT INTO public.eletroposto_coleta_config (tenant_id, faixas, cidades, atualizado_em)
  VALUES (public.eletropostos_tenant(), _faixas, p_cidades, now())
  ON CONFLICT (tenant_id) DO UPDATE SET faixas = EXCLUDED.faixas, cidades = EXCLUDED.cidades, atualizado_em = now();
  RETURN public.eletropostos_coleta_config();
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_coleta_config_salvar(jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_coleta_config_salvar(jsonb, text[]) TO authenticated;

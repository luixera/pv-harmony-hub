-- ============================================================================
-- Eletropostos — espelho da estação ("Estação ao vivo"), 16/10/2026
--
-- Pedido do usuário: ver na página o que o worker está fazendo. Caminho
-- escolhido: espelho por FOTOS (não transmissão de vídeo).
--  - A cada passo do ciclo a estação registra uma linha (o que está fazendo,
--    ok/falha) e sobrescreve UMA foto "atual" da tela do aparelho
--    (<estacao>/atual.png) — o tamanho guardado não cresce com os ciclos.
--  - Em falha guarda também a foto daquele momento
--    (<estacao>/<AAAAMMDD>/<ciclo>/<n>.png); a própria estação apaga as pastas
--    com mais de 3 dias.
-- Fotos e linhas são só do master: a tela da Cury pode mostrar o nome da conta.
-- Nenhum dado de motorista aparece nessas telas (disponibilidade de carregador).
-- ============================================================================

-- ── armazenamento das fotos (privado; só master lê; escrita só service role) ─
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('eletropostos-espelho', 'eletropostos-espelho', FALSE, 3145728, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY eletropostos_espelho_master_le ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'eletropostos-espelho' AND (SELECT public.is_master(auth.uid())));

-- ── linhas do espelho ───────────────────────────────────────────────────────
CREATE TABLE public.eletroposto_espelho (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL DEFAULT public.eletropostos_tenant() REFERENCES public.tenants(id) ON DELETE CASCADE,
  estacao_id  uuid NOT NULL REFERENCES public.eletroposto_estacao(id) ON DELETE CASCADE,
  ciclo       text NOT NULL,                 -- identificador do ciclo (ex.: 20261016-2008)
  ts          timestamptz NOT NULL DEFAULT now(),
  fonte       text,                          -- cury | atm | null (passo geral do ciclo)
  passo       text NOT NULL,                 -- o que a estação está fazendo, em português
  situacao    text NOT NULL DEFAULT 'info' CHECK (situacao IN ('info', 'ok', 'falha', 'fim')),
  mensagem    text,                          -- detalhe (erro curto, contagem de leituras…)
  foto        text,                          -- caminho no bucket (só em falha; a "atual" é fixa)
  foto_atual_em timestamptz                  -- quando a foto atual foi enviada neste passo
);
CREATE INDEX eletroposto_espelho_estacao_ts_idx ON public.eletroposto_espelho (estacao_id, ts DESC);
CREATE INDEX eletroposto_espelho_ciclo_idx ON public.eletroposto_espelho (estacao_id, ciclo, id);

ALTER TABLE public.eletroposto_espelho ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.eletroposto_espelho AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
CREATE POLICY eletroposto_espelho_master_le ON public.eletroposto_espelho FOR SELECT TO authenticated
  USING ((SELECT public.is_master(auth.uid())));

-- ── escrita: só service role (estação da VPS) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.eletropostos_espelho_registrar(
  p_estacao uuid, p_ciclo text, p_passo text,
  p_situacao text DEFAULT 'info', p_fonte text DEFAULT NULL, p_mensagem text DEFAULT NULL,
  p_foto text DEFAULT NULL, p_foto_atual boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Só o service role registra o espelho da estação';
  END IF;
  INSERT INTO public.eletroposto_espelho (estacao_id, ciclo, fonte, passo, situacao, mensagem, foto, foto_atual_em)
  VALUES (p_estacao, left(p_ciclo, 40), left(p_fonte, 20), left(p_passo, 200),
          COALESCE(NULLIF(p_situacao, ''), 'info'), left(p_mensagem, 500), left(p_foto, 300),
          CASE WHEN p_foto_atual THEN now() END)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.eletropostos_espelho_registrar(uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eletropostos_espelho_registrar(uuid, text, text, text, text, text, text, boolean) TO service_role;

-- ── leitura para a página (master) ──────────────────────────────────────────
-- Devolve, por estação: o último passo, o ciclo corrente (ou o último) com os
-- seus passos, e quando a foto atual foi enviada pela última vez.
CREATE OR REPLACE FUNCTION public.eletropostos_espelho()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN NOT public.is_master(auth.uid()) THEN NULL ELSE COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'nome') FROM (
      SELECT jsonb_build_object(
        'estacao_id', e.id, 'nome', e.nome, 'vista_em', e.vista_em,
        'foto_atual', e.id::text || '/atual.png',
        'foto_atual_em', (SELECT max(foto_atual_em) FROM public.eletroposto_espelho s WHERE s.estacao_id = e.id),
        'ultimo', (SELECT to_jsonb(s) - 'tenant_id' FROM public.eletroposto_espelho s WHERE s.estacao_id = e.id ORDER BY s.id DESC LIMIT 1),
        'passos', COALESCE((
          SELECT jsonb_agg(to_jsonb(s) - 'tenant_id' ORDER BY s.id)
            FROM public.eletroposto_espelho s
           WHERE s.estacao_id = e.id
             AND s.ciclo = (SELECT s2.ciclo FROM public.eletroposto_espelho s2 WHERE s2.estacao_id = e.id ORDER BY s2.id DESC LIMIT 1)), '[]'::jsonb)
      ) AS x
      FROM public.eletroposto_estacao e
     WHERE e.ativa AND EXISTS (SELECT 1 FROM public.eletroposto_espelho s WHERE s.estacao_id = e.id)
    ) q), '[]'::jsonb) END
$$;
REVOKE ALL ON FUNCTION public.eletropostos_espelho() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eletropostos_espelho() TO authenticated;

-- ── retenção das linhas: 3 dias (as fotos de falha a estação apaga) ─────────
SELECT cron.unschedule('eletropostos_espelho_retencao')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eletropostos_espelho_retencao');
SELECT cron.schedule('eletropostos_espelho_retencao', '23 4 * * *',
  $job$DELETE FROM public.eletroposto_espelho WHERE ts < now() - INTERVAL '3 days'$job$);

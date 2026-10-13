-- A promoção da BDGD sai da API e vai para um job de pg_cron de uso único.
--
-- POR QUE: o PostgREST conecta como `authenticator`, que tem
-- statement_timeout = 8s, e o service_role não muda isso. Medido em 13/10/2026
-- com os dados reais da CPFL Piratininga já no staging (52.971 trafos):
--   rede_promover_trafo sozinho ......... 10,95 s (cache frio)
--   promoção inteira, com o índice novo .  6,03 s (cache quente)
-- A 2ª ingestão real na VPS (run 59) morreu exatamente aí: "canceling
-- statement due to statement timeout". E a CPFL Paulista é ~5x maior.
--
-- O QUE NÃO FUNCIONA, e foi provado antes de desistir: `ALTER FUNCTION ... SET
-- statement_timeout`. O SET da função não estende um comando já em curso — a
-- chamada com 10 min na função ainda foi cancelada aos 8 s da sessão.
--
-- O QUE NÃO FOI FEITO, de propósito: subir o statement_timeout do service_role
-- inteiro. Mudaria o limite de TODA chamada de servidor (Ludmilla, edge
-- functions) para caber um lote mensal — a camada errada.
--
-- O DESENHO: o worker sobe o staging e chama rede_solicitar_promocao(), que
-- só marca a importação e agenda o job (milissegundos). O job roda como
-- postgres, com `set statement_timeout = '15min'` como comando SEPARADO antes
-- do select — assim ele vale (desde o PG 13 o limite é por comando). Tudo numa
-- transação: o mapa continua nunca meio-carregado. Quando a fila esvazia, o job
-- se desagenda sozinho: sem job permanente, sem 1440 linhas/dia de log.

-- O que faltava ao `inativar`: o NOT EXISTS buscava por (importacao_id, codigo)
-- e o índice só cobria importacao_id.
CREATE INDEX IF NOT EXISTS rede_stg_trafo_imp_cod_idx
  ON public.rede_stg_transformador (importacao_id, codigo);

-- ── O núcleo, sem portão: um só lugar para a lógica da promoção ─────────────
CREATE OR REPLACE FUNCTION public.rede_promover_nucleo(p_importacao_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE d BIGINT; n_sub INT; n_alim INT; n_trafo INT; n_inativo INT;
BEGIN
  SELECT distribuidora_id INTO d FROM public.rede_importacao WHERE id = p_importacao_id;
  IF d IS NULL THEN
    RAISE EXCEPTION 'Importacao % nao existe', p_importacao_id;
  END IF;
  n_sub     := public.rede_promover_sub(p_importacao_id, d);
  n_alim    := public.rede_promover_alim(p_importacao_id, d);
  n_trafo   := public.rede_promover_trafo(p_importacao_id, d);
  n_inativo := public.rede_promover_inativar(p_importacao_id, d);
  UPDATE public.rede_importacao
     SET situacao = 'concluida', concluido_em = now(), etapa = 'promovida', erro = NULL,
         linhas_por_camada = jsonb_build_object(
           'subestacao', n_sub, 'alimentador', n_alim, 'transformador', n_trafo,
           'inativados', n_inativo)
   WHERE id = p_importacao_id;
  RETURN jsonb_build_object('subestacao', n_sub, 'alimentador', n_alim,
                            'transformador', n_trafo, 'inativados', n_inativo);
END $fn$;

-- A entrada antiga continua para uso manual do master; agora só delega.
CREATE OR REPLACE FUNCTION public.rede_importacao_promover(p_importacao_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'So master ou service role promove uma importacao';
  END IF;
  RETURN public.rede_promover_nucleo(p_importacao_id);
END $fn$;

-- ── Promoção + data-base + recálculo, numa transação ────────────────────────
CREATE OR REPLACE FUNCTION public.rede_concluir_carga(p_importacao_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE prom JSONB; g RECORD; n_cel INT;
BEGIN
  prom := public.rede_promover_nucleo(p_importacao_id);
  -- a data-base so vira verdade aqui, depois da promocao (ver guarda.ts)
  UPDATE public.rede_distribuidora d SET data_base = i.data_base, atualizado_em = now()
    FROM public.rede_importacao i
   WHERE i.id = p_importacao_id AND d.id = i.distribuidora_id;
  -- o veredito e derivado, nunca importado: recalcular fecha a carga
  SELECT * INTO g FROM public.rede_regras();
  PERFORM public.rede_aplicar_trafos(g.fator, g.atencao, g.risco);
  PERFORM public.rede_aplicar_alimentadores(g.fator, g.atencao, g.risco);
  PERFORM public.rede_celula_limpar();
  PERFORM public.rede_celula_inserir();
  SELECT count(*) INTO n_cel FROM public.rede_celula_agregada;
  RETURN prom || jsonb_build_object('celulas', n_cel);
END $fn$;

-- ── A fila ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rede_processar_fila()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE r RECORD; res JSONB; feitas INT := 0; falhas INT := 0;
BEGIN
  FOR r IN SELECT id FROM public.rede_importacao
            WHERE situacao = 'rodando' AND etapa = 'aguardando_promocao'
            ORDER BY id FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.rede_importacao SET etapa = 'promovendo_no_banco' WHERE id = r.id;
    BEGIN
      res := public.rede_concluir_carga(r.id);
      feitas := feitas + 1;
    EXCEPTION WHEN OTHERS THEN
      -- a subtransacao desfaz a promocao; o registro do erro fica
      UPDATE public.rede_importacao
         SET situacao = 'falhou', erro = 'Promocao no banco: ' || SQLERRM, concluido_em = now()
       WHERE id = r.id;
      falhas := falhas + 1;
    END;
  END LOOP;
  -- job de uso unico: some quando nao ha mais nada na fila
  IF NOT EXISTS (SELECT 1 FROM public.rede_importacao
                  WHERE situacao = 'rodando' AND etapa = 'aguardando_promocao') THEN
    BEGIN
      PERFORM cron.unschedule('rede-promover-fila');
    EXCEPTION WHEN OTHERS THEN NULL;  -- chamada manual, sem job agendado
    END;
  END IF;
  RETURN jsonb_build_object('concluidas', feitas, 'falhas', falhas);
END $fn$;

-- ── A porta que o worker chama: milissegundos, cabe nos 8 s ─────────────────
CREATE OR REPLACE FUNCTION public.rede_solicitar_promocao(p_importacao_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE sit TEXT;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'So master ou service role solicita a promocao';
  END IF;
  SELECT situacao INTO sit FROM public.rede_importacao WHERE id = p_importacao_id FOR UPDATE;
  IF sit IS NULL THEN
    RAISE EXCEPTION 'Importacao % nao existe', p_importacao_id;
  ELSIF sit <> 'rodando' THEN
    RAISE EXCEPTION 'Importacao % esta %, nao rodando', p_importacao_id, sit;
  END IF;
  UPDATE public.rede_importacao SET etapa = 'aguardando_promocao' WHERE id = p_importacao_id;
  PERFORM cron.schedule('rede-promover-fila', '* * * * *',
    $cmd$set statement_timeout = '15min'; select public.rede_processar_fila();$cmd$);
  RETURN jsonb_build_object('importacao', p_importacao_id, 'etapa', 'aguardando_promocao');
END $fn$;

-- ── Permissões: todo objeto novo, varrido ───────────────────────────────────
-- service_role mantém EXECUTE (é o worker); anon e authenticated, nada.
REVOKE ALL ON FUNCTION public.rede_promover_nucleo(BIGINT)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_concluir_carga(BIGINT)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_processar_fila()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_solicitar_promocao(BIGINT)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rede_importacao_promover(BIGINT)   FROM PUBLIC, anon, authenticated;

-- ── O rótulo da base: desempate pela carga mais recente ─────────────────────
-- Com a CPFL Piratininga carregada (13/10/2026), o mapa sobre Sorocaba trazia
-- 2.068 trafos REAIS com o rótulo "AMOSTRA — não é dado real": as duas
-- distribuidoras tinham data-base 31/12/2025 e o ORDER BY não desempatava.
-- O critério novo vale sempre, não é um caso especial para a amostra.
-- (A ACL da função é preservada pelo CREATE OR REPLACE: segue fechada.)
CREATE OR REPLACE FUNCTION public.rede_base_atual() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT jsonb_build_object('distribuidora', d.nome, 'sigla', d.sigla,
           'data_base', d.data_base, 'importado_em', i.concluido_em)
    FROM public.rede_distribuidora d
    LEFT JOIN LATERAL (SELECT concluido_em FROM public.rede_importacao
       WHERE distribuidora_id = d.id AND situacao = 'concluida'
       ORDER BY concluido_em DESC NULLS LAST LIMIT 1) i ON TRUE
   ORDER BY d.data_base DESC NULLS LAST, i.concluido_em DESC NULLS LAST LIMIT 1;
$fn$;

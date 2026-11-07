-- ============================================================================
-- LUDMILLA — pedir à ENEL a troca do relógio (06/11/2026)
-- Spec: docs/superpowers/specs/2026-11-06-ludmilla-pedido-troca-design.md
-- Plano: docs/superpowers/plans/2026-11-06-ludmilla-pedido-troca.md
--
-- 1. portal_pedidos_troca: um pedido por A fazer de vistoria aprovada. Leitura só da
--    equipe do GD Manager; escrita só por RPC.
-- 2. portal_sync_runs: tipo 'enviar_pedido_troca'.
-- 3. A regra de quando libera (ludmilla_pedido_troca_avaliar), usada na tela e de novo
--    no clique.
-- 4. RPCs da equipe (rascunho e Enviar), do robô (iniciar, enviado, falhou, sem
--    confirmação) e do cron (ludmilla_pedidos_troca_limpar).
-- 5. ludmilla_registro: só o rótulo do run novo, sobre o prosrc VIVO, com o md5 conferido.
--
-- NÃO mexe em nenhuma função ludmilla_cobranca_*, nem em ludmilla_agendar_email,
-- ludmilla_claim_run ou ludmilla_email_nts_conhecidas. Nada aqui manda e-mail: quem manda é
-- o worker, e só depois do clique de uma pessoa (ludmilla_pedido_troca_enviar).
-- ============================================================================

-- ── 1. A tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_pedidos_troca (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  afazer_id      UUID REFERENCES public.portal_afazeres(id) ON DELETE SET NULL,
  -- a data do e-mail de aprovação: o pedido vale para esta aprovação
  aprovacao_em   TIMESTAMPTZ NOT NULL,
  para           TEXT NOT NULL CONSTRAINT portal_pedidos_troca_para_da_enel CHECK (public.ludmilla_endereco_da_enel(para)),
  assunto        TEXT NOT NULL CHECK (length(assunto) <= 300 AND assunto !~ '[[:cntrl:]]' AND assunto ~ '^TROCA DE RELÓGIO - .+ - NT [0-9]{9}$'),
  nt             TEXT NOT NULL CHECK (nt ~ '^[0-9]{9}$'),
  -- o texto do clique; numa falha fica como rascunho para a próxima tentativa
  texto_aprovado TEXT NOT NULL CHECK (length(texto_aprovado) BETWEEN 20 AND 5000),
  situacao       TEXT NOT NULL DEFAULT 'aguardando_envio'
                 CHECK (situacao IN ('aguardando_envio', 'enviando', 'enviado', 'falhou', 'sem_confirmacao')),
  aprovada_por   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovada_em    TIMESTAMPTZ,
  run_id         UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  erro           TEXT,
  message_id     TEXT,
  enviado_em     TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_pedidos_troca_um_por_afazer UNIQUE (afazer_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_pedidos_troca_projeto ON public.portal_pedidos_troca (project_id);
CREATE INDEX IF NOT EXISTS idx_portal_pedidos_troca_run ON public.portal_pedidos_troca (run_id);
CREATE INDEX IF NOT EXISTS idx_portal_pedidos_troca_em_aberto
  ON public.portal_pedidos_troca (situacao, atualizado_em) WHERE situacao IN ('aguardando_envio', 'enviando');

ALTER TABLE public.portal_pedidos_troca ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.portal_pedidos_troca;
CREATE POLICY tenant_isolation ON public.portal_pedidos_troca
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((SELECT auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((SELECT auth.uid())));
DROP POLICY IF EXISTS equipe_le_pedidos_troca ON public.portal_pedidos_troca;
CREATE POLICY equipe_le_pedidos_troca ON public.portal_pedidos_troca
  FOR SELECT USING ((SELECT public.ludmilla_equipe_ok()));
-- nenhuma política de escrita: só as RPCs SECURITY DEFINER escrevem
REVOKE ALL ON public.portal_pedidos_troca FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.portal_pedidos_troca FROM authenticated;
GRANT SELECT ON public.portal_pedidos_troca TO authenticated;

-- ── 2. O run de envio ───────────────────────────────────────────────────────
ALTER TABLE public.portal_sync_runs DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;
ALTER TABLE public.portal_sync_runs ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'descoberta', 'varredura', 'criar_projeto', 'varredura_email', 'enviar_cobranca', 'enviar_pedido_troca'));

-- ── 3a. A NT do projeto ─────────────────────────────────────────────────────
-- ludmilla_email_nts_conhecidas só responde a service_role, e a tela é da equipe. Ordem: o
-- protocolo do cadastro; a Carta que espera o "Aplicar"; o token NT no assunto de e-mail ligado
-- ao projeto (só mensagem com UMA NT). Vale só com UMA candidata, e nunca a de outro projeto.
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_nt(p_account_id UUID, p_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _p public.projects%ROWTYPE; _protocolo TEXT; _lista TEXT[];
BEGIN
  SELECT * INTO _p FROM public.projects WHERE id = p_project_id;
  IF _p.id IS NULL THEN RETURN NULL; END IF;
  _protocolo := ltrim(regexp_replace(coalesce(_p.protocol_number, ''), '[^0-9]', '', 'g'), '0');
  IF _protocolo ~ '^[0-9]{9}$' THEN RETURN _protocolo; END IF;

  SELECT array_agg(DISTINCT u.protocolo) INTO _lista
    FROM public.portal_updates u
   WHERE u.account_id = p_account_id AND u.project_id = p_project_id
     AND u.atualizar_protocolo AND u.situacao = 'pendente' AND u.protocolo ~ '^[0-9]{9}$';
  IF _lista IS NULL THEN
    SELECT array_agg(DISTINCT x.nt) INTO _lista
      FROM (
        SELECT min((a.achado)[1]) AS nt
          FROM public.portal_email_mensagens m
         CROSS JOIN LATERAL regexp_matches(coalesce(m.assunto, ''), '(?<![0-9A-Z])NT[^0-9A-Z]{0,3}([0-9]{9})(?![0-9])', 'gi') AS a(achado)
         WHERE m.account_id = p_account_id AND m.project_id = p_project_id
         GROUP BY m.id
        HAVING count(DISTINCT (a.achado)[1]) = 1
      ) x;
  END IF;
  IF coalesce(array_length(_lista, 1), 0) <> 1 THEN RETURN NULL; END IF;

  -- a mesma NT no cadastro, ou numa Carta pendente, de OUTRO projeto: não dá para saber de quem é
  IF EXISTS (SELECT 1 FROM public.projects o
              WHERE o.tenant_id = _p.tenant_id AND o.concessionaire_id = _p.concessionaire_id
                AND o.id <> _p.id AND NOT o.is_deleted
                AND ltrim(regexp_replace(coalesce(o.protocol_number, ''), '[^0-9]', '', 'g'), '0') = _lista[1])
     OR EXISTS (SELECT 1 FROM public.portal_updates u
                 WHERE u.account_id = p_account_id AND u.project_id <> p_project_id
                   AND u.atualizar_protocolo AND u.situacao = 'pendente' AND u.protocolo = _lista[1]) THEN
    RETURN NULL;
  END IF;
  RETURN _lista[1];
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_nt(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- ── 3b. A regra de quando libera ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_avaliar(p_afazer_id UUID)
RETURNS TABLE (
  liberado BOOLEAN, motivo TEXT, para TEXT, assunto TEXT, nt TEXT, titular TEXT,
  aprovacao_em TIMESTAMPTZ, ja_pedido_em TIMESTAMPTZ,
  pedido_situacao TEXT, pedido_erro TEXT, pedido_texto TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  _f public.portal_afazeres%ROWTYPE; _p public.projects%ROWTYPE; _ped public.portal_pedidos_troca%ROWTYPE;
  _conta_ligada BOOLEAN; _aprov TIMESTAMPTZ; _nt TEXT; _titular TEXT; _assunto TEXT; _sinal TIMESTAMPTZ;
  _motivo TEXT; _outro BOOLEAN := FALSE;
  _para CONSTANT TEXT := 'canalgd.sp@br.enel.com';
  -- dd/mm/aaaa em Brasília, para as frases
  _quando TEXT;
BEGIN
  SELECT * INTO _f FROM public.portal_afazeres f WHERE f.id = p_afazer_id;
  IF _f.id IS NULL THEN
    _motivo := 'Aviso não encontrado.';
  ELSIF _f.tipo <> 'vistoria_aprovada' THEN
    _motivo := 'Este A fazer não pede a troca do relógio.';
  ELSIF _f.project_id IS NULL THEN
    _motivo := 'Este aviso não está ligado a um projeto: peça a troca pelo Gmail.';
  ELSE
    SELECT * INTO _p FROM public.projects x WHERE x.id = _f.project_id;
    SELECT a.enabled INTO _conta_ligada FROM public.portal_accounts a WHERE a.id = _f.account_id;
    SELECT * INTO _ped FROM public.portal_pedidos_troca pe WHERE pe.afazer_id = _f.id;
    SELECT coalesce(m.recebido_em, _f.criado_em) INTO _aprov FROM public.portal_email_mensagens m WHERE m.id = _f.mensagem_id;
    _aprov := coalesce(_aprov, _f.criado_em);
    _nt := public.ludmilla_pedido_troca_nt(_f.account_id, _f.project_id);
    SELECT btrim(regexp_replace(coalesce(g.holder_name, ''), '[[:cntrl:]]+', ' ', 'g')) INTO _titular
      FROM public.project_general_data g WHERE g.project_id = _f.project_id LIMIT 1;
    _titular := nullif(left(coalesce(_titular, ''), 200), '');
    IF _nt IS NOT NULL AND _titular IS NOT NULL THEN
      _assunto := 'TROCA DE RELÓGIO - ' || upper(_titular) || ' - NT ' || _nt;
    END IF;

    -- o sinal de que o pedido já foi feito: e-mail da ENEL sobre a troca DEPOIS da aprovação, ligado
    -- ao projeto ou com a NT no assunto. E-mail devolvido não conta: pedido que voltou não foi feito.
    SELECT min(m.recebido_em) INTO _sinal
      FROM public.portal_email_mensagens m
     WHERE m.account_id = _f.account_id AND m.recebido_em > _aprov
       AND (m.project_id = _f.project_id
            OR (_nt IS NOT NULL AND m.assunto ~ ('(^|[^0-9])' || _nt || '([^0-9]|$)')))
       AND (m.tipo_documento = 'troca_relogio'
            OR (m.tipo_documento = 'resposta_automatica' AND m.assunto ILIKE '%troca%'));

    -- outro pedido do mesmo projeto já feito depois desta aprovação (outro A fazer da mesma vistoria)
    SELECT EXISTS (SELECT 1 FROM public.portal_pedidos_troca pe
                    WHERE pe.project_id = _f.project_id AND pe.afazer_id IS DISTINCT FROM _f.id
                      AND pe.situacao <> 'falhou' AND pe.criado_em >= _aprov) INTO _outro;

    _motivo := CASE
      -- o pedido primeiro: o A fazer fecha no clique, e "já foi decidido" não diria o que aconteceu
      WHEN _ped.situacao IN ('aguardando_envio', 'enviando') THEN 'O pedido está saindo pela caixa da Ludmilla.'
      WHEN _ped.situacao = 'enviado' THEN
        'O pedido já saiu em ' || to_char(_ped.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.'
      WHEN _ped.situacao = 'sem_confirmacao' THEN
        'Não deu para confirmar se o pedido anterior saiu: confira a pasta Enviados do Gmail.'
      WHEN _f.feito_em IS NOT NULL THEN 'Este A fazer já foi decidido.'
      WHEN _p.id IS NULL OR _p.is_deleted OR _p.archived_at IS NOT NULL OR _p.status::text = 'completed'
        THEN 'O projeto foi concluído ou arquivado.'
      WHEN NOT coalesce(_conta_ligada, FALSE) THEN 'A conta da ENEL está desligada na Ludmilla.'
      WHEN _outro THEN 'Já saiu um pedido da troca deste projeto depois desta aprovação.'
      WHEN _sinal IS NOT NULL THEN
        'A ENEL já respondeu sobre a troca em ' || to_char(_sinal AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || ': o pedido já foi feito.'
      WHEN _nt IS NULL THEN 'Falta a NT deste projeto: grave o protocolo antes de pedir.'
      WHEN _titular IS NULL THEN 'Falta o titular no cadastro do projeto.'
    END;
  END IF;

  RETURN QUERY SELECT _motivo IS NULL, _motivo, _para, _assunto, _nt, _titular, _aprov, _sinal,
                      _ped.situacao, _ped.erro,
                      CASE WHEN _ped.situacao = 'falhou' THEN _ped.texto_aprovado END;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_avaliar(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- ── 4a. A equipe: o rascunho da tela ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_rascunho(p_afazer_id UUID)
RETURNS TABLE (
  liberado BOOLEAN, motivo TEXT, para TEXT, assunto TEXT, nt TEXT, titular TEXT,
  aprovacao_em TIMESTAMPTZ, ja_pedido_em TIMESTAMPTZ,
  pedido_situacao TEXT, pedido_erro TEXT, pedido_texto TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (SELECT auth.uid());
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_afazeres f
                  WHERE f.id = p_afazer_id AND f.tenant_id = public.get_user_tenant_id(_uid)) THEN
    RAISE EXCEPTION 'Aviso não encontrado.';
  END IF;
  RETURN QUERY SELECT * FROM public.ludmilla_pedido_troca_avaliar(p_afazer_id);
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_rascunho(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedido_troca_rascunho(UUID) TO authenticated;

-- ── 4b. A equipe: o Enviar ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_enviar(p_afazer_id UUID, p_texto TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (SELECT auth.uid()); _tenant UUID; _f public.portal_afazeres%ROWTYPE; _a RECORD;
  _texto TEXT := btrim(coalesce(p_texto, '')); _lacuna TEXT; _pedido UUID; _run UUID;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  -- ludmilla_equipe_ok() também aceita os perfis-agente: aprovar um e-mail para a ENEL é ato de uma PESSOA
  IF NOT public.ludmilla_pessoa_da_equipe(_uid) THEN
    RAISE EXCEPTION 'Só uma pessoa da equipe pode aprovar o envio do pedido.';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  -- a trava: dois cliques (ou duas pessoas) passam um de cada vez, e o segundo vê o A fazer fechado
  SELECT * INTO _f FROM public.portal_afazeres WHERE id = p_afazer_id AND tenant_id = _tenant FOR UPDATE;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'Aviso não encontrado.'; END IF;

  SELECT * INTO _a FROM public.ludmilla_pedido_troca_avaliar(p_afazer_id);
  IF NOT _a.liberado THEN RAISE EXCEPTION '%', _a.motivo; END IF;

  IF length(_texto) < 20 OR length(_texto) > 5000 THEN
    RAISE EXCEPTION 'O texto do e-mail precisa ter entre 20 e 5000 caracteres.';
  END IF;
  -- as lacunas do modelo (src/lib/ludmillaCobranca.ts, LACUNAS)
  FOREACH _lacuna IN ARRAY ARRAY['[NÚMERO DA NOTA]', '[UC]', '[TITULAR]', '[NT]'] LOOP
    IF strpos(_texto, _lacuna) > 0 THEN RAISE EXCEPTION 'Complete no texto: %.', _lacuna; END IF;
  END LOOP;
  IF strpos(_texto, _a.nt) = 0 THEN RAISE EXCEPTION 'O texto precisa citar a NT %.', _a.nt; END IF;

  -- só chega aqui sem pedido, ou com o que falhou (a regra acima recusa os outros)
  INSERT INTO public.portal_pedidos_troca
    (tenant_id, account_id, project_id, afazer_id, aprovacao_em, para, assunto, nt, texto_aprovado, aprovada_por, aprovada_em)
  VALUES
    (_f.tenant_id, _f.account_id, _f.project_id, _f.id, _a.aprovacao_em, _a.para, _a.assunto, _a.nt, _texto, _uid, now())
  ON CONFLICT (afazer_id) DO UPDATE
    SET para = EXCLUDED.para, assunto = EXCLUDED.assunto, nt = EXCLUDED.nt, texto_aprovado = EXCLUDED.texto_aprovado,
        aprovada_por = EXCLUDED.aprovada_por, aprovada_em = EXCLUDED.aprovada_em,
        situacao = 'aguardando_envio', erro = NULL, atualizado_em = now()
  RETURNING id INTO _pedido;

  INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo, pedido_por, dados)
  VALUES (_f.tenant_id, _f.account_id, 'enviar_pedido_troca', _uid, jsonb_build_object('pedido_id', _pedido))
  RETURNING id INTO _run;

  UPDATE public.portal_pedidos_troca SET run_id = _run WHERE id = _pedido;
  UPDATE public.portal_afazeres SET feito_por = _uid, feito_em = now() WHERE id = _f.id;
  RETURN _run;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_enviar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedido_troca_enviar(UUID, TEXT) TO authenticated;

-- ── 4c. O robô: pegar o pedido ──────────────────────────────────────────────
-- As colunas têm os nomes que `CobrancaParaEnviar` (worker/ludmilla/src/fila.ts) usa; recusa
-- nula = pode enviar, e o pedido já está `enviando`.
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_iniciar_envio(p_run_id UUID)
RETURNS TABLE (recusa TEXT, pedido_id UUID, situacao_anterior TEXT, aprovada_por UUID, para TEXT, assunto TEXT, texto TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _r public.portal_sync_runs%ROWTYPE; _c public.portal_pedidos_troca%ROWTYPE; _id UUID; _recusa TEXT;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô envia pedidos';
  END IF;
  SELECT * INTO _r FROM public.portal_sync_runs s WHERE s.id = p_run_id;
  IF _r.id IS NULL OR _r.tipo <> 'enviar_pedido_troca' OR _r.situacao <> 'rodando' THEN
    _recusa := 'este run não é um envio de pedido em andamento';
  ELSE
    BEGIN
      _id := (_r.dados ->> 'pedido_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      _id := NULL;
    END;
    SELECT * INTO _c FROM public.portal_pedidos_troca c WHERE c.id = _id AND c.account_id = _r.account_id FOR UPDATE;
    _recusa := CASE
      WHEN _c.id IS NULL THEN 'o pedido deste run não existe'
      WHEN _c.run_id IS DISTINCT FROM p_run_id THEN 'este envio não veio da aprovação do pedido'
      WHEN _c.situacao <> 'aguardando_envio' THEN 'o pedido não está esperando envio (situação: ' || _c.situacao || ')'
      WHEN _c.aprovada_por IS NULL THEN 'o pedido não foi aprovado por uma pessoa da equipe'
      WHEN NOT public.ludmilla_pessoa_da_equipe(_c.aprovada_por)
           OR NOT EXISTS (SELECT 1 FROM public.profiles pa WHERE pa.id = _c.aprovada_por AND pa.tenant_id = _c.tenant_id)
        THEN 'a aprovação não é de uma pessoa ativa da equipe deste tenant'
      WHEN NOT public.ludmilla_endereco_da_enel(_c.para) THEN 'o destinatário não é um endereço da ENEL'
      WHEN NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _c.project_id AND NOT p.is_deleted
                         AND p.archived_at IS NULL AND p.status::text <> 'completed')
        THEN 'o projeto foi concluído ou arquivado'
    END;
  END IF;
  IF _recusa IS NOT NULL THEN
    RETURN QUERY SELECT _recusa, _c.id, _c.situacao, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  UPDATE public.portal_pedidos_troca c SET situacao = 'enviando', atualizado_em = now() WHERE c.id = _c.id;
  RETURN QUERY SELECT NULL::text, _c.id, 'aguardando_envio'::text, _c.aprovada_por, _c.para, _c.assunto, _c.texto_aprovado;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_iniciar_envio(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedido_troca_iniciar_envio(UUID) TO service_role;

-- ── 4d. O robô: saiu ────────────────────────────────────────────────────────
-- Idempotente, e aceita a confirmação atrasada depois do "sem confirmação".
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_enviado(p_run_id UUID, p_message_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _run public.portal_sync_runs%ROWTYPE; _c public.portal_pedidos_troca%ROWTYPE; _tarde BOOLEAN; _quem UUID; _nome TEXT;
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra o envio';
  END IF;
  SELECT * INTO _run FROM public.portal_sync_runs s WHERE s.id = p_run_id AND s.tipo = 'enviar_pedido_troca' FOR UPDATE;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'nenhum pedido em envio para o run %', p_run_id; END IF;
  IF _run.situacao = 'ok' THEN RETURN; END IF;   -- já confirmado
  _tarde := _run.situacao = 'erro' AND coalesce(_run.resultado ->> 'sem_confirmacao', '') = 'true';
  IF _run.situacao <> 'rodando' AND NOT _tarde THEN
    RAISE EXCEPTION 'nenhum pedido em envio para o run % (situação do run: %)', p_run_id, _run.situacao;
  END IF;

  SELECT * INTO _c FROM public.portal_pedidos_troca c
   WHERE c.id = nullif(_run.dados ->> 'pedido_id', '')::uuid AND c.account_id = _run.account_id FOR UPDATE;
  IF _c.id IS NULL OR (NOT _tarde AND (_c.run_id IS DISTINCT FROM p_run_id OR _c.situacao <> 'enviando')) THEN
    RAISE EXCEPTION 'nenhum pedido em envio para o run %', p_run_id;
  END IF;

  _quem := coalesce(_c.aprovada_por, _run.pedido_por);
  SELECT pr.name INTO _nome FROM public.profiles pr WHERE pr.id = _quem;

  UPDATE public.portal_pedidos_troca
     SET situacao = 'enviado', enviado_em = now(), message_id = left(p_message_id, 300), erro = NULL, atualizado_em = now()
   WHERE id = _c.id;

  IF _c.project_id IS NOT NULL THEN
    -- comentário COMUM do card, como na cobrança: a empresa dona do projeto o enxerga. SEM o endereço de destino.
    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_c.project_id, _ludmilla,
            '📡 Ludmilla: pedido da troca do relógio enviado à ENEL (NT ' || _c.nt || '), aprovado por '
            || coalesce(_nome, 'alguém da equipe') || '.',
            'comment');
    INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
    VALUES (_c.project_id, 'Pedido da troca enviado à ENEL',
            'Pedido da troca do relógio enviado à ENEL (NT ' || _c.nt || '); aprovado por ' || coalesce(_nome, 'alguém da equipe') || '.',
            coalesce(_quem, _ludmilla), coalesce(_nome, 'Ludmilla'));
  END IF;

  UPDATE public.portal_sync_runs
     SET situacao = 'ok', terminado_em = CASE WHEN _tarde THEN terminado_em ELSE now() END, erro = NULL,
         resultado = (coalesce(resultado, '{}'::jsonb) - 'sem_confirmacao')
                     || jsonb_build_object('pedido_id', _c.id, 'nt', _c.nt, 'para', _c.para,
                                           'message_id', left(p_message_id, 300), 'confirmada_tarde', _tarde)
   WHERE id = p_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_enviado(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedido_troca_enviado(UUID, TEXT) TO service_role;

-- ── 4e. Nada saiu: volta para a equipe ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_marcar_falha(p_pedido_id UUID, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _c public.portal_pedidos_troca%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.portal_pedidos_troca WHERE id = p_pedido_id FOR UPDATE;
  IF _c.id IS NULL OR _c.situacao NOT IN ('aguardando_envio', 'enviando') THEN RETURN; END IF;
  -- o texto aprovado fica: é o rascunho da próxima tentativa
  UPDATE public.portal_pedidos_troca
     SET situacao = 'falhou', aprovada_por = NULL, aprovada_em = NULL, erro = p_erro, atualizado_em = now()
   WHERE id = _c.id;
  UPDATE public.portal_afazeres SET feito_por = NULL, feito_em = NULL WHERE id = _c.afazer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_marcar_falha(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_falhou(p_run_id UUID, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _erro TEXT := left(coalesce(nullif(btrim(p_erro), ''), 'falha sem detalhe'), 500); _id UUID;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra a falha do envio';
  END IF;
  UPDATE public.portal_sync_runs SET situacao = 'erro', terminado_em = now(), erro = _erro
   WHERE id = p_run_id AND tipo = 'enviar_pedido_troca' AND situacao IN ('na_fila', 'rodando');
  IF NOT FOUND THEN RETURN; END IF;
  SELECT c.id INTO _id FROM public.portal_pedidos_troca c WHERE c.run_id = p_run_id;
  IF _id IS NOT NULL THEN PERFORM public.ludmilla_pedido_troca_marcar_falha(_id, _erro); END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_falhou(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedido_troca_falhou(UUID, TEXT) TO service_role;

-- ── 4f. Não dá para saber se saiu ───────────────────────────────────────────
-- Conta como possivelmente enviado: sem botão Enviar, e um A fazer para conferir no Gmail.
CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_marcar_sem_confirmacao(p_pedido_id UUID, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _c public.portal_pedidos_troca%ROWTYPE; _codigo TEXT;
BEGIN
  SELECT * INTO _c FROM public.portal_pedidos_troca WHERE id = p_pedido_id FOR UPDATE;
  IF _c.id IS NULL OR _c.situacao <> 'enviando' THEN RETURN; END IF;
  UPDATE public.portal_sync_runs
     SET situacao = 'erro', terminado_em = now(), erro = p_erro,
         resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('sem_confirmacao', true, 'pedido_id', _c.id)
   WHERE id = _c.run_id AND tipo = 'enviar_pedido_troca' AND situacao IN ('na_fila', 'rodando');
  UPDATE public.portal_pedidos_troca SET situacao = 'sem_confirmacao', erro = p_erro, atualizado_em = now() WHERE id = _c.id;
  SELECT p.code INTO _codigo FROM public.projects p WHERE p.id = _c.project_id;
  INSERT INTO public.portal_afazeres (tenant_id, account_id, project_id, tipo, titulo, mensagem)
  VALUES (_c.tenant_id, _c.account_id, _c.project_id, 'aviso',
          left('📡 Confira se o pedido da troca do ' || coalesce(_codigo, 'projeto') || ' saiu', 200),
          'O robô não conseguiu confirmar se o e-mail saiu. Veja a pasta Enviados do Gmail: se não estiver lá, peça a troca pelo próprio Gmail.');
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_marcar_sem_confirmacao(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ludmilla_pedido_troca_sem_confirmacao(p_run_id UUID, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _erro TEXT := left(coalesce(nullif(btrim(regexp_replace(coalesce(p_erro, ''), '[[:cntrl:]\u007f-\u009f]+', ' ', 'g')), ''),
                              'envio sem confirmação'), 500);
  _id UUID;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra o envio sem confirmação';
  END IF;
  SELECT c.id INTO _id FROM public.portal_pedidos_troca c WHERE c.run_id = p_run_id AND c.situacao = 'enviando';
  IF _id IS NOT NULL THEN PERFORM public.ludmilla_pedido_troca_marcar_sem_confirmacao(_id, _erro); END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedido_troca_sem_confirmacao(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedido_troca_sem_confirmacao(UUID, TEXT) TO service_role;

-- ── 4g. O envio que ficou preso ─────────────────────────────────────────────
-- `enviando` há mais de 30 min: o e-mail pode ter saído, então conta como sem confirmação.
-- Ainda não saiu há mais de 2 h, ou o run já morreu: nada saiu, e volta para a equipe.
CREATE OR REPLACE FUNCTION public.ludmilla_pedidos_troca_limpar()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _r RECORD; _n INTEGER := 0;
BEGIN
  FOR _r IN SELECT c.id FROM public.portal_pedidos_troca c
             WHERE c.situacao = 'enviando' AND c.atualizado_em < now() - interval '30 minutes' LOOP
    PERFORM public.ludmilla_pedido_troca_marcar_sem_confirmacao(_r.id, 'envio sem confirmação: o e-mail pode ter saído');
    _n := _n + 1;
  END LOOP;
  FOR _r IN SELECT c.id, c.run_id FROM public.portal_pedidos_troca c
              LEFT JOIN public.portal_sync_runs s ON s.id = c.run_id
             WHERE c.situacao = 'aguardando_envio'
               AND (s.id IS NULL OR s.situacao = 'erro' OR c.atualizado_em < now() - interval '2 hours') LOOP
    UPDATE public.portal_sync_runs
       SET situacao = 'erro', terminado_em = now(), erro = 'o robô parou antes de enviar; nada saiu'
     WHERE id = _r.run_id AND tipo = 'enviar_pedido_troca' AND situacao IN ('na_fila', 'rodando');
    PERFORM public.ludmilla_pedido_troca_marcar_falha(_r.id, 'o robô parou antes de enviar; nada saiu');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedidos_troca_limpar() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.unschedule('ludmilla-pedidos-troca') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludmilla-pedidos-troca');
SELECT cron.schedule('ludmilla-pedidos-troca', '10 11-21 * * 1-5', $cron$ SELECT public.ludmilla_pedidos_troca_limpar(); $cron$);

-- ── 5. O rótulo no Registro, sobre o corpo vivo ─────────────────────────────
DO $do$
DECLARE _md5 TEXT; _def TEXT; _rotulo TEXT; _detalhe TEXT;
BEGIN
  SELECT md5(prosrc), pg_get_functiondef(oid) INTO _md5, _def FROM pg_proc WHERE proname = 'ludmilla_registro';
  IF _md5 IS DISTINCT FROM '4b98d3df6fb51977d23c9e30b903c8ec' THEN
    RAISE EXCEPTION 'ludmilla_registro mudou (md5 %): confira o corpo vivo antes de aplicar', _md5;
  END IF;
  _rotulo := $a$WHEN 'enviar_cobranca' THEN 'Cobrança à '$a$;
  _detalhe := $a$WHEN r.tipo = 'enviar_cobranca' THEN 'nota '$a$;
  IF strpos(_def, _rotulo) = 0 OR strpos(_def, _detalhe) = 0 THEN
    RAISE EXCEPTION 'ludmilla_registro não tem os trechos esperados';
  END IF;
  _def := replace(_def, _rotulo,
    $a$WHEN 'enviar_pedido_troca' THEN 'Pedido à ' || po.nome || ' (troca do relógio)' -- NOVO (06/11/2026)$a$ || chr(10) || '             ' || _rotulo);
  _def := replace(_def, _detalhe,
    $a$WHEN r.tipo = 'enviar_pedido_troca' THEN 'NT ' || coalesce(r.resultado ->> 'nt', 'sem número') || coalesce(' para ' || (r.resultado ->> 'para'), '') -- NOVO (06/11/2026)$a$ || chr(10) || '                ' || _detalhe);
  EXECUTE _def;
END
$do$;

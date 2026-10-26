-- ============================================================================
-- LUDMILLA — cobrar a ENEL sobre a troca do relógio (24/10/2026)
-- Spec: docs/superpowers/specs/2026-10-24-ludmilla-enel-cobranca-troca-design.md §3.2–§3.5
-- Plano: docs/superpowers/plans/2026-10-24-ludmilla-enel-cobranca-troca.md (Task 1)
--
-- 1. ludmilla_endereco_da_enel(texto): a trava do destinatário. A MESMA expressão do
--    worker (worker/ludmilla/src/email/enel/cobranca.ts, REGEX_DESTINATARIO_ENEL); um
--    teste do worker lê ESTE arquivo e confere.
-- 2. portal_cobrancas: uma linha por nota de serviço (única por conta + nota). Leitura
--    só da equipe do GD Manager; escrita só por RPC.
-- 3. portal_afazeres: tipo 'cobrar_troca' e coluna cobranca_id (no máximo UM A fazer
--    aberto por cobrança).
-- 4. portal_sync_runs: tipo 'enviar_cobranca'.
-- 5. RPCs do robô (só service_role), da equipe (o "Enviar" e o "Dispensar") e do
--    agendamento (ludmilla_cobrancas_abrir_vencidas; o cron entra na 20261024170000).
-- 6. ludmilla_registro: corpo do prosrc VIVO (md5 ff561bfc0a7abff9803c2b7ca2893f0c, =
--    20261005130000), com DUAS linhas novas, marcadas NOVO, para o run de envio.
--
-- NÃO mexe em ludmilla_agendar_varreduras (CPFL), ludmilla_email_registrar,
-- ludmilla_email_avisar, ludmilla_afazer_feito, ludmilla_claim_run, ludmilla_pedir_run
-- nem ludmilla_finalizar_run_impl. Nada aqui manda e-mail: quem manda é o worker, e só
-- depois do clique (ludmilla_cobranca_aprovar).
--
-- Decisão do usuário (25/10/2026): o comentário "cobrança enviada à ENEL" que a Ludmilla
-- deixa no card é COMUM (type 'comment', como os outros comentários dela) e portanto
-- VISÍVEL para a empresa integradora dona do projeto. O histórico do projeto segue como
-- está. Ver ludmilla_cobranca_enviada.
-- ============================================================================

-- ── 1. A trava do destinatário ──────────────────────────────────────────────
-- UM endereço, já normalizado (minúsculo, sem nome, sem espaço), @enel.com ou
-- @br.enel.com. Maiúscula, subdomínio, lista, quebra de linha: tudo falso.
CREATE OR REPLACE FUNCTION public.ludmilla_endereco_da_enel(p_endereco TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(p_endereco ~ '^[a-z0-9][a-z0-9._%+-]*@(br\.)?enel\.com$', FALSE);
$$;
REVOKE ALL ON FUNCTION public.ludmilla_endereco_da_enel(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_endereco_da_enel(TEXT) TO authenticated, service_role;

-- ── 2. A tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_cobrancas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  project_id           UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- 12 dígitos; NULL = o robô não achou o número (a tela pede "confira o número da nota")
  nota_servico         TEXT CHECK (nota_servico IS NULL OR nota_servico ~ '^[0-9]{12}$'),
  -- o e-mail que abriu (ou reabriu) a nota: portal_email_mensagens.id, NÃO o Message-ID
  mensagem_id          UUID REFERENCES public.portal_email_mensagens(id) ON DELETE SET NULL,
  data_nota            TIMESTAMPTZ NOT NULL,
  prazo_dias           INTEGER CHECK (prazo_dias IS NULL OR prazo_dias BETWEEN 1 AND 365),
  para                 TEXT NOT NULL CONSTRAINT portal_cobrancas_para_da_enel CHECK (public.ludmilla_endereco_da_enel(para)),
  assunto              TEXT NOT NULL CHECK (length(assunto) BETWEEN 1 AND 300 AND assunto !~ '[[:cntrl:]]'),
  -- os cabeçalhos da resposta na conversa da nota ("references" é palavra reservada do SQL)
  in_reply_to          TEXT CHECK (in_reply_to IS NULL OR in_reply_to ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$'),
  referencias          TEXT CHECK (referencias IS NULL
                                   OR referencias ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>( <[^<>[:space:]]+@[^<>[:space:]]+>)*$'),
  vence_em             TIMESTAMPTZ NOT NULL,
  situacao             TEXT NOT NULL DEFAULT 'agendada'
                       CHECK (situacao IN ('agendada', 'aguardando_envio', 'enviando', 'encerrada', 'dispensada')),
  enviadas             INTEGER NOT NULL DEFAULT 0 CHECK (enviadas >= 0),
  ultima_enviada_em    TIMESTAMPTZ,
  ultimo_texto_enviado TEXT,
  aprovada_por         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovada_em          TIMESTAMPTZ,
  -- o texto do clique; numa falha fica como rascunho para a próxima tentativa
  texto_aprovado       TEXT CHECK (texto_aprovado IS NULL OR length(texto_aprovado) BETWEEN 20 AND 5000),
  run_id               UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  erro                 TEXT,
  encerrada_por        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  motivo_encerramento  TEXT,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_cobrancas_nota_unica UNIQUE (account_id, nota_servico),
  CONSTRAINT portal_cobrancas_mensagem_unica UNIQUE (mensagem_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_cobrancas_vencimento
  ON public.portal_cobrancas (situacao, vence_em) WHERE situacao IN ('agendada', 'aguardando_envio', 'enviando');
CREATE INDEX IF NOT EXISTS idx_portal_cobrancas_projeto ON public.portal_cobrancas (project_id);
CREATE INDEX IF NOT EXISTS idx_portal_cobrancas_run ON public.portal_cobrancas (run_id);

ALTER TABLE public.portal_cobrancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.portal_cobrancas;
CREATE POLICY tenant_isolation ON public.portal_cobrancas
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((SELECT auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((SELECT auth.uid())));
DROP POLICY IF EXISTS equipe_le_cobrancas ON public.portal_cobrancas;
CREATE POLICY equipe_le_cobrancas ON public.portal_cobrancas
  FOR SELECT USING ((SELECT public.ludmilla_equipe_ok()));
-- nenhuma política de escrita: só as RPCs SECURITY DEFINER escrevem
REVOKE ALL ON public.portal_cobrancas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.portal_cobrancas FROM authenticated;
GRANT SELECT ON public.portal_cobrancas TO authenticated;

-- ── 3. O A fazer da cobrança ────────────────────────────────────────────────
ALTER TABLE public.portal_afazeres
  ADD COLUMN IF NOT EXISTS cobranca_id UUID REFERENCES public.portal_cobrancas(id) ON DELETE CASCADE;
ALTER TABLE public.portal_afazeres DROP CONSTRAINT IF EXISTS portal_afazeres_tipo_check;
ALTER TABLE public.portal_afazeres ADD CONSTRAINT portal_afazeres_tipo_check
  CHECK (tipo IN ('vistoria_aprovada', 'troca_falhou', 'devolucao', 'aviso', 'cobrar_troca'));
ALTER TABLE public.portal_afazeres DROP CONSTRAINT IF EXISTS portal_afazeres_cobranca_coerente;
ALTER TABLE public.portal_afazeres ADD CONSTRAINT portal_afazeres_cobranca_coerente
  CHECK ((tipo = 'cobrar_troca') = (cobranca_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS portal_afazeres_uma_cobranca_aberta
  ON public.portal_afazeres (cobranca_id) WHERE cobranca_id IS NOT NULL AND feito_em IS NULL;

-- ── 4. O run de envio ───────────────────────────────────────────────────────
ALTER TABLE public.portal_sync_runs DROP CONSTRAINT IF EXISTS portal_sync_runs_tipo_check;
ALTER TABLE public.portal_sync_runs ADD CONSTRAINT portal_sync_runs_tipo_check
  CHECK (tipo IN ('reconhecimento', 'teste_login', 'descoberta', 'varredura', 'criar_projeto', 'varredura_email', 'enviar_cobranca'));

-- ── 5a. Ajudantes internos (ninguém de fora chama) ──────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_fechar_afazer(p_cobranca_id UUID, p_por UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.portal_afazeres SET feito_por = p_por, feito_em = now()
   WHERE cobranca_id = p_cobranca_id AND feito_em IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_fechar_afazer(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Sem título/mensagem: os do "venceu" (a nota, o projeto, a data e o pedido de conferir
-- quando falta o número). Não abre se já houver um aberto para a cobrança.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_abrir_afazer(
  p_cobranca_id UUID, p_titulo TEXT DEFAULT NULL, p_mensagem TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _c public.portal_cobrancas%ROWTYPE; _codigo TEXT; _titulo TEXT; _mensagem TEXT; _n INTEGER;
BEGIN
  SELECT * INTO _c FROM public.portal_cobrancas WHERE id = p_cobranca_id;
  IF _c.id IS NULL THEN RETURN 0; END IF;
  SELECT p.code INTO _codigo FROM public.projects p WHERE p.id = _c.project_id;
  _titulo := coalesce(p_titulo,
    '📡 Cobrar a ENEL — troca do relógio do ' || coalesce(_codigo, 'projeto')
    || ' (nota ' || coalesce(_c.nota_servico, 'sem número') || ')');
  _mensagem := coalesce(p_mensagem,
    CASE WHEN _c.enviadas > 0 AND _c.ultima_enviada_em IS NOT NULL
         THEN 'A última cobrança saiu em ' || to_char(_c.ultima_enviada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
              || ' e a ENEL não confirmou a troca. Revise o e-mail e envie de novo, ou dispense.'
         ELSE 'A nota de serviço foi aberta em ' || to_char(_c.data_nota AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
              || ' e a ENEL ainda não confirmou a troca. Revise o e-mail e envie, ou dispense.'
    END
    || CASE WHEN _c.nota_servico IS NULL
            THEN ' Não achei o número da nota no e-mail da ENEL: confira antes de enviar.' ELSE '' END);
  INSERT INTO public.portal_afazeres (tenant_id, account_id, project_id, cobranca_id, tipo, titulo, mensagem)
  SELECT _c.tenant_id, _c.account_id, _c.project_id, _c.id, 'cobrar_troca', left(_titulo, 200), left(_mensagem, 1000)
   WHERE NOT EXISTS (SELECT 1 FROM public.portal_afazeres f WHERE f.cobranca_id = _c.id AND f.feito_em IS NULL);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_abrir_afazer(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- ── 5b. O robô agenda (leitura da ENEL) ─────────────────────────────────────
-- Devolve: criada | atualizada | mantida | mais_antiga | projeto_inativo | para_recusado
--          | conta_recusada | mensagem_inexistente. Recusa por código, nunca por erro:
-- quem chama é o tratamento de UM e-mail, e um erro faria a mensagem ser relida 5 vezes.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_agendar(
  p_account_id UUID, p_message_id TEXT, p_project_id UUID, p_nota TEXT, p_data_nota TIMESTAMPTZ,
  p_prazo_dias INTEGER, p_para TEXT, p_assunto TEXT, p_in_reply_to TEXT, p_referencias TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE; _proj public.projects%ROWTYPE; _msg UUID;
  _c public.portal_cobrancas%ROWTYPE; _id UUID; _resultado TEXT; _velha UUID;
  _nota TEXT := nullif(btrim(coalesce(p_nota, '')), '');
  _prazo INTEGER := CASE WHEN p_prazo_dias BETWEEN 1 AND 365 THEN p_prazo_dias END;
  _irt TEXT := CASE WHEN p_in_reply_to ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$' THEN p_in_reply_to END;
  _refs TEXT := CASE WHEN p_referencias ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>( <[^<>[:space:]]+@[^<>[:space:]]+>)*$'
                     THEN p_referencias END;
  _assunto TEXT := left(btrim(regexp_replace(coalesce(p_assunto, ''), '[[:cntrl:]]+', ' ', 'g')), 300);
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô agenda cobranças';
  END IF;
  IF _nota IS NOT NULL AND _nota !~ '^[0-9]{12}$' THEN _nota := NULL; END IF;
  IF _assunto = '' THEN _assunto := 'RE: TROCA DE RELÓGIO'; END IF;

  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  IF _conta.id IS NULL OR _conta.connector <> 'enel' THEN RETURN 'conta_recusada'; END IF;
  SELECT * INTO _proj FROM public.projects
   WHERE id = p_project_id AND tenant_id = _conta.tenant_id AND concessionaire_id = _conta.concessionaire_id;
  IF _proj.id IS NULL OR _proj.is_deleted OR _proj.archived_at IS NOT NULL OR _proj.status::text = 'completed' THEN
    RETURN 'projeto_inativo';
  END IF;
  IF NOT public.ludmilla_endereco_da_enel(p_para) THEN RETURN 'para_recusado'; END IF;
  SELECT m.id INTO _msg FROM public.portal_email_mensagens m
   WHERE m.account_id = p_account_id AND m.message_id = p_message_id AND m.protocolo = '';
  IF _msg IS NULL THEN RETURN 'mensagem_inexistente'; END IF;

  -- e-mail mais velho que a nota em andamento do projeto (2ª leitura de um e-mail antigo)
  IF EXISTS (SELECT 1 FROM public.portal_cobrancas c
              WHERE c.project_id = p_project_id AND c.situacao IN ('agendada', 'aguardando_envio', 'enviando')
                AND c.data_nota > p_data_nota AND c.nota_servico IS DISTINCT FROM _nota) THEN
    RETURN 'mais_antiga';
  END IF;

  IF _nota IS NOT NULL THEN
    SELECT * INTO _c FROM public.portal_cobrancas c
     WHERE c.account_id = p_account_id AND c.nota_servico = _nota FOR UPDATE;
  END IF;
  IF _c.id IS NULL THEN
    SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.mensagem_id = _msg FOR UPDATE;
  END IF;

  IF _c.id IS NULL THEN
    INSERT INTO public.portal_cobrancas
      (tenant_id, account_id, project_id, nota_servico, mensagem_id, data_nota, prazo_dias,
       para, assunto, in_reply_to, referencias, vence_em)
    VALUES
      (_conta.tenant_id, p_account_id, p_project_id, _nota, _msg, p_data_nota, _prazo,
       p_para, _assunto, _irt, _refs, p_data_nota + interval '7 days')
    RETURNING id INTO _id;
    _resultado := 'criada';
  ELSIF _c.nota_servico IS NOT NULL AND _nota IS NOT NULL AND _c.nota_servico <> _nota THEN
    RETURN 'mantida';
  ELSIF _c.situacao IN ('agendada', 'aguardando_envio')
        AND (p_data_nota > _c.data_nota OR (_c.nota_servico IS NULL AND _nota IS NOT NULL)) THEN
    -- o mesmo e-mail pode estar preso a outra linha (sem número): solta antes de mover
    UPDATE public.portal_cobrancas SET mensagem_id = NULL WHERE mensagem_id = _msg AND id <> _c.id;
    UPDATE public.portal_cobrancas
       SET nota_servico = coalesce(_nota, nota_servico), mensagem_id = _msg,
           data_nota = greatest(p_data_nota, data_nota), prazo_dias = _prazo,
           para = p_para, assunto = _assunto, in_reply_to = _irt, referencias = _refs,
           vence_em = greatest(p_data_nota, data_nota) + interval '7 days', situacao = 'agendada',
           aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL, erro = NULL, atualizado_em = now()
     WHERE id = _c.id;
    -- a ENEL respondeu (reenviou ou reprogramou): o A fazer aberto perdeu o sentido
    PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, NULL);
    _id := _c.id;
    _resultado := 'atualizada';
  ELSE
    RETURN 'mantida';
  END IF;

  -- a nota NOVA (com número) encerra as mais antigas do mesmo projeto
  IF _nota IS NOT NULL THEN
    FOR _velha IN SELECT c.id FROM public.portal_cobrancas c
                   WHERE c.project_id = p_project_id AND c.id <> _id
                     AND c.situacao IN ('agendada', 'aguardando_envio')
                     AND c.nota_servico IS DISTINCT FROM _nota AND c.data_nota <= p_data_nota
                   FOR UPDATE LOOP
      UPDATE public.portal_cobrancas
         SET situacao = 'encerrada', motivo_encerramento = 'substituída pela nota ' || _nota, atualizado_em = now()
       WHERE id = _velha;
      PERFORM public.ludmilla_cobranca_fechar_afazer(_velha, NULL);
    END LOOP;
  END IF;
  RETURN _resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- A ENEL avisou que a troca foi feita: as cobranças do projeto param (spec §3.5).
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_encerrar_por_troca(p_account_id UUID, p_project_id UUID, p_quando TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID; _n INTEGER := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô encerra cobranças pela troca';
  END IF;
  FOR _id IN SELECT c.id FROM public.portal_cobrancas c
              WHERE c.account_id = p_account_id AND c.project_id = p_project_id
                AND c.situacao IN ('agendada', 'aguardando_envio')
                AND c.data_nota <= coalesce(p_quando, now())
              FOR UPDATE LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'encerrada', motivo_encerramento = 'a ENEL avisou que a troca do relógio foi feita', atualizado_em = now()
     WHERE id = _id;
    PERFORM public.ludmilla_cobranca_fechar_afazer(_id, NULL);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_encerrar_por_troca(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_encerrar_por_troca(UUID, UUID, TIMESTAMPTZ) TO service_role;

-- ── 5c. O agendamento (o cron da 20261024170000 chama, como postgres) ───────
CREATE OR REPLACE FUNCTION public.ludmilla_cobrancas_abrir_vencidas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _r RECORD; _n INTEGER := 0;
BEGIN
  -- 1. projeto concluído, arquivado, apagado ou sumido: as cobranças param
  FOR _r IN SELECT c.id FROM public.portal_cobrancas c
              LEFT JOIN public.projects p ON p.id = c.project_id
             WHERE c.situacao IN ('agendada', 'aguardando_envio')
               AND (p.id IS NULL OR p.is_deleted OR p.archived_at IS NOT NULL OR p.status::text = 'completed')
             FOR UPDATE OF c LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'encerrada', motivo_encerramento = 'o projeto foi concluído ou arquivado', atualizado_em = now()
     WHERE id = _r.id;
    PERFORM public.ludmilla_cobranca_fechar_afazer(_r.id, NULL);
  END LOOP;

  -- 2. envio que começou e não confirmou em 30 min: volta para a equipe. NUNCA reenvia sozinho.
  FOR _r IN SELECT c.id, c.nota_servico FROM public.portal_cobrancas c
             WHERE c.situacao = 'enviando' AND c.atualizado_em < now() - interval '30 minutes'
             FOR UPDATE LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'aguardando_envio', aprovada_por = NULL, aprovada_em = NULL,
           erro = 'o robô começou o envio e não confirmou; confira a pasta Enviados do Gmail antes de enviar de novo',
           atualizado_em = now()
     WHERE id = _r.id;
    _n := _n + public.ludmilla_cobranca_abrir_afazer(_r.id,
      '📡 A cobrança da nota ' || coalesce(_r.nota_servico, 'sem número') || ' pode não ter saído',
      'O robô começou o envio e não confirmou. Confira a pasta Enviados do Gmail antes de enviar de novo.');
  END LOOP;

  -- 3. venceu: aparece para a equipe aprovar (o texto é montado na tela)
  FOR _r IN SELECT c.id FROM public.portal_cobrancas c
              JOIN public.portal_accounts a ON a.id = c.account_id AND a.enabled
             WHERE c.situacao = 'agendada' AND c.vence_em <= now()
             FOR UPDATE OF c LOOP
    UPDATE public.portal_cobrancas
       SET situacao = 'aguardando_envio', texto_aprovado = NULL, erro = NULL, atualizado_em = now()
     WHERE id = _r.id;
    _n := _n + public.ludmilla_cobranca_abrir_afazer(_r.id);
  END LOOP;

  -- 4. esperando a equipe, sem aprovação e sem A fazer aberto (alguém o fechou pela RPC
  --    genérica de "Feito"): reabre. Só Enviar ou Dispensar decidem uma cobrança.
  FOR _r IN SELECT c.id FROM public.portal_cobrancas c
              JOIN public.portal_accounts a ON a.id = c.account_id AND a.enabled
             WHERE c.situacao = 'aguardando_envio' AND c.aprovada_por IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.portal_afazeres f WHERE f.cobranca_id = c.id AND f.feito_em IS NULL) LOOP
    _n := _n + public.ludmilla_cobranca_abrir_afazer(_r.id);
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobrancas_abrir_vencidas() FROM PUBLIC, anon, authenticated, service_role;

-- ── 5d. A equipe: o clique em "Enviar" e em "Dispensar" ─────────────────────
-- "Enviar": confere TUDO de novo (o front pode ser contornado), grava quem aprovou e o
-- texto, e põe o envio na fila do robô. Uma aprovação = uma tentativa de envio.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_aprovar(p_cobranca_id UUID, p_texto TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (SELECT auth.uid()); _tenant UUID; _c public.portal_cobrancas%ROWTYPE;
  _texto TEXT := btrim(coalesce(p_texto, '')); _run UUID; _quem TEXT; _lacuna TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id(_uid);
  SELECT * INTO _c FROM public.portal_cobrancas WHERE id = p_cobranca_id AND tenant_id = _tenant FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF _c.situacao <> 'aguardando_envio' THEN
    RAISE EXCEPTION 'Esta cobrança não está esperando envio (situação: %).', _c.situacao;
  END IF;
  IF _c.aprovada_por IS NOT NULL THEN
    SELECT name INTO _quem FROM public.profiles WHERE id = _c.aprovada_por;
    RAISE EXCEPTION 'Esta cobrança já foi aprovada por % e está saindo.', coalesce(_quem, 'alguém da equipe');
  END IF;
  IF NOT public.ludmilla_endereco_da_enel(_c.para) THEN
    RAISE EXCEPTION 'O destinatário não é um endereço da ENEL: nada foi enviado.';
  END IF;
  IF _c.ultima_enviada_em IS NOT NULL AND _c.ultima_enviada_em > now() - interval '7 days' THEN
    RAISE EXCEPTION 'Já saiu uma cobrança desta nota em %: a próxima só depois de 7 dias.',
      to_char(_c.ultima_enviada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  END IF;
  IF length(_texto) < 20 OR length(_texto) > 5000 THEN
    RAISE EXCEPTION 'O texto do e-mail precisa ter entre 20 e 5000 caracteres.';
  END IF;
  -- as lacunas do modelo (src/lib/ludmillaCobranca.ts, LACUNAS; um teste confere as duas listas)
  FOREACH _lacuna IN ARRAY ARRAY['[NÚMERO DA NOTA]', '[UC]', '[TITULAR]', '[NT]'] LOOP
    IF strpos(_texto, _lacuna) > 0 THEN RAISE EXCEPTION 'Complete no texto: %.', _lacuna; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _c.project_id AND NOT p.is_deleted
                   AND p.archived_at IS NULL AND p.status::text <> 'completed') THEN
    RAISE EXCEPTION 'O projeto foi concluído ou arquivado: a cobrança não sai.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_accounts a WHERE a.id = _c.account_id AND a.enabled) THEN
    RAISE EXCEPTION 'A conta da ENEL está desligada na Ludmilla.';
  END IF;

  INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo, pedido_por, dados)
  VALUES (_c.tenant_id, _c.account_id, 'enviar_cobranca', _uid, jsonb_build_object('cobranca_id', _c.id))
  RETURNING id INTO _run;

  UPDATE public.portal_cobrancas
     SET aprovada_por = _uid, aprovada_em = now(), texto_aprovado = _texto, run_id = _run, erro = NULL, atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, _uid);
  RETURN _run;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_aprovar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_aprovar(UUID, TEXT) TO authenticated;

-- "Dispensar": encerra a cobrança daquela nota, sem novas. false = já estava decidida.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_dispensar(p_cobranca_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (SELECT auth.uid()); _tenant UUID; _c public.portal_cobrancas%ROWTYPE;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id(_uid);
  SELECT * INTO _c FROM public.portal_cobrancas WHERE id = p_cobranca_id AND tenant_id = _tenant FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF _c.situacao IN ('dispensada', 'encerrada') THEN RETURN FALSE; END IF;
  IF _c.situacao = 'enviando' THEN RAISE EXCEPTION 'O envio desta cobrança já começou.'; END IF;
  UPDATE public.portal_cobrancas
     SET situacao = 'dispensada', encerrada_por = _uid, motivo_encerramento = 'dispensada pela equipe', atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_fechar_afazer(_c.id, _uid);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_dispensar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_dispensar(UUID) TO authenticated;

-- ── 5e. O robô envia ────────────────────────────────────────────────────────
-- SEMPRE uma linha. `recusa` nula = pode enviar, e a cobrança JÁ está `enviando` (o robô
-- a pegou: um segundo pedido com o mesmo run é recusado). Só o run que a APROVAÇÃO criou
-- (`portal_cobrancas.run_id`) serve.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_iniciar_envio(p_run_id UUID)
RETURNS TABLE (recusa TEXT, cobranca_id UUID, situacao_anterior TEXT, aprovada_por UUID,
               ultima_enviada_em TIMESTAMPTZ, para TEXT, assunto TEXT, texto TEXT,
               in_reply_to TEXT, referencias TEXT, nota_servico TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _r public.portal_sync_runs%ROWTYPE; _c public.portal_cobrancas%ROWTYPE; _id UUID; _recusa TEXT;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô envia cobranças';
  END IF;
  SELECT * INTO _r FROM public.portal_sync_runs s WHERE s.id = p_run_id;
  IF _r.id IS NULL OR _r.tipo <> 'enviar_cobranca' OR _r.situacao <> 'rodando' THEN
    _recusa := 'este run não é um envio de cobrança em andamento';
  ELSE
    BEGIN
      _id := (_r.dados ->> 'cobranca_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      _id := NULL;
    END;
    SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.id = _id AND c.account_id = _r.account_id FOR UPDATE;
    _recusa := CASE
      WHEN _c.id IS NULL THEN 'a cobrança deste run não existe'
      WHEN _c.run_id IS DISTINCT FROM p_run_id THEN 'este pedido de envio não veio da aprovação da cobrança'
      WHEN _c.situacao <> 'aguardando_envio' THEN 'a cobrança não está esperando envio (situação: ' || _c.situacao || ')'
      WHEN _c.aprovada_por IS NULL OR _c.texto_aprovado IS NULL THEN 'a cobrança não foi aprovada por uma pessoa da equipe'
      WHEN NOT public.ludmilla_endereco_da_enel(_c.para) THEN 'o destinatário não é um endereço da ENEL'
      WHEN _c.ultima_enviada_em IS NOT NULL AND _c.ultima_enviada_em > now() - interval '7 days'
        THEN 'já saiu uma cobrança desta nota há menos de 7 dias'
      WHEN NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _c.project_id AND NOT p.is_deleted
                         AND p.archived_at IS NULL AND p.status::text <> 'completed')
        THEN 'o projeto foi concluído ou arquivado'
    END;
  END IF;
  IF _recusa IS NOT NULL THEN
    RETURN QUERY SELECT _recusa, _c.id, _c.situacao, NULL::uuid, NULL::timestamptz,
                        NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  UPDATE public.portal_cobrancas c SET situacao = 'enviando', atualizado_em = now() WHERE c.id = _c.id;
  RETURN QUERY SELECT NULL::text, _c.id, 'aguardando_envio'::text, _c.aprovada_por, _c.ultima_enviada_em,
                      _c.para, _c.assunto, _c.texto_aprovado, _c.in_reply_to, _c.referencias, _c.nota_servico;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_iniciar_envio(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_iniciar_envio(UUID) TO service_role;

-- Saiu: histórico (a pessoa que aprovou é a autora), comentário no card (assinado pela
-- Ludmilla), a próxima em 7 dias, e o run fechado.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_enviada(p_run_id UUID, p_message_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _c public.portal_cobrancas%ROWTYPE; _nome TEXT; _nota TEXT;
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra o envio';
  END IF;
  SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.run_id = p_run_id AND c.situacao = 'enviando' FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'nenhuma cobrança em envio para o run %', p_run_id; END IF;
  SELECT pr.name INTO _nome FROM public.profiles pr WHERE pr.id = _c.aprovada_por;
  _nota := coalesce(_c.nota_servico, 'sem número');

  UPDATE public.portal_cobrancas
     SET situacao = 'agendada', enviadas = _c.enviadas + 1, ultima_enviada_em = now(),
         ultimo_texto_enviado = _c.texto_aprovado, vence_em = now() + interval '7 days',
         aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL, erro = NULL, atualizado_em = now()
   WHERE id = _c.id;

  IF _c.project_id IS NOT NULL THEN
    -- comentário COMUM do card: a empresa integradora dona do projeto o enxerga (decisão
    -- do usuário, 25/10/2026). Não usar type 'internal' aqui.
    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_c.project_id, _ludmilla,
            '📡 Ludmilla: cobrança da nota ' || _nota || ' enviada à ENEL (' || _c.para || '), aprovada por '
            || coalesce(_nome, 'alguém da equipe') || '.',
            'comment');
    INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
    VALUES (_c.project_id, 'Cobrança enviada à ENEL',
            'Cobrança da nota ' || _nota || ' enviada à ENEL; aprovada por ' || coalesce(_nome, 'alguém da equipe') || '.',
            coalesce(_c.aprovada_por, _ludmilla), coalesce(_nome, 'Ludmilla'));
  END IF;

  UPDATE public.portal_sync_runs
     SET situacao = 'ok', terminado_em = now(), erro = NULL,
         resultado = jsonb_build_object('cobranca_id', _c.id, 'nota', _c.nota_servico, 'para', _c.para,
                                        'enviada', _c.enviadas + 1, 'message_id', left(p_message_id, 300))
   WHERE id = p_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_enviada(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_enviada(UUID, TEXT) TO service_role;

-- Não saiu (ou foi recusada): fecha o run com erro e, se a cobrança é DESTE run, devolve
-- à equipe sem a aprovação (o texto fica como rascunho) e com um A fazer dizendo por quê.
-- Não tenta de novo sozinha.
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_falhou(p_run_id UUID, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _c public.portal_cobrancas%ROWTYPE; _erro TEXT := left(coalesce(nullif(btrim(p_erro), ''), 'falha sem detalhe'), 500);
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra a falha do envio';
  END IF;
  UPDATE public.portal_sync_runs SET situacao = 'erro', terminado_em = now(), erro = _erro
   WHERE id = p_run_id AND tipo = 'enviar_cobranca' AND situacao IN ('na_fila', 'rodando');
  SELECT * INTO _c FROM public.portal_cobrancas c
   WHERE c.run_id = p_run_id AND c.situacao IN ('enviando', 'aguardando_envio') FOR UPDATE;
  IF _c.id IS NULL THEN RETURN; END IF;
  UPDATE public.portal_cobrancas
     SET situacao = 'aguardando_envio', aprovada_por = NULL, aprovada_em = NULL, erro = _erro, atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_abrir_afazer(_c.id,
    '📡 A cobrança da nota ' || coalesce(_c.nota_servico, 'sem número') || ' não saiu',
    'O envio falhou: ' || _erro || '. Confira a pasta Enviados do Gmail antes de enviar de novo.');
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) TO service_role;

-- ── 6. Registro: o run de envio com nome próprio ────────────────────────────
-- Corpo de 20261005130000 (= prosrc vivo, md5 ff561bfc0a7abff9803c2b7ca2893f0c),
-- com DUAS linhas novas, marcadas NOVO. Assinatura, retorno, STABLE, SECURITY
-- DEFINER, search_path, REVOKE, GRANT e COMMENT iguais.
CREATE OR REPLACE FUNCTION public.ludmilla_registro(p_limite INTEGER DEFAULT 120, p_ator TEXT DEFAULT NULL)
RETURNS TABLE (
  quando TIMESTAMPTZ, ator TEXT, quem TEXT, acao TEXT, titulo TEXT, detalhe TEXT,
  situacao TEXT, project_id UUID, projeto TEXT, protocolo TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _tenant UUID;
BEGIN
  IF NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id((select auth.uid()));

  RETURN QUERY
  WITH portais AS (
    SELECT a.id, coalesce(c.name, upper(a.connector)) AS nome
      FROM public.portal_accounts a
      LEFT JOIN public.energy_concessionaires c ON c.id = a.concessionaire_id
     WHERE a.tenant_id = _tenant
  ),
  eventos AS (
    -- visitas ao portal (e, desde out/2026, leituras da caixa de e-mail)
    SELECT coalesce(r.terminado_em, r.iniciado_em, r.pedido_em) AS quando,
           'ludmilla'::text AS ator,
           coalesce(p.name, 'agendamento') AS quem,
           'visita'::text AS acao,
           CASE r.tipo
             WHEN 'varredura' THEN 'Varredura no portal ' || po.nome
             WHEN 'varredura_email' THEN 'Leitura dos e-mails da ' || po.nome
             WHEN 'enviar_cobranca' THEN 'Cobrança à ' || po.nome || ' (troca do relógio)' -- NOVO (24/10/2026)
             WHEN 'criar_projeto' THEN 'Criação de projeto no portal ' || po.nome
             WHEN 'teste_login' THEN 'Teste de acesso ao portal ' || po.nome
             WHEN 'descoberta' THEN 'Descoberta das telas do portal ' || po.nome
             ELSE 'Reconhecimento da tela do portal ' || po.nome END AS titulo,
           CASE WHEN r.situacao = 'erro' THEN r.erro
                WHEN r.tipo = 'varredura' THEN r.protocolos_lidos || ' protocolos lidos · ' || r.mudancas || ' recomendação(ões)'
                WHEN r.tipo = 'varredura_email' THEN r.protocolos_lidos || ' projetos conferidos · ' || r.mudancas || ' documento(s) anexado(s)'
                  -- protocolo cuja busca o servidor recusou: sai da frase quando
                  -- é zero (nullif), e some de vez em run antigo sem o campo
                  || coalesce(' · ' || nullif(r.resultado ->> 'falhas', '0') || ' com falha', '')
                WHEN r.tipo = 'enviar_cobranca' THEN 'nota ' || coalesce(r.resultado ->> 'nota', 'sem número') || coalesce(' para ' || (r.resultado ->> 'para'), '') -- NOVO (24/10/2026)
                ELSE 'Situação: ' || r.situacao END AS detalhe,
           CASE WHEN r.situacao = 'erro' THEN 'erro' WHEN r.situacao = 'ok' THEN 'ok' ELSE 'aviso' END AS situacao,
           NULL::uuid AS project_id, NULL::text AS projeto, NULL::text AS protocolo
      FROM public.portal_sync_runs r
      JOIN portais po ON po.id = r.account_id
      LEFT JOIN public.profiles p ON p.id = r.pedido_por
     WHERE r.tenant_id = _tenant AND r.situacao IN ('ok', 'erro')

    UNION ALL
    -- recomendações que ela levantou
    SELECT u.detectado_em, 'ludmilla', 'Ludmilla', 'recomendacao',
           'Mudança no portal: ' || u.status_portal,
           'Protocolo ' || u.protocolo || coalesce(' · ' || u.titular_portal, '')
             || coalesce(' · sugere ' || u.recomendacao, ' · sem etapa sugerida')
             || CASE WHEN u.casamento IS NOT NULL AND u.casamento <> 'protocolo' THEN ' · casado por ' || u.casamento ELSE '' END,
           CASE WHEN u.project_id IS NULL THEN 'aviso' ELSE 'ok' END,
           u.project_id, pr.code, u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.projects pr ON pr.id = u.project_id
     WHERE u.tenant_id = _tenant

    UNION ALL
    -- o que a equipe decidiu sobre cada recomendação
    SELECT u.aplicada_em, 'equipe', coalesce(p.name, 'equipe'),
           CASE WHEN u.situacao = 'aplicada' THEN 'aplicada' ELSE 'ignorada' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'Recomendação aplicada' ELSE 'Recomendação ignorada' END,
           'Protocolo ' || u.protocolo || coalesce(' · ' || pr.code, '')
             || CASE WHEN u.situacao = 'aplicada' THEN coalesce(' → ' || u.recomendacao, '') ELSE '' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'ok' ELSE 'aviso' END,
           u.project_id, pr.code, u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.projects pr ON pr.id = u.project_id
      LEFT JOIN public.profiles p ON p.id = u.aplicada_por
     WHERE u.tenant_id = _tenant AND u.situacao IN ('aplicada', 'ignorada') AND u.aplicada_em IS NOT NULL

    UNION ALL
    -- anexos que ela trouxe do portal para o card
    SELECT coalesce(x.enviado_em, x.created_at), 'ludmilla', 'Ludmilla', 'anexo',
           CASE x.situacao WHEN 'enviado' THEN 'Anexo da concessionária no card'
                           WHEN 'bloqueado' THEN 'Anexo bloqueado (titular/UC não conferem)'
                           WHEN 'erro' THEN 'Anexo falhou' ELSE 'Anexo pendente' END,
           x.nome_arquivo || ' · protocolo ' || x.protocolo || coalesce(' · ' || x.motivo, '')
             || coalesce(' · conferido por ' || x.conferido_por, ''),
           CASE x.situacao WHEN 'enviado' THEN 'ok' WHEN 'erro' THEN 'erro' ELSE 'aviso' END,
           x.project_id, pr.code, x.protocolo
      FROM public.portal_anexos x
      LEFT JOIN public.projects pr ON pr.id = x.project_id
     WHERE x.tenant_id = _tenant

    UNION ALL
    -- pareceres do portal virando comentário no card
    SELECT pa.created_at, 'ludmilla', 'Ludmilla', 'parecer',
           'Parecer da concessionária no card',
           coalesce(pa.analise || ' · ', '') || coalesce(pa.status, '') || ' · protocolo ' || pa.protocolo,
           'ok', pa.project_id, pr.code, pa.protocolo
      FROM public.portal_pareceres pa
      LEFT JOIN public.projects pr ON pr.id = pa.project_id
     WHERE pa.tenant_id = _tenant

    UNION ALL
    -- código da imagem: ela pediu
    SELECT ca.criado_em, 'ludmilla', 'Ludmilla', 'captcha_pedido',
           'Pediu o código da imagem (' || po.nome || ')',
           'Tentativa ' || ca.tentativa || coalesce(' · ' || ca.mensagem, '') || ' · ' || ca.situacao,
           CASE ca.situacao WHEN 'usado' THEN 'ok' WHEN 'expirado' THEN 'erro' ELSE 'aviso' END,
           NULL::uuid, NULL::text, NULL::text
      FROM public.portal_captchas ca
      JOIN portais po ON po.id = ca.account_id
     WHERE ca.tenant_id = _tenant

    UNION ALL
    -- código da imagem: alguém respondeu
    SELECT ca.respondido_em, 'equipe', coalesce(p.name, 'equipe'), 'captcha_respondido',
           'Código da imagem respondido (' || po.nome || ')',
           'Tentativa ' || ca.tentativa, 'ok', NULL::uuid, NULL::text, NULL::text
      FROM public.portal_captchas ca
      JOIN portais po ON po.id = ca.account_id
      LEFT JOIN public.profiles p ON p.id = ca.respondido_por
     WHERE ca.tenant_id = _tenant AND ca.respondido_em IS NOT NULL

    UNION ALL
    -- tarefas encerradas porque o projeto mudou de etapa
    SELECT k.completed_at,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'ludmilla' ELSE 'equipe' END,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'Ludmilla' ELSE coalesce(p.name, 'equipe') END,
           'tarefa_encerrada', 'Tarefa encerrada: ' || k.title,
           regexp_replace(split_part(k.description, '✅ ', 2), E'\\s+', ' ', 'g'),
           'ok', k.project_id, pr.code, NULL::text
      FROM public.tasks k
      LEFT JOIN public.projects pr ON pr.id = k.project_id
      LEFT JOIN public.profiles p ON p.id = k.completed_by
     WHERE k.tenant_id = _tenant AND k.status = 'completed' AND k.completed_at IS NOT NULL
       AND k.description LIKE '%✅ Encerrada%'
  )
  SELECT e.quando, e.ator, e.quem, e.acao, e.titulo, e.detalhe, e.situacao, e.project_id, e.projeto, e.protocolo
    FROM eventos e
   WHERE e.quando IS NOT NULL
     AND (p_ator IS NULL OR e.ator = p_ator)
   ORDER BY e.quando DESC
   LIMIT greatest(1, least(coalesce(p_limite, 120), 500));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) TO authenticated;
COMMENT ON FUNCTION public.ludmilla_registro(INTEGER, TEXT) IS
  'Registro da Ludmilla: leitura unificada de visitas (portal e e-mail), recomendações, decisões da equipe, anexos, pareceres, códigos de imagem e tarefas encerradas.';

NOTIFY pgrst, 'reload schema';

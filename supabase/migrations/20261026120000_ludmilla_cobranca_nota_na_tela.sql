-- ============================================================================
-- LUDMILLA — cobrança da troca do relógio: a nota nos TEXTOS como a ENEL a escreve (rodada 3, 26/10/2026)
--
-- A nota é guardada no formato canônico, 12 dígitos com um zero à esquerda (070706589202). A ENEL escreve
-- 70706589202 e a tela já mostra sem o zero (notaNaTela, src/lib/ludmillaCobranca.ts). Mas os TEXTOS que o
-- banco escreve levavam o zero: o comentário do card (que a empresa VÊ), o histórico, o título do A fazer,
-- o motivo de encerramento ("substituída pela nota …") e o rótulo do Registro.
--
-- Ajudante interno ludmilla_nota_na_tela(texto): 12 dígitos começando com 0 -> tira o primeiro zero;
-- qualquer outro valor -> devolve como veio; NULL -> NULL. Usado em TODO texto que mostra a nota. O valor
-- guardado em nota_servico continua canônico; a unicidade, a CHECK e os dados (resultado.nota do run,
-- a nota devolvida por ludmilla_cobranca_iniciar_envio) não mudam.
--
-- md5 do prosrc VIVO antes desta migração (cada corpo abaixo é cópia dele, com a mudança marcada R3):
--   ludmilla_cobranca_abrir_afazer     28bc3c7343981ddcbc6e36ad208e5d29   título do A fazer da cobrança
--   ludmilla_cobranca_agendar          c0400354f9fb097cb6f16348f93df92d   motivo "substituída pela nota …" (2 lugares)
--   ludmilla_cobrancas_abrir_vencidas  da2c2c3628290523e4313e5a1e84e33b   aviso "pode ter saído sem confirmação"
--   ludmilla_cobranca_enviada          5914d8ae6d253a6e5ac779ae554b27f5   comentário do card e histórico
--   ludmilla_cobranca_falhou           59eed8ec01b03cf60be0a804c64bb190   A fazer "não saiu"
--   ludmilla_agendar_email             6acfff40f565ff22aa7018e8948b1a2d   A fazer "o robô parou antes de enviar" (rodada 2)
--   ludmilla_registro                  fbbc9bf548958f83a8a4e874b7c410f9   rótulo "nota N para …" do envio
--
-- ATENÇÃO: ludmilla_agendar_email TEM de mudar (o md5 dela deixa de ser 6acfff40f565ff22aa7018e8948b1a2d): desde a rodada 2 ela escreve o título
-- do A fazer com a nota, e esse título é texto do banco como os outros.
-- NÃO mexe em: ludmilla_agendar_varreduras (CPFL, 3d0d2d0f1e7455ec701230bc925e1bde), ludmilla_aplicar_update (6183edef6c3f93810282039bdd565a26),
-- ludmilla_email_registrar (5d5375a0cb842209b6fb5f82327ee579), ludmilla_equipe_ok (144f52037d242b2c3e267169c80fcad0),
-- ludmilla_cobranca_iniciar_envio (74ded66fb23b009d4f2def8ae612d386; só devolve a nota como dado), nem nos crons. Assinaturas iguais.
-- ============================================================================

-- ── 1. O ajudante ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_nota_na_tela(p_nota TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_nota ~ '^0[0-9]{11}$' THEN substr(p_nota, 2) ELSE p_nota END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_nota_na_tela(TEXT) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ludmilla_nota_na_tela(TEXT) IS
  'Nota de serviço como a ENEL a escreve: 12 dígitos começando com 0 perdem o primeiro zero; qualquer outro valor volta como veio; NULL volta NULL. Interna: sem EXECUTE para ninguém de fora.';

-- ── 2. O A fazer da cobrança (título) ───────────────────────────────────────
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
    || ' (nota ' || coalesce(public.ludmilla_nota_na_tela(_c.nota_servico), 'sem número') || ')');
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

-- ── 3. "Substituída pela nota …" ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_agendar(
  p_account_id UUID, p_message_id TEXT, p_project_id UUID, p_nota TEXT, p_data_nota TIMESTAMPTZ,
  p_prazo_dias INTEGER, p_para TEXT, p_assunto TEXT, p_in_reply_to TEXT, p_referencias TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE; _proj public.projects%ROWTYPE; _msg UUID;
  _c public.portal_cobrancas%ROWTYPE; _id UUID; _resultado TEXT; _velha RECORD;
  _nota TEXT := nullif(btrim(coalesce(p_nota, '')), '');
  _prazo INTEGER := CASE WHEN p_prazo_dias BETWEEN 1 AND 365 THEN p_prazo_dias END;
  -- R1 (M-4): as MESMAS expressões das CHECKs da tabela (sem controle de nenhum tipo; References com no
  -- máximo 20 itens e 2000 caracteres). O que não passa vira NULL, como antes: a cobrança é criada sem o cabeçalho.
  _irt TEXT := CASE WHEN p_in_reply_to ~ '^<[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>$' THEN p_in_reply_to END;
  _refs TEXT := CASE WHEN length(p_referencias) <= 2000 AND p_referencias ~ '^<[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>( <[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>){0,19}$'
                     THEN p_referencias END;
  _assunto TEXT := left(btrim(regexp_replace(coalesce(p_assunto, ''), '[[:cntrl:]\u007f-\u009f]+', ' ', 'g')), 300);
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
    FOR _velha IN SELECT c.id, c.situacao FROM public.portal_cobrancas c
                   WHERE c.project_id = p_project_id AND c.id <> _id
                     AND c.situacao IN ('agendada', 'aguardando_envio', 'enviando')
                     AND c.nota_servico IS DISTINCT FROM _nota AND c.data_nota <= p_data_nota
                   FOR UPDATE LOOP
      IF _velha.situacao = 'enviando' THEN
        -- R1 (M-6): o e-mail dela está saindo e não dá para desfazer; marca, e quem registra o envio encerra
        -- (sem mexer em atualizado_em: é o início do envio, que o reset de 30 min usa)
        UPDATE public.portal_cobrancas SET encerrar_apos_envio = 'substituída pela nota ' || public.ludmilla_nota_na_tela(_nota)
         WHERE id = _velha.id AND encerrar_apos_envio IS NULL;
      ELSE
        UPDATE public.portal_cobrancas
           SET situacao = 'encerrada', motivo_encerramento = 'substituída pela nota ' || public.ludmilla_nota_na_tela(_nota), atualizado_em = now()
         WHERE id = _velha.id;
        PERFORM public.ludmilla_cobranca_fechar_afazer(_velha.id, NULL);
      END IF;
    END LOOP;
  END IF;
  RETURN _resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_agendar(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ── 4. O aviso "pode ter saído sem confirmação" ─────────────────────────────
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

  -- 1b. R1 (M-6): o mesmo com o envio EM ANDAMENTO. Não dá para desfazer o que está saindo: marca, e quem
  --     registra o envio (_enviada, _falhou ou o reset abaixo) encerra em vez de reagendar. Não mexe em
  --     atualizado_em: ele é o INÍCIO do envio.
  FOR _r IN SELECT c.id FROM public.portal_cobrancas c
              LEFT JOIN public.projects p ON p.id = c.project_id
             WHERE c.situacao = 'enviando' AND c.encerrar_apos_envio IS NULL
               AND (p.id IS NULL OR p.is_deleted OR p.archived_at IS NOT NULL OR p.status::text = 'completed')
             FOR UPDATE OF c LOOP
    UPDATE public.portal_cobrancas SET encerrar_apos_envio = 'o projeto foi concluído ou arquivado' WHERE id = _r.id;
  END LOOP;

  -- 2. R1 (I-2): envio que começou e não confirmou em 30 min. REGRA: e-mail para a ENEL NUNCA sai em dobro.
  --    O e-mail é tratado como POSSIVELMENTE enviado: o run fecha com erro (senão ludmilla_agendar_email
  --    pula a conta para sempre), ultima_enviada_em = início do envio (atualizado_em, posto por
  --    iniciar_envio) e a próxima só vence 7 dias depois. Se ele saiu de fato, o worker confirma depois
  --    com ludmilla_cobranca_enviada(run_id): o run fica marcado sem_confirmacao.
  FOR _r IN SELECT c.* FROM public.portal_cobrancas c
             WHERE c.situacao = 'enviando' AND c.atualizado_em < now() - interval '30 minutes'
             FOR UPDATE LOOP
    UPDATE public.portal_sync_runs
       SET situacao = 'erro', terminado_em = now(), erro = 'envio sem confirmação',
           resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('sem_confirmacao', true, 'cobranca_id', _r.id)
     WHERE id = _r.run_id AND tipo = 'enviar_cobranca' AND situacao IN ('na_fila', 'rodando');
    IF _r.encerrar_apos_envio IS NOT NULL THEN
      -- a cobrança já estava encerrando (troca feita etc.): só registra que pode ter saído
      UPDATE public.portal_cobrancas
         SET situacao = 'encerrada', motivo_encerramento = _r.encerrar_apos_envio,
             ultima_enviada_em = _r.atualizado_em, ultimo_texto_enviado = _r.texto_aprovado,
             aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL,
             erro = 'envio sem confirmação: o e-mail pode ter saído', atualizado_em = now()
       WHERE id = _r.id;
    ELSE
      UPDATE public.portal_cobrancas
         SET situacao = 'agendada', ultima_enviada_em = _r.atualizado_em, ultimo_texto_enviado = _r.texto_aprovado,
             vence_em = _r.atualizado_em + interval '7 days',
             aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL,
             erro = 'envio sem confirmação: o e-mail pode ter saído; confira na caixa de enviados do Gmail',
             atualizado_em = now()
       WHERE id = _r.id;
      -- 'aviso' (e não cobrar_troca): a cobrança está agendada, não esperando decisão; um cobrar_troca
      -- aberto mostraria um Enviar que seria recusado e ocuparia o único A fazer aberto da cobrança.
      INSERT INTO public.portal_afazeres (tenant_id, account_id, project_id, tipo, titulo, mensagem)
      VALUES (_r.tenant_id, _r.account_id, _r.project_id, 'aviso',
              left('📡 A cobrança da nota ' || coalesce(public.ludmilla_nota_na_tela(_r.nota_servico), 'sem número') || ' pode ter saído sem confirmação', 200),
              left('O robô começou o envio e não confirmou. O e-mail pode ter saído sem confirmação: confira na caixa de enviados do Gmail. '
                   || 'Por segurança, a próxima cobrança desta nota só vence em '
                   || to_char((_r.atualizado_em + interval '7 days') AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.', 1000));
      _n := _n + 1;
    END IF;
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

-- ── 5. Comentário do card (visível à empresa) e histórico ───────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_enviada(p_run_id UUID, p_message_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _run public.portal_sync_runs%ROWTYPE; _c public.portal_cobrancas%ROWTYPE;
  _quem UUID; _nome TEXT; _nota TEXT; _tarde BOOLEAN; _enviadas INTEGER;
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra o envio';
  END IF;
  SELECT * INTO _run FROM public.portal_sync_runs s WHERE s.id = p_run_id AND s.tipo = 'enviar_cobranca' FOR UPDATE;
  IF _run.id IS NULL THEN RAISE EXCEPTION 'nenhuma cobrança em envio para o run %', p_run_id; END IF;
  IF _run.situacao = 'ok' THEN RETURN; END IF;   -- já confirmado
  _tarde := _run.situacao = 'erro' AND coalesce(_run.resultado ->> 'sem_confirmacao', '') = 'true';
  IF _run.situacao <> 'rodando' AND NOT _tarde THEN
    RAISE EXCEPTION 'nenhuma cobrança em envio para o run % (situação do run: %)', p_run_id, _run.situacao;
  END IF;

  SELECT * INTO _c FROM public.portal_cobrancas c
   WHERE c.id = nullif(_run.dados ->> 'cobranca_id', '')::uuid AND c.account_id = _run.account_id FOR UPDATE;
  IF _c.id IS NULL OR (NOT _tarde AND (_c.run_id IS DISTINCT FROM p_run_id OR _c.situacao <> 'enviando')) THEN
    RAISE EXCEPTION 'nenhuma cobrança em envio para o run %', p_run_id;
  END IF;

  -- quem aprovou: a cobrança ainda guarda (caso normal); no atraso o reset já a limpou, mas o run guarda
  -- (portal_sync_runs.pedido_por = quem clicou em Enviar)
  _quem := CASE WHEN _tarde THEN _run.pedido_por ELSE _c.aprovada_por END;
  SELECT pr.name INTO _nome FROM public.profiles pr WHERE pr.id = _quem;
  _nota := coalesce(public.ludmilla_nota_na_tela(_c.nota_servico), 'sem número');   -- R3: o texto leva a nota como a ENEL a escreve (sem o zero)
  _enviadas := _c.enviadas + 1;

  IF NOT _tarde THEN
    UPDATE public.portal_cobrancas
       SET situacao = CASE WHEN _c.encerrar_apos_envio IS NOT NULL THEN 'encerrada' ELSE 'agendada' END,
           motivo_encerramento = coalesce(_c.encerrar_apos_envio, motivo_encerramento),
           enviadas = _enviadas, ultima_enviada_em = now(),
           ultimo_texto_enviado = _c.texto_aprovado, vence_em = now() + interval '7 days',
           aprovada_por = NULL, aprovada_em = NULL, texto_aprovado = NULL, erro = NULL, atualizado_em = now()
     WHERE id = _c.id;
  ELSE
    UPDATE public.portal_cobrancas
       SET enviadas = _enviadas,
           erro = CASE WHEN erro LIKE 'envio sem confirmação%' THEN NULL ELSE erro END,
           atualizado_em = now()
     WHERE id = _c.id;
  END IF;

  IF _c.project_id IS NOT NULL THEN
    -- comentário COMUM do card: a empresa integradora dona do projeto o enxerga (decisão do usuário,
    -- 25/10/2026). Não usar type 'internal'. R1 (M-5): SEM o endereço de destino (pode ser o e-mail
    -- pessoal de um analista da ENEL); ele fica só em portal_cobrancas, que só a equipe lê.
    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_c.project_id, _ludmilla,
            '📡 Ludmilla: cobrança da nota ' || _nota || ' enviada à ENEL, aprovada por '
            || coalesce(_nome, 'alguém da equipe') || '.',
            'comment');
    INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
    VALUES (_c.project_id, 'Cobrança enviada à ENEL',
            'Cobrança da nota ' || _nota || ' enviada à ENEL; aprovada por ' || coalesce(_nome, 'alguém da equipe') || '.',
            coalesce(_quem, _ludmilla), coalesce(_nome, 'Ludmilla'));
  END IF;

  UPDATE public.portal_sync_runs
     SET situacao = 'ok', terminado_em = CASE WHEN _tarde THEN terminado_em ELSE now() END, erro = NULL,
         resultado = (coalesce(resultado, '{}'::jsonb) - 'sem_confirmacao')
                     || jsonb_build_object('cobranca_id', _c.id, 'nota', _c.nota_servico, 'para', _c.para,
                                           'enviada', _enviadas, 'message_id', left(p_message_id, 300),
                                           'confirmada_tarde', _tarde)
   WHERE id = p_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_enviada(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_enviada(UUID, TEXT) TO service_role;

-- ── 6. O A fazer "não saiu" ─────────────────────────────────────────────────
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
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO _c FROM public.portal_cobrancas c
   WHERE c.run_id = p_run_id AND c.situacao IN ('enviando', 'aguardando_envio') FOR UPDATE;
  IF _c.id IS NULL THEN RETURN; END IF;
  IF _c.encerrar_apos_envio IS NOT NULL THEN
    UPDATE public.portal_cobrancas
       SET situacao = 'encerrada', motivo_encerramento = _c.encerrar_apos_envio,
           aprovada_por = NULL, aprovada_em = NULL, erro = _erro, atualizado_em = now()
     WHERE id = _c.id;
    RETURN;
  END IF;
  UPDATE public.portal_cobrancas
     SET situacao = 'aguardando_envio', aprovada_por = NULL, aprovada_em = NULL, erro = _erro, atualizado_em = now()
   WHERE id = _c.id;
  PERFORM public.ludmilla_cobranca_abrir_afazer(_c.id,
    '📡 A cobrança da nota ' || coalesce(public.ludmilla_nota_na_tela(_c.nota_servico), 'sem número') || ' não saiu',
    'O envio falhou: ' || _erro || '. Confira a pasta Enviados do Gmail antes de enviar de novo.');
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) TO service_role;

-- ── 7. O A fazer "o robô parou antes de enviar" ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_agendar_email()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _a RECORD; _r RECORD; _c public.portal_cobrancas%ROWTYPE;
BEGIN
  FOR _a IN SELECT a.id, a.tenant_id FROM public.portal_accounts a
             WHERE a.enabled AND a.acompanhamento = 'email' AND a.identificacao = 'remetente'
               AND coalesce(a.modo, 'vps') <> 'local'
               -- R2: só o tenant biblioteca (GD Manager); a Ludmilla é só dele
               AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id AND t.is_library) LOOP

    -- R2: run que morreu em 'rodando' há mais de 2 horas (o robô parou no meio): fecha, senão a conta
    -- fica pulada para sempre. 'na_fila' não é tocado (a fila é do worker).
    FOR _r IN SELECT r.id, r.tipo FROM public.portal_sync_runs r
               WHERE r.account_id = _a.id AND r.situacao = 'rodando'
                 AND r.iniciado_em < now() - interval '2 hours' LOOP
      _c := NULL;
      IF _r.tipo = 'enviar_cobranca' THEN
        -- trava a cobrança ANTES de decidir: ludmilla_cobranca_iniciar_envio espera nesta trava
        SELECT * INTO _c FROM public.portal_cobrancas c WHERE c.run_id = _r.id FOR UPDATE;
        -- cobrança 'enviando': o reset de 30 min (ludmilla_cobrancas_abrir_vencidas) é o dono; nem o run se toca
        IF _c.id IS NOT NULL AND _c.situacao = 'enviando' THEN CONTINUE; END IF;
      END IF;
      UPDATE public.portal_sync_runs
         SET situacao = 'erro', terminado_em = now(),
             erro = 'o robô parou no meio e o run foi fechado pela leitura agendada (rodando há mais de 2 horas)'
       WHERE id = _r.id AND situacao = 'rodando';
      IF NOT FOUND THEN CONTINUE; END IF;
      -- enviar_cobranca que caiu ANTES de iniciar_envio: nada saiu; volta para a equipe, que pode aprovar de novo
      IF _r.tipo = 'enviar_cobranca' AND _c.id IS NOT NULL AND _c.situacao = 'aguardando_envio' THEN
        UPDATE public.portal_cobrancas
           SET aprovada_por = NULL, aprovada_em = NULL, erro = 'o robô parou antes de enviar; nada saiu', atualizado_em = now()
         WHERE id = _c.id;
        PERFORM public.ludmilla_cobranca_abrir_afazer(_c.id,
          '📡 A cobrança da nota ' || coalesce(public.ludmilla_nota_na_tela(_c.nota_servico), 'sem número') || ' não saiu (o robô parou antes de enviar)',
          'O robô parou antes de enviar; nada saiu — pode clicar em Enviar de novo.');
      END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.portal_sync_runs r
                    WHERE r.account_id = _a.id AND r.situacao IN ('na_fila', 'rodando')) THEN
      INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo) VALUES (_a.tenant_id, _a.id, 'varredura_email');
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_agendar_email() FROM PUBLIC, anon, authenticated, service_role;

-- ── 8. O Registro ───────────────────────────────────────────────────────────
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
                WHEN r.tipo = 'enviar_cobranca' THEN 'nota ' || coalesce(public.ludmilla_nota_na_tela(r.resultado ->> 'nota'), 'sem número') || coalesce(' para ' || (r.resultado ->> 'para'), '') -- NOVO (24/10/2026)
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

NOTIFY pgrst, 'reload schema';

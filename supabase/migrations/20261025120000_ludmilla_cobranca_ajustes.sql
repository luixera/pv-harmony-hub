-- ============================================================================
-- LUDMILLA — cobrança da troca do relógio: ajustes da revisão (rodada 1, 25/10/2026)
-- Corrige 20261024150000_ludmilla_cobranca_troca.sql (commit 6d471c9, já no ar).
-- Plano: docs/superpowers/plans/2026-10-24-ludmilla-enel-cobranca-troca.md (Task 1).
--
-- I-1  O robô conseguia aprovar. ludmilla_equipe_ok() aceita os perfis-agente (Ludmilla
--      00000000-10d1-…02, Bidu 00000000-b1d0-…01) e não olha active. NÃO se mexe nela (muita coisa
--      a usa). Ajudante novo ludmilla_pessoa_da_equipe(uid): perfil active, admin/staff, do tenant
--      biblioteca, COM identidade de login em auth.identities (as pessoas têm 1, provedor email; os
--      agentes têm 0 e não têm senha). aprovar recusa quem não é pessoa; iniciar_envio confere de
--      novo que aprovada_por é pessoa ATIVA do MESMO tenant da cobrança.
-- I-2  Envio que saiu sem registro. O reset de 30 min deixava o run rodando para sempre (e
--      ludmilla_agendar_email pula conta com run aberto: a leitura de hora em hora PARAVA) e devolvia
--      a cobrança com ultima_enviada_em NULL (nova aprovação mandava o 2º e-mail no mesmo dia).
--      Regra: e-mail para a ENEL nunca sai em dobro. No reset o run fecha com erro ('envio sem
--      confirmação'), o e-mail é tratado como POSSIVELMENTE enviado (ultima_enviada_em = início do
--      envio, cobrança agendada, vence_em = início + 7 dias) e abre um aviso "pode ter saído sem
--      confirmação — confira na caixa de enviados". ludmilla_cobranca_enviada aceita a confirmação
--      ATRASADA pelo run_id (registra histórico e comentário e soma enviadas, sem mexer em vence_em).
-- M-3  A trava do destinatário aceitava '%' (x%evil.com@enel.com): tirado da expressão.
--      O worker (REGEX_DESTINATARIO_ENEL) tem de usar a MESMA: ^[a-z0-9][a-z0-9._+-]*@(br\.)?enel\.com$
-- M-4  in_reply_to / references / assunto: nenhum caractere de controle (nem CR/LF, nem C0/C1/DEL);
--      References com no máximo 20 itens e 2000 caracteres.
-- M-5  O comentário visível à empresa (e o histórico) NÃO levam mais o endereço de destino. O endereço
--      fica só em portal_cobrancas / portal_sync_runs, que só a equipe lê.
-- M-6  Cobrança em 'enviando': uma "troca realizada" (ou projeto concluído, ou nota nova) que chega durante
--      o envio era desfeita por _enviada, que reagendava. Agora marca a linha (encerrar_apos_envio) e
--      _enviada / _falhou / o reset encerram em vez de reagendar.
--
-- md5 do prosrc VIVO de cada função reescrita, ANTES desta migração (cada corpo abaixo é cópia dele,
-- com as mudanças marcadas R1, exceto ludmilla_cobranca_enviada e ludmilla_cobranca_falhou, que são
-- reescritas):
--   ludmilla_endereco_da_enel             a19170e6b7964b010b801c448a48a29f
--   ludmilla_cobranca_agendar             b93d7c88e13bdd60ed6b6a6d03ff100a
--   ludmilla_cobranca_encerrar_por_troca  33403a7afa6872999a0cdb14e88488da
--   ludmilla_cobrancas_abrir_vencidas     9c8bfdd6308d0c915745e199e823818f
--   ludmilla_cobranca_aprovar             413af61ed6ee9acadd7def267ab5d9f0
--   ludmilla_cobranca_iniciar_envio       dfe7707c6a81ac7ab7d831d5776a5bde
--   ludmilla_cobranca_enviada             933557373cb87490dc00b1186b2fe526
--   ludmilla_cobranca_falhou              b5462587e533a05f798dedfba5bf535e
--
-- NÃO mexe em: ludmilla_equipe_ok (144f52037d242b2c3e267169c80fcad0), ludmilla_agendar_varreduras (CPFL, 3d0d2d0f1e7455ec701230bc925e1bde),
-- ludmilla_aplicar_update (6183edef6c3f93810282039bdd565a26), ludmilla_email_registrar (5d5375a0cb842209b6fb5f82327ee579),
-- ludmilla_agendar_email (e486208f018c409bdea145375e76cee3), ludmilla_claim_run, ludmilla_registro, nem nos crons.
-- As assinaturas das funções ficam como estão; a única função nova é ludmilla_pessoa_da_equipe(uuid), sem
-- EXECUTE para ninguém de fora.
-- ============================================================================


-- ── 1. A trava do destinatário (M-3): sem '%' ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_endereco_da_enel(p_endereco TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(p_endereco ~ '^[a-z0-9][a-z0-9._+-]*@(br\.)?enel\.com$', FALSE);
$$;
REVOKE ALL ON FUNCTION public.ludmilla_endereco_da_enel(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_endereco_da_enel(TEXT) TO authenticated, service_role;


-- ── 2. Quem é uma PESSOA da equipe (I-1) ────────────────────────────────────
-- ludmilla_equipe_ok() deixa passar os perfis-agente e não olha active; aqui só passa quem tem
-- login de verdade. Só as outras funções SECURITY DEFINER chamam (ninguém de fora tem EXECUTE).
CREATE OR REPLACE FUNCTION public.ludmilla_pessoa_da_equipe(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.tenants t ON t.id = p.tenant_id AND t.is_library
     WHERE p.id = p_uid
       AND p.active
       AND p.role IN ('admin', 'staff')
       AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p.id)
  );
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pessoa_da_equipe(UUID) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ludmilla_pessoa_da_equipe(UUID) IS
  'True só para perfil ativo admin/staff do tenant biblioteca com identidade de login (auth.identities). Exclui os agentes (Ludmilla, Bidu). Interna: sem EXECUTE para ninguém de fora.';


-- ── 3. A tabela: marca de "encerrar quando o envio acabar" (M-6) e cabeçalhos mais estritos (M-4) ──
ALTER TABLE public.portal_cobrancas ADD COLUMN IF NOT EXISTS encerrar_apos_envio TEXT;
COMMENT ON COLUMN public.portal_cobrancas.encerrar_apos_envio IS
  'Motivo para encerrar a cobrança quando o envio em andamento acabar (troca feita, projeto concluído, nota substituída). Só existe enquanto situacao = enviando; _enviada/_falhou/o reset encerram em vez de reagendar.';

ALTER TABLE public.portal_cobrancas DROP CONSTRAINT IF EXISTS portal_cobrancas_assunto_check;
ALTER TABLE public.portal_cobrancas ADD CONSTRAINT portal_cobrancas_assunto_check
  CHECK (length(assunto) BETWEEN 1 AND 300 AND assunto !~ '[[:cntrl:]\u007f-\u009f]');
ALTER TABLE public.portal_cobrancas DROP CONSTRAINT IF EXISTS portal_cobrancas_in_reply_to_check;
ALTER TABLE public.portal_cobrancas ADD CONSTRAINT portal_cobrancas_in_reply_to_check
  CHECK (in_reply_to IS NULL OR in_reply_to ~ '^<[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>$');
ALTER TABLE public.portal_cobrancas DROP CONSTRAINT IF EXISTS portal_cobrancas_referencias_check;
ALTER TABLE public.portal_cobrancas ADD CONSTRAINT portal_cobrancas_referencias_check
  CHECK (referencias IS NULL OR (length(referencias) <= 2000 AND referencias ~ '^<[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>( <[^<>[:cntrl:][:space:]\u007f-\u009f]+@[^<>[:cntrl:][:space:]\u007f-\u009f]+>){0,19}$'));


-- ── 4. O robô agenda e encerra pela troca (M-4, M-6) ────────────────────────
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
        UPDATE public.portal_cobrancas SET encerrar_apos_envio = 'substituída pela nota ' || _nota
         WHERE id = _velha.id AND encerrar_apos_envio IS NULL;
      ELSE
        UPDATE public.portal_cobrancas
           SET situacao = 'encerrada', motivo_encerramento = 'substituída pela nota ' || _nota, atualizado_em = now()
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
  -- R1 (M-6): com o envio EM ANDAMENTO não dá para desfazer; marca, e ludmilla_cobranca_enviada / _falhou
  -- encerram em vez de reagendar. Não mexe em atualizado_em (é o início do envio).
  FOR _id IN SELECT c.id FROM public.portal_cobrancas c
              WHERE c.account_id = p_account_id AND c.project_id = p_project_id
                AND c.situacao = 'enviando' AND c.encerrar_apos_envio IS NULL
                AND c.data_nota <= coalesce(p_quando, now())
              FOR UPDATE LOOP
    UPDATE public.portal_cobrancas SET encerrar_apos_envio = 'a ENEL avisou que a troca do relógio foi feita' WHERE id = _id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_encerrar_por_troca(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_encerrar_por_troca(UUID, UUID, TIMESTAMPTZ) TO service_role;


-- ── 5. O agendamento: envio sem confirmação e envio em andamento (I-2, M-6) ──
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
              left('📡 A cobrança da nota ' || coalesce(_r.nota_servico, 'sem número') || ' pode ter saído sem confirmação', 200),
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


-- ── 6. Aprovar e iniciar o envio: só PESSOA da equipe (I-1) ─────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_cobranca_aprovar(p_cobranca_id UUID, p_texto TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid UUID := (SELECT auth.uid()); _tenant UUID; _c public.portal_cobrancas%ROWTYPE;
  _texto TEXT := btrim(coalesce(p_texto, '')); _run UUID; _quem TEXT; _lacuna TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  -- R1 (I-1): ludmilla_equipe_ok() também aceita os perfis-agente (Ludmilla, Bidu) e não olha active.
  -- Aprovar o envio de um e-mail para a ENEL é ato de uma PESSOA da equipe.
  IF NOT public.ludmilla_pessoa_da_equipe(_uid) THEN
    RAISE EXCEPTION 'Só uma pessoa da equipe pode aprovar o envio de uma cobrança.';
  END IF;
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
      -- R1 (I-1): quem aprovou tem de ser, AGORA, uma pessoa ativa da equipe, do MESMO tenant da cobrança
      WHEN NOT public.ludmilla_pessoa_da_equipe(_c.aprovada_por)
           OR NOT EXISTS (SELECT 1 FROM public.profiles pa WHERE pa.id = _c.aprovada_por AND pa.tenant_id = _c.tenant_id)
        THEN 'a aprovação não é de uma pessoa ativa da equipe deste tenant'
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


-- ── 7. Saiu / não saiu (I-2, M-5, M-6) ──────────────────────────────────────
-- Saiu: histórico (a pessoa que aprovou é a autora), comentário no card (assinado pela Ludmilla, SEM o
-- endereço de destino), a próxima em 7 dias, e o run fechado. Pelo run_id do envio, em dois casos:
--   * normal: o run está 'rodando' e a cobrança 'enviando';
--   * confirmação ATRASADA: o reset de 30 min já fechou o run com erro (resultado.sem_confirmacao). O e-mail
--     saiu mesmo: registra histórico e comentário, soma enviadas e fecha o run como ok, SEM mexer em
--     ultima_enviada_em nem vence_em (a trava dos 7 dias continua a do início do envio).
-- Repetir a chamada com um run já confirmado não faz nada (o worker pode repetir depois de uma falha de rede).
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
  _nota := coalesce(_c.nota_servico, 'sem número');
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

-- Não saiu (ou foi recusada): fecha o run com erro e, se a cobrança é DESTE run, devolve à equipe sem a
-- aprovação (o texto fica como rascunho) e com um A fazer dizendo por quê. Não tenta de novo sozinha.
-- R1: (a) só age se o run ainda estava aberto (um run já fechado, p.ex. pelo reset de 30 min, não reabre
-- nada nem cria A fazer "não saiu" para um e-mail que pode ter saído); (b) se a cobrança estava marcada
-- para encerrar (troca feita etc.), encerra em vez de pedir novo envio.
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
    '📡 A cobrança da nota ' || coalesce(_c.nota_servico, 'sem número') || ' não saiu',
    'O envio falhou: ' || _erro || '. Confira a pasta Enviados do Gmail antes de enviar de novo.');
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_cobranca_falhou(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

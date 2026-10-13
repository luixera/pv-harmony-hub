-- supabase/migrations/20261006120000_ludmilla_email_reprocessa.sql
-- Ludmilla (e-mail): as correções de BANCO da revisão do run `varredura_email`.
--
-- C1 (crítica) — a mensagem era QUEIMADA mesmo quando nada de útil saía dela:
--   `ludmilla_email_mensagem_nova` respondia "já vi" e nenhum run futuro tentava
--   de novo. IA sem resposta, regra mal configurada ou anexo que não subiu
--   faziam o documento desaparecer em silêncio, recuperável só com DELETE à mão.
--   Agora "eu já VI" e "eu já TERMINEI" são coisas diferentes: `concluida` +
--   `tentativas` (teto 5, para PDF permanentemente ilegível não virar laço).
-- C8 — a chave de "já tratei" passa a ser (conta, mensagem, PROTOCOLO): assunto
--   que cita dois protocolos precisa chegar aos dois projetos.
-- C11 — fica registrado QUAL anexo a IA leu.
-- C3 — o comentário no card do cliente dizia "emitido pela CPFL" num parecer da
--   EDP, e "titular/UC conferidos" quando só o protocolo foi conferido.
-- C12 — `ultima_varredura_em` do run de e-mail só sobe quando nada falhou.
--
-- As funções que o caminho de PORTAL também usa (`ludmilla_anexo_enviado`,
-- `ludmilla_anexo_enviado_local`, `ludmilla_finalizar_run_impl`) são copiadas
-- INTEIRAS da definição mais recente — `CREATE OR REPLACE` troca o corpo todo.
-- Conferido por md5(prosrc) antes de copiar.

-- ── 1. C1/C8/C11: separar "já vi" de "já terminei" ──────────────────────────
ALTER TABLE public.portal_email_mensagens
  ADD COLUMN IF NOT EXISTS concluida    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tentativas   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arquivo_lido TEXT,
  ADD COLUMN IF NOT EXISTS update_id    UUID REFERENCES public.portal_updates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.portal_email_mensagens.concluida IS
  'TRUE = não há mais nada a fazer com esta mensagem (tratada, ou nenhuma regra casou). FALSE = falha passageira (IA, anexo, banco) e um run futuro tenta de novo. Limpar este campo é a ação "reler".';
COMMENT ON COLUMN public.portal_email_mensagens.tentativas IS
  'Quantas vezes o robô já tratou esta mensagem. A partir de 5 ela para de ser reprocessada, para PDF permanentemente ilegível não virar laço infinito.';
COMMENT ON COLUMN public.portal_email_mensagens.arquivo_lido IS
  'Nome do anexo que a IA leu (o PDF MAIOR do e-mail), para a tela poder mostrar de qual documento saiu o veredito.';
COMMENT ON COLUMN public.portal_email_mensagens.update_id IS
  'A recomendação (portal_updates) que esta mensagem gerou. Na repetição ela é ATUALIZADA, nunca duplicada.';

-- C8: dois protocolos no mesmo assunto chegam a dois projetos, e cada um tem a
-- sua linha. A chave antiga (account_id, message_id) fazia o segundo projeto
-- ouvir "já tratei" e perder o documento, em silêncio.
ALTER TABLE public.portal_email_mensagens DROP CONSTRAINT IF EXISTS portal_email_mensagens_unica;
ALTER TABLE public.portal_email_mensagens
  ADD CONSTRAINT portal_email_mensagens_unica UNIQUE (account_id, message_id, protocolo);

-- ── 2. C1: a pergunta deixa de ser "é nova?" e passa a ser "preciso tratar?" ──
CREATE OR REPLACE FUNCTION public.ludmilla_email_mensagem_pendente(
  p_account_id UUID, p_message_id TEXT, p_protocolo TEXT
) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  -- TRUE quando não há linha, OU quando a linha existe e não terminou
  -- (`concluida = FALSE`) e ainda tem tentativa no teto.
  SELECT (SELECT auth.role()) = 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.portal_email_mensagens m
        WHERE m.account_id = p_account_id
          AND m.message_id = p_message_id
          AND m.protocolo  = p_protocolo
          AND (m.concluida OR m.tentativas >= 5));
$$;
COMMENT ON FUNCTION public.ludmilla_email_mensagem_pendente(UUID, TEXT, TEXT) IS
  'Preciso tratar esta mensagem neste protocolo? TRUE sem linha, ou com linha não concluída e tentativas < 5.';

-- A antiga some: só o worker a chamava (conferido com Grep em src/, worker/ e
-- supabase/), e ela respondia a pergunta errada.
DROP FUNCTION IF EXISTS public.ludmilla_email_mensagem_nova(UUID, TEXT);

REVOKE ALL ON FUNCTION public.ludmilla_email_mensagem_pendente(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_mensagem_pendente(UUID, TEXT, TEXT) TO service_role;

-- ── 3. C1/C8/C11: o registro grava `concluida`, conta a tentativa e não duplica
-- a recomendação. Cópia da definição mais recente
-- (20261002140000_ludmilla_email_correcoes.sql, md5 be0104c3…) com:
--   · dois parâmetros novos (`p_concluida`, `p_arquivo_lido`);
--   · ON CONFLICT pela chave de três colunas, agora DO UPDATE (antes DO NOTHING)
--     incrementando `tentativas`;
--   · a recomendação da repetição ATUALIZA a linha de portal_updates que esta
--     mensagem já criou, em vez de abrir outra (e não mexe no que a equipe já
--     decidiu).
DROP FUNCTION IF EXISTS public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.ludmilla_email_registrar(
  p_run_id UUID, p_account_id UUID, p_message_id TEXT, p_protocolo TEXT,
  p_project_id UUID, p_assunto TEXT, p_remetente TEXT, p_recebido_em TIMESTAMPTZ,
  p_tipo_documento TEXT, p_veredito TEXT, p_resumo TEXT, p_anexos INTEGER,
  p_motivo TEXT, p_recomendacao TEXT, p_concluida BOOLEAN, p_arquivo_lido TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE; _msg UUID; _proj public.projects%ROWTYPE;
  _upd UUID; _tentativa INTEGER; _status TEXT; _raw JSONB;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra e-mails lidos';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;

  -- a recomendação que esta mensagem já abriu, se for repetição
  SELECT m.update_id INTO _upd
    FROM public.portal_email_mensagens m
   WHERE m.account_id = p_account_id AND m.message_id = p_message_id AND m.protocolo = p_protocolo;

  INSERT INTO public.portal_email_mensagens AS m
    (tenant_id, account_id, run_id, message_id, protocolo, project_id, assunto, remetente,
     recebido_em, tipo_documento, veredito, resumo, anexos, motivo,
     concluida, tentativas, arquivo_lido)
  VALUES
    (_conta.tenant_id, p_account_id, p_run_id, p_message_id, p_protocolo, p_project_id,
     left(p_assunto, 300), left(p_remetente, 200), p_recebido_em, p_tipo_documento,
     p_veredito, left(p_resumo, 2000), coalesce(p_anexos, 0), left(p_motivo, 500),
     coalesce(p_concluida, FALSE), 1, left(p_arquivo_lido, 300))
  ON CONFLICT (account_id, message_id, protocolo) DO UPDATE SET
     run_id         = excluded.run_id,
     project_id     = excluded.project_id,
     assunto        = excluded.assunto,
     remetente      = excluded.remetente,
     recebido_em    = excluded.recebido_em,
     tipo_documento = excluded.tipo_documento,
     veredito       = excluded.veredito,
     resumo         = excluded.resumo,
     -- anexo que já chegou ao card não "desaparece" porque a repetição achou 0
     anexos         = greatest(m.anexos, excluded.anexos),
     motivo         = excluded.motivo,
     concluida      = excluded.concluida,
     arquivo_lido   = coalesce(excluded.arquivo_lido, m.arquivo_lido),
     tentativas     = m.tentativas + 1
  RETURNING m.id, m.tentativas INTO _msg, _tentativa;

  IF p_project_id IS NULL THEN RETURN _msg; END IF;

  SELECT * INTO _proj FROM public.projects WHERE id = p_project_id;
  _status := upper(coalesce(p_tipo_documento, 'e-mail')) || coalesce(' · ' || upper(p_veredito), '');
  _raw := jsonb_build_object('assunto', p_assunto, 'remetente', p_remetente,
                             'resumo', p_resumo, 'anexos', coalesce(p_anexos, 0),
                             'motivo', p_motivo, 'arquivo_lido', p_arquivo_lido,
                             'tentativa', _tentativa);

  IF _upd IS NULL THEN
    INSERT INTO public.portal_updates
      (tenant_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
       project_id, casamento, recomendacao, situacao, detectado_em, raw)
    VALUES
      (_conta.tenant_id, p_account_id, p_protocolo, NULL, _status,
       _proj.status::text, p_project_id, 'protocolo', p_recomendacao, 'pendente', now(), _raw)
    RETURNING id INTO _upd;
    UPDATE public.portal_email_mensagens SET update_id = _upd WHERE id = _msg;
  ELSE
    -- Repetição (a IA falhou e agora respondeu, por exemplo): a MESMA linha é
    -- corrigida. Se a equipe já aplicou ou ignorou, nada muda.
    UPDATE public.portal_updates
       SET status_portal = _status, recomendacao = p_recomendacao, raw = _raw, detectado_em = now()
     WHERE id = _upd AND situacao = 'pendente';
  END IF;
  RETURN _msg;
END;
$$;

REVOKE ALL ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT)
  TO service_role;

-- ── 4. C1 (caso 3): anexo parado em `pendente`/`erro` pode ser retomado ───────
-- Sem isto a correção C1 não se completa: a mensagem volta a ser tratada, mas a
-- linha do anexo já existe, o ON CONFLICT DO NOTHING devolve vazio e o arquivo
-- NUNCA sobe. Agora a linha que ficou `pendente` (run morreu no meio) ou `erro`
-- (storage recusou) volta para `pendente` e é devolvida para nova tentativa.
-- Linha `enviado` ou `bloqueado` continua devolvendo vazio — aí não há o que
-- refazer. Cópia da definição mais recente (md5 2b85e9dd…); só o ON CONFLICT muda.
CREATE OR REPLACE FUNCTION public.ludmilla_email_anexo_novo(
  p_account_id UUID, p_protocolo TEXT, p_project_id UUID,
  p_message_id TEXT, p_nome_arquivo TEXT, p_conferido_por TEXT
) RETURNS TABLE (anexo_id UUID, company_id UUID, codigo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _proj public.projects%ROWTYPE; _id UUID;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra anexos de e-mail';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  SELECT * INTO _proj  FROM public.projects WHERE id = p_project_id AND tenant_id = _conta.tenant_id;
  IF _proj.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.portal_anexos AS x
    (tenant_id, account_id, protocolo, project_id, id_arquivo, nome_arquivo, situacao, conferido_por)
  VALUES
    (_conta.tenant_id, p_account_id, p_protocolo, p_project_id,
     p_message_id || '#' || p_nome_arquivo, p_nome_arquivo, 'pendente', p_conferido_por)
  ON CONFLICT (account_id, id_arquivo) DO UPDATE
     SET situacao = 'pendente', motivo = NULL, conferido_por = excluded.conferido_por
   WHERE x.situacao IN ('pendente', 'erro')
  RETURNING x.id INTO _id;
  IF _id IS NULL THEN RETURN; END IF;

  RETURN QUERY SELECT _id, _proj.company_id, _proj.code;
END;
$$;

-- ── 5. C3: o comentário no card diz a VERDADE ────────────────────────────────
-- Era literal: 'Anexo emitido pela CPFL … (titular/UC conferidos por …)'. Num
-- parecer da EDP a empresa integradora lia "emitido pela CPFL", e lia que
-- "titular/UC" foram conferidos quando só o protocolo tinha sido.
-- A frase vira uma função só, usada pelas DUAS variantes (normal e `_local`),
-- justamente para não divergirem outra vez.
CREATE OR REPLACE FUNCTION public.ludmilla_anexo_frase(
  p_account_id UUID, p_protocolo TEXT, p_conferido_por TEXT, p_nome_arquivo TEXT
) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT '📡 Anexo emitido pela '
      || coalesce((SELECT coalesce(c.name, upper(a.connector))
                     FROM public.portal_accounts a
                     LEFT JOIN public.energy_concessionaires c ON c.id = a.concessionaire_id
                    WHERE a.id = p_account_id), 'concessionária')
      || ' para o protocolo ' || coalesce(p_protocolo, '?')
      || ' (' || CASE p_conferido_por
                   WHEN 'cpf'       THEN 'titular conferido pelo CPF'
                   WHEN 'uc'        THEN 'UC conferida'
                   WHEN 'titular'   THEN 'titular conferido'
                   WHEN 'endereco'  THEN 'endereço conferido'
                   WHEN 'protocolo' THEN 'conferido pelo número do protocolo'
                   ELSE 'sem conferência registrada' END
      || ').' || E'\n📎 ' || coalesce(p_nome_arquivo, 'arquivo');
$$;
COMMENT ON FUNCTION public.ludmilla_anexo_frase(UUID, TEXT, TEXT, TEXT) IS
  'O texto do comentário do anexo no card: nome da concessionária da conta + o que de fato foi conferido. Uma só, para as variantes normal e _local não divergirem.';
REVOKE ALL ON FUNCTION public.ludmilla_anexo_frase(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Cópia INTEIRA da definição mais recente (20260915130000, md5 8cff60e3…).
-- Única mudança: o texto do comentário sai de `ludmilla_anexo_frase`. Lógica,
-- assinatura, efeitos e ordem continuam idênticos — é o caminho do portal.
CREATE OR REPLACE FUNCTION public.ludmilla_anexo_enviado(p_anexo_id UUID, p_file_path TEXT, p_file_type TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _a   public.portal_anexos%ROWTYPE;
  _doc UUID;
  _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra anexos';
  END IF;
  SELECT * INTO _a FROM public.portal_anexos WHERE id = p_anexo_id AND situacao = 'pendente';
  IF _a.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.documents (project_id, document_type, file_name, file_url, file_type, uploaded_by)
  VALUES (_a.project_id, 'other_photos', _a.nome_arquivo, p_file_path, p_file_type, _ludmilla)
  RETURNING id INTO _doc;

  INSERT INTO public.comments (project_id, user_id, message)
  VALUES (_a.project_id, _ludmilla,
          public.ludmilla_anexo_frase(_a.account_id, _a.protocolo, _a.conferido_por, _a.nome_arquivo));

  UPDATE public.portal_anexos SET situacao = 'enviado', document_id = _doc, enviado_em = now(), motivo = NULL
   WHERE id = _a.id;
END;
$$;

-- Cópia INTEIRA da definição mais recente (20260915170000, md5 1aea720f…),
-- com a mesma e única mudança.
CREATE OR REPLACE FUNCTION public.ludmilla_anexo_enviado_local(p_anexo_id UUID, p_file_path TEXT, p_file_type TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _a public.portal_anexos%ROWTYPE; _doc UUID;
        _ludmilla CONSTANT UUID := '00000000-10d1-4000-8000-000000000002';
BEGIN
  SELECT * INTO _a FROM public.portal_anexos WHERE id = p_anexo_id AND situacao = 'pendente';
  IF _a.id IS NULL OR NOT public.ludmilla_operador_ok(_a.account_id) THEN
    RAISE EXCEPTION 'permission denied: só o operador da estação registra este anexo';
  END IF;
  INSERT INTO public.documents (project_id, document_type, file_name, file_url, file_type, uploaded_by)
  VALUES (_a.project_id, 'other_photos', _a.nome_arquivo, p_file_path, p_file_type, _ludmilla)
  RETURNING id INTO _doc;
  INSERT INTO public.comments (project_id, user_id, message)
  VALUES (_a.project_id, _ludmilla,
          public.ludmilla_anexo_frase(_a.account_id, _a.protocolo, _a.conferido_por, _a.nome_arquivo));
  UPDATE public.portal_anexos SET situacao = 'enviado', document_id = _doc, enviado_em = now(), motivo = NULL WHERE id = _a.id;
END;
$$;

-- ── 6. C12: `ultima_varredura_em` do e-mail só sobe quando nada falhou ───────
-- Com a IMAP morrendo depois do primeiro protocolo, `limpos=1` e `falhas=7`
-- fechavam o run como `ok` e o cartão dizia "verificado agora" tendo conferido
-- 1 de 8. O ramo de `'varredura'` (portal) fica EXATAMENTE como está.
-- Cópia INTEIRA da definição mais recente (20261005130000, md5 c98b15bb…).
CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run_impl(
  p_run_id UUID, p_situacao TEXT, p_erro TEXT, p_resultado JSONB, p_print_path TEXT,
  p_protocolos INTEGER, p_mudancas INTEGER, p_situacao_conta TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID; _tipo TEXT; _conta public.portal_accounts%ROWTYPE; _dest UUID; _login_falhou BOOLEAN;
BEGIN
  UPDATE public.portal_sync_runs
     SET situacao = p_situacao, terminado_em = now(), erro = p_erro, resultado = p_resultado,
         print_path = p_print_path, protocolos_lidos = p_protocolos, mudancas = p_mudancas
   WHERE id = p_run_id
   RETURNING account_id, tipo INTO _account, _tipo;
  IF _account IS NULL THEN RETURN; END IF;

  _login_falhou := p_situacao_conta IN ('erro', 'sessao_expirada');

  IF _tipo = 'criar_projeto' AND NOT _login_falhou THEN
    -- criação falhou por causa do formulário: a conta continua como estava
    SELECT * INTO _conta FROM public.portal_accounts WHERE id = _account;
  ELSE
    UPDATE public.portal_accounts
       SET situacao = coalesce(p_situacao_conta, situacao),
           ultimo_erro = CASE WHEN p_situacao = 'erro' THEN p_erro ELSE NULL END,
           -- os dois meios de acompanhamento marcam a data: portal e e-mail.
           -- No e-mail, só quando NENHUM protocolo falhou: "verificado agora"
           -- tendo conferido 1 de 8 é mentira que esconde documento perdido.
           ultima_varredura_em = CASE
             WHEN _tipo = 'varredura' AND p_situacao = 'ok' THEN now()
             WHEN _tipo = 'varredura_email' AND p_situacao = 'ok'
                  AND coalesce((p_resultado ->> 'falhas')::int, 0) = 0 THEN now()
             ELSE ultima_varredura_em END
     WHERE id = _account
     RETURNING * INTO _conta;
  END IF;

  IF _tipo = 'varredura' AND p_situacao = 'ok' THEN
    PERFORM public.ludmilla_registrar_varredura(p_run_id);
    -- …e confere as tarefas de etapa que ficaram para trás (inclusive as
    -- criadas antes de o encerramento automático existir).
    PERFORM public.ludmilla_encerrar_tarefas_vencidas(_conta.tenant_id, TRUE);
  END IF;

  -- Estação local sem ninguém para o login: avisa os admins pelo sino.
  IF _conta.modo = 'local' AND p_situacao_conta = 'sessao_expirada' THEN
    FOR _dest IN SELECT p.id FROM public.profiles p WHERE p.tenant_id = _conta.tenant_id AND p.role = 'admin' LOOP
      INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
      VALUES (_conta.tenant_id, _dest, '📡 Ludmilla precisa de login na Elektro',
              coalesce(p_erro, 'A estação abriu o portal, mas ninguém digitou o CAPTCHA.') || ' Ela tenta de novo no próximo horário.',
              'ludmilla', NULL, FALSE);
    END LOOP;
  END IF;
END;
$$;

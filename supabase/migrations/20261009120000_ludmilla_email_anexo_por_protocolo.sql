-- supabase/migrations/20261009120000_ludmilla_email_anexo_por_protocolo.sql
-- Ludmilla (e-mail): as correções de BANCO da 2ª revisão do run `varredura_email`.
--
-- D1 (CRÍTICA) — a chave do ANEXO não tinha o protocolo, e o documento podia ir
--   para o card do projeto ERRADO. A rodada anterior (C8) corrigiu a chave da
--   MENSAGEM para (conta, mensagem, PROTOCOLO), mas a do anexo ficou
--   `mensagem#arquivo` contra a UNIQUE (account_id, id_arquivo) — sem protocolo
--   e sem projeto. O mesmo anexo servindo dois projetos colidia:
--     · 1ª subida `enviado`: o ON CONFLICT não devolvia linha, o worker logava
--       "anexo já estava resolvido no card" (resolvido no card do OUTRO
--       cliente), fechava `concluida=true` e NENHUM run futuro tentava;
--     · 1ª subida `erro`: o DO UPDATE devolvia a linha, mas com o `project_id`
--       do projeto A — o arquivo subia no caminho de B e `ludmilla_anexo_enviado`
--       criava o `documents` e o COMENTÁRIO no card de A.
--   Correção em duas camadas: (1) o protocolo entra na chave, por uma função só
--   (`ludmilla_email_id_arquivo`), espelhada no worker em `idArquivoDeEmail`;
--   (2) guarda explícita — o ON CONFLICT exige que a linha existente seja do
--   MESMO projeto, e linha de outro projeto ESTOURA em vez de passar por "já
--   resolvido". Chave certa e guarda; não se confia só na chave.
--
-- D4 — o teto de 5 tentativas só valia se o tratamento chegasse vivo até o
--   registro: estourando antes, não havia linha, `tentativas` nunca incrementava
--   e todo run baixava o corpo e chamava a IA DE NOVO, pagando o parecer
--   indefinidamente. Nasce `ludmilla_email_tentativa`, chamada no começo do
--   tratamento (linha com `concluida = false`, correção C1 preservada), e
--   `ludmilla_email_registrar` deixa de incrementar (senão a mesma tentativa
--   contaria duas vezes e o teto cairia para 2 e meia).
--
-- D5 — a recomendação da retentativa era descartada em silêncio quando a equipe
--   já havia decidido a linha de `portal_updates`. Agora: a linha decidida NÃO
--   se mexe, e se a retentativa trouxe recomendação que não existia, abre-se uma
--   linha NOVA (sem duplicar quando não há recomendação nova a dar).
--
-- O que NÃO muda, de propósito:
--   · a UNIQUE `portal_anexos (account_id, id_arquivo)` fica como está. O
--     protocolo dentro de `id_arquivo` já discrimina, e não mexer na constraint
--     é a prova mais forte de que o caminho de PORTAL não mudou;
--   · nenhuma função do caminho de portal é tocada — `ludmilla_registrar_varredura`,
--     `ludmilla_anexo_enviado`, `ludmilla_anexo_enviado_local`,
--     `ludmilla_anexos_pendentes` e `ludmilla_finalizar_run_impl` não aparecem
--     neste arquivo (md5(prosrc) conferido antes e depois);
--   · o `id_arquivo` da CPFL continua sendo o `idArquivo` do portal (é com ele
--     que `baixarAnexo` busca o arquivo no site) — só o caminho de e-mail monta
--     a chave, e ele ainda não gravou nenhuma linha (0 linhas com '#' nas 76 de
--     produção), então não há o que re-anexar.

-- ── 1. D1: a chave do anexo de e-mail, num lugar só ──────────────────────────
-- O worker monta a mesma expressão em `idArquivoDeEmail` (email/util.ts). Mudar
-- uma ponta sem a outra faz a robô anexar de novo o que já anexou — por isso a
-- expressão é curta, é função e tem teste nas duas pontas.
CREATE OR REPLACE FUNCTION public.ludmilla_email_id_arquivo(
  p_message_id TEXT, p_protocolo TEXT, p_nome_arquivo TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(p_message_id, '') || '#' || coalesce(p_protocolo, '') || '#' || coalesce(p_nome_arquivo, '');
$$;
COMMENT ON FUNCTION public.ludmilla_email_id_arquivo(TEXT, TEXT, TEXT) IS
  'A chave de portal_anexos.id_arquivo no caminho de E-MAIL: mensagem#protocolo#arquivo. O protocolo é obrigatório — sem ele, um e-mail que serve dois projetos colide na UNIQUE e o documento vai para o card do cliente errado. Espelhada no worker em idArquivoDeEmail.';
REVOKE ALL ON FUNCTION public.ludmilla_email_id_arquivo(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_id_arquivo(TEXT, TEXT, TEXT) TO service_role;

-- ── 2. D1: a RPC do anexo, com a chave certa E a guarda de projeto ───────────
-- A assinatura de entrada não muda; a de SAÍDA ganha `projeto_id`, para o worker
-- conferir que a linha é do projeto que ele pediu antes de subir arquivo nenhum
-- (mudar RETURNS TABLE exige DROP: `CREATE OR REPLACE` não troca tipo de
-- retorno). Só o worker de e-mail chama esta função — conferido com Grep em
-- src/, worker/ e supabase/.
DROP FUNCTION IF EXISTS public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION public.ludmilla_email_anexo_novo(
  p_account_id UUID, p_protocolo TEXT, p_project_id UUID,
  p_message_id TEXT, p_nome_arquivo TEXT, p_conferido_por TEXT
) RETURNS TABLE (anexo_id UUID, projeto_id UUID, company_id UUID, codigo TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE;
  _proj  public.projects%ROWTYPE;
  _id    UUID;
  _dono  UUID;
  _chave TEXT;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra anexos de e-mail';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  SELECT * INTO _proj  FROM public.projects WHERE id = p_project_id AND tenant_id = _conta.tenant_id;
  IF _proj.id IS NULL THEN RETURN; END IF;

  _chave := public.ludmilla_email_id_arquivo(p_message_id, p_protocolo, p_nome_arquivo);

  -- A linha que ficou `pendente` (run que morreu antes de subir o arquivo) ou
  -- `erro` (storage recusou) volta para `pendente` e é devolvida para nova
  -- tentativa — sem isso a correção C1 não se completa, porque a mensagem volta
  -- a ser tratada mas o arquivo nunca sobe. Linha `enviado`/`bloqueado` devolve
  -- vazio: aí não há o que refazer.
  --
  -- `x.project_id = excluded.project_id` é a guarda do D1: NUNCA devolver linha
  -- de outro projeto, nem que a chave um dia volte a colidir.
  INSERT INTO public.portal_anexos AS x
    (tenant_id, account_id, protocolo, project_id, id_arquivo, nome_arquivo, situacao, conferido_por)
  VALUES
    (_conta.tenant_id, p_account_id, p_protocolo, p_project_id,
     _chave, p_nome_arquivo, 'pendente', p_conferido_por)
  ON CONFLICT (account_id, id_arquivo) DO UPDATE
     SET situacao = 'pendente', motivo = NULL, conferido_por = excluded.conferido_por
   WHERE x.situacao IN ('pendente', 'erro')
     AND x.project_id = excluded.project_id
  RETURNING x.id, x.project_id INTO _id, _dono;

  IF _id IS NULL THEN
    -- Nada devolvido tem dois significados, e tratar os dois como "já resolvido"
    -- é o defeito: ou a linha está `enviado`/`bloqueado` NO MESMO projeto (não
    -- há o que refazer), ou ela é de OUTRO projeto — e aí "já resolvido no card"
    -- seria mentira sobre o card de outro cliente.
    SELECT x.project_id INTO _dono
      FROM public.portal_anexos x
     WHERE x.account_id = p_account_id AND x.id_arquivo = _chave;
    IF _dono IS NOT NULL AND _dono IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'anexo de e-mail já registrado em OUTRO projeto (% em vez de %): não anexo no card errado', _dono, p_project_id;
    END IF;
    RETURN;
  END IF;

  RETURN QUERY SELECT _id, _dono, _proj.company_id, _proj.code;
END;
$$;
COMMENT ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Abre (ou retoma) a linha do anexo de e-mail e devolve o que subirDocumento precisa, inclusive o projeto_id da LINHA — que o worker confere contra o projeto pedido. Linha de outro projeto estoura; nunca é devolvida.';
REVOKE ALL ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

-- ── 3. D4: a tentativa é contada ANTES de gastar a IA ────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_email_tentativa(
  p_run_id UUID, p_account_id UUID, p_message_id TEXT, p_protocolo TEXT,
  p_project_id UUID, p_assunto TEXT, p_remetente TEXT, p_recebido_em TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _proj UUID; _n INTEGER;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô conta tentativas de e-mail';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  IF _conta.id IS NULL THEN
    RAISE EXCEPTION 'conta % não existe', p_account_id;
  END IF;

  -- Projeto apagado entre a listagem e o registro: a linha nasce SEM projeto, em
  -- vez de estourar na chave estrangeira e deixar a tentativa sem contar — que é
  -- justamente o caso em que a IA era paga de novo todo run.
  SELECT p.id INTO _proj FROM public.projects p
   WHERE p.id = p_project_id AND p.tenant_id = _conta.tenant_id;

  INSERT INTO public.portal_email_mensagens AS m
    (tenant_id, account_id, run_id, message_id, protocolo, project_id,
     assunto, remetente, recebido_em, motivo, concluida, tentativas)
  VALUES
    (_conta.tenant_id, p_account_id, p_run_id, p_message_id, p_protocolo, _proj,
     left(p_assunto, 300), left(p_remetente, 200), p_recebido_em,
     CASE WHEN _proj IS NULL AND p_project_id IS NOT NULL
            THEN 'o projeto deste protocolo não existe mais (apagado?)'
          ELSE 'o robô começou a tratar esta mensagem' END,
     FALSE, 1)
  ON CONFLICT (account_id, message_id, protocolo) DO UPDATE SET
     run_id      = excluded.run_id,
     project_id  = coalesce(excluded.project_id, m.project_id),
     assunto     = excluded.assunto,
     remetente   = excluded.remetente,
     recebido_em = excluded.recebido_em,
     motivo      = excluded.motivo,
     -- o tratamento está em andamento: `concluida` só volta a TRUE no registro
     -- do fim, e é isso que faz o run seguinte tentar de novo se ele morrer
     concluida   = FALSE,
     tentativas  = m.tentativas + 1
  RETURNING m.tentativas INTO _n;
  RETURN _n;
END;
$$;
COMMENT ON FUNCTION public.ludmilla_email_tentativa(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) IS
  'Abre a linha da mensagem e CONTA a tentativa no começo do tratamento, antes do gasto de IA. Nasce concluida=false; ludmilla_email_registrar completa os dados no fim e NÃO incrementa de novo. Teto de 5 em ludmilla_email_mensagem_pendente.';
REVOKE ALL ON FUNCTION public.ludmilla_email_tentativa(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_tentativa(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ── 4. D4 + D5: o registro do fim ────────────────────────────────────────────
-- Cópia INTEIRA da definição mais recente (20261006120000, md5 7103463f…), com
-- duas mudanças e nada mais:
--   · o DO UPDATE não incrementa `tentativas` (quem conta é a função acima);
--   · a recomendação da retentativa não é mais descartada quando a equipe já
--     decidiu a linha: abre-se linha NOVA, e a decidida fica intacta.
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
  _upd UUID; _tentativa INTEGER; _status TEXT; _raw JSONB; _recom_velha TEXT;
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
     arquivo_lido   = coalesce(excluded.arquivo_lido, m.arquivo_lido)
     -- `tentativas` NÃO é mexido aqui: quem conta é `ludmilla_email_tentativa`,
     -- no começo do tratamento. Incrementar nos dois lugares contaria a mesma
     -- tentativa duas vezes e o teto de 5 valeria 2 e meia.
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
    -- corrigida — enquanto a equipe não decidiu.
    UPDATE public.portal_updates
       SET status_portal = _status, recomendacao = p_recomendacao, raw = _raw, detectado_em = now()
     WHERE id = _upd AND situacao = 'pendente';

    IF NOT FOUND THEN
      -- A equipe já aplicou ou ignorou: aquela linha não se mexe mais. Mas
      -- DESCARTAR a recomendação nova é perder a entrega da funcionalidade —
      -- run 1 com a IA falhando abre cartão sem etapa, a equipe marca como
      -- ignorada, run 2 lê o parecer e diz `favoravel`, e isso tem de chegar à
      -- tela. Abre linha NOVA, e só quando há recomendação nova a dar: sem
      -- recomendação (ou com a mesma de antes, ou já tendo uma pendente igual)
      -- não se abre nada, senão volta a duplicar.
      SELECT u.recomendacao INTO _recom_velha FROM public.portal_updates u WHERE u.id = _upd;
      IF p_recomendacao IS NOT NULL
         AND p_recomendacao IS DISTINCT FROM _recom_velha
         AND NOT EXISTS (SELECT 1 FROM public.portal_updates u
                          WHERE u.account_id = p_account_id AND u.protocolo = p_protocolo
                            AND u.project_id = p_project_id AND u.situacao = 'pendente'
                            AND u.recomendacao = p_recomendacao) THEN
        INSERT INTO public.portal_updates
          (tenant_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
           project_id, casamento, recomendacao, situacao, detectado_em, raw)
        VALUES
          (_conta.tenant_id, p_account_id, p_protocolo, NULL, _status,
           _proj.status::text, p_project_id, 'protocolo', p_recomendacao, 'pendente', now(), _raw)
        RETURNING id INTO _upd;
        UPDATE public.portal_email_mensagens SET update_id = _upd WHERE id = _msg;
      END IF;
    END IF;
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

-- ── Prova de que o arquivo subiu inteiro ─────────────────────────────────────
SELECT
  public.ludmilla_email_id_arquivo('<abc@edp>', '045006443920', 'parecer.pdf') AS chave_exemplo,
  (SELECT count(*) FROM pg_proc WHERE proname = 'ludmilla_email_tentativa')    AS tem_tentativa,
  (SELECT pg_get_function_result(oid) FROM pg_proc
    WHERE proname = 'ludmilla_email_anexo_novo')                               AS saida_anexo_novo,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.portal_anexos'::regclass AND contype = 'u')       AS unique_portal_anexos;

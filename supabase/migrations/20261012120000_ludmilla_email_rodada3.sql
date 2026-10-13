-- supabase/migrations/20261012120000_ludmilla_email_rodada3.sql
-- Ludmilla (e-mail): as correções de BANCO da 3ª revisão do run `varredura_email`.
--
-- E3 — a retentativa APAGAVA a recomendação que já existia. O `UPDATE` da linha
--   pendente de `portal_updates` gravava `recomendacao = p_recomendacao` mesmo
--   quando era NULL: a tentativa 1 lia o parecer favorável e deixava o cartão com
--   `approved`; a tentativa 2, com a IA falhando, apagava a etapa recomendada. Se
--   a IA falhasse até o teto de 5, o cartão ficava sem etapa tendo tido uma. Agora
--   a recomendação nunca é rebaixada para NULL: `coalesce(p_recomendacao,
--   u.recomendacao)`. Recomendação NOVA (não nula) continua substituindo a velha.
--
-- E5 — dois anexos de MESMO nome no mesmo e-mail e projeto geravam a mesma chave
--   (`mensagem#protocolo#arquivo`): o segundo virava "já resolvido" e DESAPARECIA.
--   E, quando a RPC devolvia vazio porque o PROJETO NÃO EXISTE, o log do worker
--   dizia "já estava resolvido no card", o que é falso. Duas mudanças:
--     · a chave ganha a ocorrência (`ludmilla_email_id_arquivo`, 4º argumento):
--       o primeiro arquivo de um nome mantém a chave de sempre, do segundo em
--       diante entra `#2`, `#3`. Espelhada no worker em `idArquivoDeEmail`;
--     · `ludmilla_email_anexo_novo` passa a responder SEMPRE uma linha, com a coluna
--       `abertura` = `aberto` | `ja_resolvido` | `projeto_inexistente`, em vez de
--       misturar os dois últimos num conjunto vazio.
--   `portal_anexos` tinha ZERO linhas com '#' no `id_arquivo` quando esta migração
--   foi escrita (e `portal_email_mensagens`, zero linhas): o caminho de e-mail nunca
--   gravou nada, então a chave pode ganhar o 4º argumento sem re-anexar o que já
--   foi anexado. Nenhuma linha existente muda de chave de qualquer jeito: a
--   ocorrência 1 produz exatamente a chave antiga.
--
-- Cada função abaixo é a definição MAIS RECENTE (20261009120000, md5 do corpo
-- conferido contra o banco antes de copiar) com SÓ o que o item pede — o
-- `CREATE OR REPLACE` troca o corpo inteiro, então nada foi reescrito de memória.
--
-- O que NÃO muda, de propósito:
--   · a UNIQUE `portal_anexos (account_id, id_arquivo)`;
--   · nenhuma função do caminho de PORTAL — `ludmilla_registrar_varredura`,
--     `ludmilla_anexo_enviado`(`_local`), `ludmilla_anexo_erro`(`_local`),
--     `ludmilla_anexos_pendentes`(`_local`) e `ludmilla_finalizar_run_impl` não
--     aparecem neste arquivo (md5(prosrc) conferido antes e depois).

-- ── 1. E5: a chave do anexo de e-mail, com a ocorrência ──────────────────────
-- Muda a lista de argumentos (ganha o 4º): `CREATE OR REPLACE` criaria uma SEGUNDA
-- função ao lado da antiga, então a antiga sai. Só `ludmilla_email_anexo_novo` a
-- chama (conferido com Grep em src/, worker/ e supabase/).
DROP FUNCTION IF EXISTS public.ludmilla_email_id_arquivo(TEXT, TEXT, TEXT);

CREATE FUNCTION public.ludmilla_email_id_arquivo(
  p_message_id TEXT, p_protocolo TEXT, p_nome_arquivo TEXT, p_ocorrencia INTEGER DEFAULT 1
) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(p_message_id, '') || '#' || coalesce(p_protocolo, '') || '#' || coalesce(p_nome_arquivo, '')
         || CASE WHEN coalesce(p_ocorrencia, 1) > 1 THEN '#' || p_ocorrencia ELSE '' END;
$$;
COMMENT ON FUNCTION public.ludmilla_email_id_arquivo(TEXT, TEXT, TEXT, INTEGER) IS
  'A chave de portal_anexos.id_arquivo no caminho de E-MAIL: mensagem#protocolo#arquivo, e #N a partir do 2º arquivo de mesmo nome na mesma mensagem. O protocolo é obrigatório — sem ele, um e-mail que serve dois projetos colide na UNIQUE e o documento vai para o card do cliente errado. Espelhada no worker em idArquivoDeEmail.';
REVOKE ALL ON FUNCTION public.ludmilla_email_id_arquivo(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_id_arquivo(TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ── 2. E5: a RPC do anexo, com a ocorrência e a resposta que não mente ───────
-- Mudam a lista de argumentos E o tipo de retorno: `DROP` + `CREATE`.
DROP FUNCTION IF EXISTS public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION public.ludmilla_email_anexo_novo(
  p_account_id UUID, p_protocolo TEXT, p_project_id UUID,
  p_message_id TEXT, p_nome_arquivo TEXT, p_conferido_por TEXT,
  p_ocorrencia INTEGER DEFAULT 1
) RETURNS TABLE (abertura TEXT, anexo_id UUID, projeto_id UUID, company_id UUID, codigo TEXT)
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
  -- Conta que não existe NÃO é "projeto que não existe": sem esta linha a
  -- resposta `projeto_inexistente` mentiria sobre a causa (mesma frase de
  -- `ludmilla_email_tentativa`, que o worker chama antes).
  IF _conta.id IS NULL THEN
    RAISE EXCEPTION 'conta % não existe', p_account_id;
  END IF;
  SELECT * INTO _proj  FROM public.projects WHERE id = p_project_id AND tenant_id = _conta.tenant_id;
  IF _proj.id IS NULL THEN
    -- apagado entre a listagem e o registro, ou não é desta conta
    RETURN QUERY SELECT 'projeto_inexistente'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  _chave := public.ludmilla_email_id_arquivo(p_message_id, p_protocolo, p_nome_arquivo, p_ocorrencia);

  -- A linha que ficou `pendente` (run que morreu antes de subir o arquivo) ou
  -- `erro` (storage recusou) volta para `pendente` e é devolvida para nova
  -- tentativa — sem isso a correção C1 não se completa, porque a mensagem volta
  -- a ser tratada mas o arquivo nunca sobe. Linha `enviado`/`bloqueado` responde
  -- `ja_resolvido`: aí não há o que refazer.
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
    -- Nada devolvido pelo INSERT tem dois significados, e tratar os dois como
    -- "já resolvido" é o defeito: ou a linha está `enviado`/`bloqueado` NO MESMO
    -- projeto (não há o que refazer), ou ela é de OUTRO projeto — e aí "já
    -- resolvido no card" seria mentira sobre o card de outro cliente.
    SELECT x.project_id INTO _dono
      FROM public.portal_anexos x
     WHERE x.account_id = p_account_id AND x.id_arquivo = _chave;
    IF _dono IS NOT NULL AND _dono IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'anexo de e-mail já registrado em OUTRO projeto (% em vez de %): não anexo no card errado', _dono, p_project_id;
    END IF;
    RETURN QUERY SELECT 'ja_resolvido'::TEXT, NULL::UUID, p_project_id, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'aberto'::TEXT, _id, _dono, _proj.company_id, _proj.code;
END;
$$;
COMMENT ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER) IS
  'Abre (ou retoma) a linha do anexo de e-mail. Responde SEMPRE uma linha: abertura = aberto (suba o arquivo; traz anexo_id, projeto_id, company_id, codigo), ja_resolvido (a linha está enviado/bloqueado neste projeto) ou projeto_inexistente. O worker confere o projeto_id da LINHA contra o projeto pedido; linha de outro projeto estoura, nunca é devolvida. p_ocorrencia desambigua arquivos de mesmo nome na mesma mensagem.';
REVOKE ALL ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_anexo_novo(UUID, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ── 3. E3: o registro do fim não rebaixa a recomendação para NULL ────────────
-- Cópia INTEIRA da definição mais recente (20261009120000, md5 421bcdea5970…),
-- com UMA mudança: o UPDATE da linha pendente usa coalesce(p_recomendacao,
-- u.recomendacao).
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
    -- corrigida — enquanto a equipe não decidiu. A recomendação NUNCA é rebaixada
    -- para NULL (E3): tentativa 1 leu favorável e deixou o cartão com `approved`;
    -- tentativa 2, com a IA falhando, chega com p_recomendacao NULL e não pode
    -- apagar a etapa que já existia. Recomendação nova (não nula) substitui.
    UPDATE public.portal_updates u
       SET status_portal = _status, recomendacao = coalesce(p_recomendacao, u.recomendacao),
           raw = _raw, detectado_em = now()
     WHERE u.id = _upd AND u.situacao = 'pendente';

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
  public.ludmilla_email_id_arquivo('<abc@edp>', '045006443920', 'parecer.pdf')    AS chave_1,
  public.ludmilla_email_id_arquivo('<abc@edp>', '045006443920', 'parecer.pdf', 2) AS chave_2,
  (SELECT count(*) FROM pg_proc WHERE proname = 'ludmilla_email_id_arquivo')      AS id_arquivo_assinaturas,
  (SELECT count(*) FROM pg_proc WHERE proname = 'ludmilla_email_anexo_novo')      AS anexo_novo_assinaturas,
  (SELECT pg_get_function_result(oid) FROM pg_proc
    WHERE proname = 'ludmilla_email_anexo_novo')                                  AS saida_anexo_novo,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.portal_anexos'::regclass AND contype = 'u')          AS unique_portal_anexos;

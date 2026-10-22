-- supabase/migrations/20261022120000_ludmilla_email_registrar_cartao_do_projeto.sql
-- Ludmilla — o cartão de e-mail só é corrigido pela leitura do MESMO projeto.
-- Segue 20261016140000 (trava da troca). Rodada de fechamento A da ENEL por e-mail
-- (revisão final do ramo: C-1; e o M2 da Task 5).
--
--   1. C-1 (Critical). Na ENEL a chave da mensagem é FIXA (''): uma linha por e-mail,
--      seja qual for o projeto. "Ler de novo" (depois de corrigir o cadastro) ou uma
--      retentativa em que a IA leu outra NT podem identificar OUTRO projeto. A função
--      lia o `update_id` da linha da mensagem sem olhar o projeto e corrigia aquele
--      cartão: o cartão do projeto A passava a levar a recomendação, o protocolo e a
--      troca do projeto B, e o Aplicar gravava etapa e protocolo de B EM A (provado
--      em rollback pela revisão final). Agora:
--        · depois de ler `_upd`: se o cartão não é de `p_project_id`, `_upd := NULL` —
--          abre-se cartão novo para B e o de A fica intacto, pendente, para a equipe;
--        · o UPDATE da repetição e a leitura da "linha decidida" (ramo NOT FOUND)
--          também filtram `project_id = p_project_id`: cada camada, sozinha, impede
--          que o cartão de outro projeto seja corrigido ou usado como referência.
--      A mensagem passa a apontar (`update_id`) para o cartão do projeto da última
--      leitura. Na EDP a chave da mensagem é o protocolo do próprio projeto: o cartão
--      é sempre do mesmo projeto e nada muda (provado contra a função anterior).
--      Limite conhecido: A → B → A (três leituras alternando) abre um 2º cartão
--      pendente para A, igual ao primeiro. É ruído, não dado no projeto errado; a
--      tabela de cartões não guarda a mensagem para reconhecer o de A.
--
--   2. M2 da Task 5. A trava da troca comparava a UC do próprio projeto só por pedaço
--      (`regexp_split_to_table(uc_number, '\D+')`). A UC pontuada "3.928.129-57" vira
--      3, 928, 129 e 57, e a troca para 392812957 passava. Agora compara também a UC
--      INTEIRA, com os dígitos colados (`regexp_replace(uc_number, '\D', '', 'g')`),
--      sem zeros à esquerda dos dois lados. O pedaço continua (célula com DUAS UCs).
--
--   3. `raw.recebido_em` no cartão (a data do e-mail), para a tela mostrar. É a única
--      mudança que a EDP vê: uma chave a mais no `raw`.
--
--   4. Correção de TEXTO de 20261016140000 (que não é editada). O cabeçalho dela diz
--      que a linha nova "nunca repete uma troca ignorada". É forte demais. O que de
--      fato acontece: depois de a equipe ignorar um cartão de troca, a linha nova
--      aberta por uma recomendação nova sai SEM a troca (`_abre_troca` exige que a
--      linha decidida não fosse de troca). Mas, se essa linha nova continuar pendente
--      e a passada seguinte pedir a troca de novo, o UPDATE de repetição a religa
--      (`atualizar_protocolo = u.atualizar_protocolo OR _pedir`): a troca ignorada
--      pode voltar, no cartão novo. Quem decide continua sendo a equipe, no cartão.
--      Sem recomendação nova, a mensagem segue apontando para a linha ignorada e a
--      troca não volta. Comentário no corpo e COMMENT dizem isso.
--
-- ATENÇÃO — de onde veio o corpo: copiado do `prosrc` VIVO do banco, não de migração.
-- md5 do corpo conferido antes de copiar = 9c380795dab6fb395fd0345febc9fa5f (o da
-- 20261016140000). A assinatura NÃO muda (20 parâmetros), então `CREATE OR REPLACE`
-- basta; COMMENT, REVOKE e GRANT refeitos. Re-executável.

CREATE OR REPLACE FUNCTION public.ludmilla_email_registrar(
  p_run_id UUID, p_account_id UUID, p_message_id TEXT, p_protocolo TEXT,
  p_project_id UUID, p_assunto TEXT, p_remetente TEXT, p_recebido_em TIMESTAMPTZ,
  p_tipo_documento TEXT, p_veredito TEXT, p_resumo TEXT, p_anexos INTEGER,
  p_motivo TEXT, p_recomendacao TEXT, p_concluida BOOLEAN, p_arquivo_lido TEXT,
  p_referencia TEXT DEFAULT NULL, p_casamento TEXT DEFAULT NULL, p_abrir_cartao BOOLEAN DEFAULT TRUE,
  p_atualizar_protocolo BOOLEAN DEFAULT FALSE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE; _msg UUID; _proj public.projects%ROWTYPE;
  _upd UUID; _tentativa INTEGER; _status TEXT; _raw JSONB; _recom_velha TEXT;
  _ref TEXT; _cas TEXT;
  _titular TEXT; _pedir BOOLEAN := FALSE;
  _troca_velha BOOLEAN; _abre_rec BOOLEAN; _abre_troca BOOLEAN;
BEGIN
  -- A EDP não manda os dois: tudo segue como sempre (protocolo da mensagem, casamento 'protocolo').
  -- A ENEL usa uma chave fixa de mensagem ('') e manda a referência do projeto identificado.
  _ref := coalesce(nullif(p_referencia, ''), p_protocolo);
  _cas := coalesce(p_casamento, 'protocolo');

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô registra e-mails lidos';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;

  -- Defesa em profundidade: esta função lê `projects` só por id, e o titular do
  -- cartão sai desse project_id. Um projeto de OUTRO tenant nunca pode ser gravado
  -- por uma conta alheia. Hoje isso não acontece (a lista de projetos da conta já
  -- filtra por tenant), então a EDP não muda; é o cinto que sobra se o robô errar o id.
  IF p_project_id IS NOT NULL AND _conta.id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.projects x
        WHERE x.id = p_project_id AND x.tenant_id IS DISTINCT FROM _conta.tenant_id) THEN
    RAISE EXCEPTION 'o projeto % não é do tenant da conta %', p_project_id, p_account_id;
  END IF;

  -- a recomendação que esta mensagem já abriu, se for repetição
  SELECT m.update_id INTO _upd
    FROM public.portal_email_mensagens m
   WHERE m.account_id = p_account_id AND m.message_id = p_message_id AND m.protocolo = p_protocolo;

  -- C-1 (20261022120000): só é REPETIÇÃO se o cartão for do MESMO projeto. Na ENEL a
  -- chave da mensagem é fixa (''), então um "Ler de novo" ou uma retentativa que
  -- identifica OUTRO projeto chegava aqui com o cartão do primeiro, e corrigi-lo
  -- gravava a etapa e o protocolo do segundo no primeiro (o Aplicar grava no
  -- project_id do cartão). Cartão de outro projeto: esquece-se o vínculo, abre-se
  -- cartão novo para este projeto e o do primeiro fica como está, para a equipe
  -- decidir. Na EDP a chave é o protocolo do próprio projeto e nada muda.
  IF _upd IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.portal_updates u WHERE u.id = _upd AND u.project_id = p_project_id) THEN
    _upd := NULL;
  END IF;

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

  -- O titular que o cartão mostra vem do CADASTRO do projeto (o banco já sabe o
  -- project_id; o robô não manda nada), nunca do e-mail: holder_name e, sem ele,
  -- o título do projeto. Só preenche o campo que antes saía NULL.
  _titular := coalesce(
    nullif(btrim((SELECT g.holder_name FROM public.project_general_data g WHERE g.project_id = p_project_id)), ''),
    nullif(btrim(_proj.title), ''));

  -- Troca do protocolo do cadastro: o robô PEDE, o banco TRAVA. Só vale se as três
  -- condições juntas: (1) o protocolo do cartão (_ref) é só dígitos, 9 ou mais;
  -- (2) o projeto existe; (3) os dígitos de _ref diferem dos dígitos do
  -- protocol_number atual, sem zeros à esquerda (o cadastro pode ter texto, como
  -- "Sem protocolo"). Falhou? O cartão sai como sempre (atualizar_protocolo = false)
  -- e nada dá erro: a mensagem TEM de ser gravada.
  _pedir := coalesce(p_atualizar_protocolo, FALSE)
            AND _proj.id IS NOT NULL
            AND coalesce(_ref ~ '^[0-9]{9,}$', FALSE)
            AND ltrim(_ref, '0') <> ''
            AND ltrim(_ref, '0') IS DISTINCT FROM ltrim(regexp_replace(coalesce(_proj.protocol_number, ''), '\D', '', 'g'), '0')
            -- (4) e não é um número do PRÓPRIO projeto: a trava de "9 dígitos ou mais"
            -- deixa passar UC, CPF e CNPJ. A UC pode vir DUPLA na mesma célula (duas UCs
            -- separadas por "/" ou espaço), então compara por pedaço; o CPF/CNPJ, pelos
            -- dígitos todos. Zeros à esquerda saem dos dois lados.
            AND NOT EXISTS (
              SELECT 1 FROM public.project_general_data g,
                     LATERAL regexp_split_to_table(coalesce(g.uc_number, ''), '\D+') AS uc(parte)
               WHERE g.project_id = p_project_id AND ltrim(uc.parte, '0') = ltrim(_ref, '0'))
            AND NOT EXISTS (
              SELECT 1 FROM public.project_general_data g
               WHERE g.project_id = p_project_id
                 AND ltrim(regexp_replace(coalesce(g.holder_cpf_cnpj, ''), '\D', '', 'g'), '0') = ltrim(_ref, '0'))
            -- (5) 20261022120000: e a UC INTEIRA, com os dígitos colados. Por pedaço, a UC
            -- pontuada "3.928.129-57" vira 3, 928, 129 e 57, e nenhum deles é 392812957.
            AND NOT EXISTS (
              SELECT 1 FROM public.project_general_data g
               WHERE g.project_id = p_project_id
                 AND ltrim(regexp_replace(coalesce(g.uc_number, ''), '\D', '', 'g'), '0') = ltrim(_ref, '0'));
  _status := upper(coalesce(p_tipo_documento, 'e-mail')) || coalesce(' · ' || upper(p_veredito), '');
  _raw := jsonb_build_object('assunto', p_assunto, 'remetente', p_remetente, 'recebido_em', p_recebido_em,
                             'resumo', p_resumo, 'anexos', coalesce(p_anexos, 0),
                             'motivo', p_motivo, 'arquivo_lido', p_arquivo_lido,
                             'tentativa', _tentativa);

  -- Só abre/corrige o cartão quando a robô pede. Na ENEL são 99 respostas
  -- automáticas e as trocas agendadas: um cartão (e um toque de sino) para cada
  -- uma seria ruído. A MENSAGEM já foi gravada acima, sempre.
  IF p_abrir_cartao THEN
    IF _upd IS NULL THEN
      INSERT INTO public.portal_updates
        (tenant_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
         project_id, casamento, recomendacao, atualizar_protocolo, protocolo_anterior,
         situacao, detectado_em, raw)
      VALUES
        (_conta.tenant_id, p_account_id, _ref, _titular, _status,
         _proj.status::text, p_project_id, _cas, p_recomendacao, _pedir,
         CASE WHEN _pedir THEN _proj.protocol_number END, 'pendente', now(), _raw)
      RETURNING id INTO _upd;
      UPDATE public.portal_email_mensagens SET update_id = _upd WHERE id = _msg;
    ELSE
      -- Repetição (a IA falhou e agora respondeu, por exemplo): a MESMA linha é
      -- corrigida — enquanto a equipe não decidiu. A recomendação NUNCA é rebaixada
      -- para NULL (E3): tentativa 1 leu favorável e deixou o cartão com `approved`;
      -- tentativa 2, com a IA falhando, chega com p_recomendacao NULL e não pode
      -- apagar a etapa que já existia. Recomendação nova (não nula) substitui.
      -- A troca de protocolo segue o mesmo princípio: a tentativa 1 pode ter vindo
      -- sem a NT (a IA falhou) e a 2 com ela, então o pedido válido liga a troca (e
      -- o cartão passa a levar a NT como protocolo, que é o que o Aplicar grava);
      -- repetição sem pedido NUNCA desliga uma troca que já estava ligada.
      -- (20261022120000) O mesmo OR também RELIGA uma troca que a equipe ignorou:
      -- depois do "Ignorar", uma recomendação nova abre linha nova SEM a troca (ramo
      -- NOT FOUND abaixo); se essa linha seguir pendente e a passada seguinte pedir a
      -- troca de novo, ela volta nesta linha. Quem decide é a equipe, no cartão.
      -- O titular só preenche o que estava vazio.
      UPDATE public.portal_updates u
         SET status_portal = _status, recomendacao = coalesce(p_recomendacao, u.recomendacao),
             raw = _raw, detectado_em = now(),
             titular_portal = coalesce(u.titular_portal, _titular),
             atualizar_protocolo = (u.atualizar_protocolo OR _pedir),
             protocolo = CASE WHEN _pedir THEN _ref ELSE u.protocolo END,
             protocolo_anterior = CASE WHEN _pedir THEN _proj.protocol_number ELSE u.protocolo_anterior END
       WHERE u.id = _upd AND u.situacao = 'pendente' AND u.project_id = p_project_id;

      IF NOT FOUND THEN
        -- A equipe já aplicou ou ignorou: aquela linha não se mexe mais. Mas
        -- DESCARTAR a recomendação nova é perder a entrega da funcionalidade —
        -- run 1 com a IA falhando abre cartão sem etapa, a equipe marca como
        -- ignorada, run 2 lê o parecer e diz `favoravel`, e isso tem de chegar à
        -- tela. Abre linha NOVA, e só quando há recomendação nova a dar: sem
        -- recomendação (ou com a mesma de antes, ou já tendo uma pendente igual)
        -- não se abre nada, senão volta a duplicar.
        -- (20261022120000) a linha decidida tem de ser DESTE projeto: a de outro não diz
        -- nada sobre a recomendação nem a troca daqui (sem linha, as duas ficam NULL).
        SELECT u.recomendacao, u.atualizar_protocolo INTO _recom_velha, _troca_velha
          FROM public.portal_updates u WHERE u.id = _upd AND u.project_id = p_project_id;
        -- Dois motivos para abrir a linha nova: (a) há recomendação nova a dar;
        -- (b) há TROCA de protocolo pedida (e válida) que a linha decidida não levava.
        -- Sem (b), a NT que chega na tentativa 2 — depois de a equipe ter aplicado o
        -- cartão da tentativa 1 — sumia, e é justamente o caso do pedido. O (b) vale
        -- com p_recomendacao NULL: o robô manda NULL quando a etapa já foi aplicada, e
        -- aí o cartão novo é só de troca. Se a linha decidida JÁ era de troca
        -- (aplicada ou ignorada), não se abre outra: a decisão da equipe é respeitada,
        -- e a repetição de um cartão de troca ainda pendente cai no UPDATE acima.
        _abre_rec := p_recomendacao IS NOT NULL
                     AND p_recomendacao IS DISTINCT FROM _recom_velha
                     AND NOT EXISTS (SELECT 1 FROM public.portal_updates u
                                      WHERE u.account_id = p_account_id AND u.protocolo = _ref
                                        AND u.project_id = p_project_id AND u.situacao = 'pendente'
                                        AND u.recomendacao = p_recomendacao);
        _abre_troca := _pedir AND NOT coalesce(_troca_velha, FALSE);
        IF _abre_rec OR _abre_troca THEN
          INSERT INTO public.portal_updates
            (tenant_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
             project_id, casamento, recomendacao, atualizar_protocolo, protocolo_anterior,
             situacao, detectado_em, raw)
          VALUES
            (_conta.tenant_id, p_account_id, _ref, _titular, _status,
             _proj.status::text, p_project_id, _cas, CASE WHEN _abre_rec THEN p_recomendacao END, _abre_troca,
             CASE WHEN _abre_troca THEN _proj.protocol_number END, 'pendente', now(), _raw)
          RETURNING id INTO _upd;
          UPDATE public.portal_email_mensagens SET update_id = _upd WHERE id = _msg;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN _msg;
END;
$$;
COMMENT ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) IS
  'Grava o e-mail lido (chave account+message_id+protocolo) e, quando p_abrir_cartao, abre/corrige o cartão em portal_updates. EDP: só os 16 primeiros parâmetros (protocolo da mensagem = protocolo do cartão, casamento protocolo). ENEL: protocolo = chave fixa da mensagem, p_referencia = número do projeto identificado (vira o protocolo do cartão), p_casamento = como achou (protocolo/uc/titular), p_abrir_cartao = false quando não há sugestão de etapa nem bloqueio. Repetição só corrige o cartão do MESMO projeto: se a nova leitura da mensagem identifica outro projeto, abre cartão novo para ele e o do primeiro fica intacto (a mensagem passa a apontar para o novo). O cartão leva o titular do cadastro (holder_name, ou o título do projeto) e, no raw, a data do e-mail (recebido_em). p_atualizar_protocolo = o robô PEDE a troca do protocolo do cadastro pelo do cartão; o banco trava: só dígitos (9+), projeto existe, dígitos diferentes dos do cadastro e que não sejam a UC (por pedaço e inteira, com os dígitos colados) nem o CPF/CNPJ do próprio projeto. IMPORTANTE: p_atualizar_protocolo SÓ VALE COM p_abrir_cartao = TRUE (o padrão): com FALSE nenhum cartão é aberto e o pedido é descartado. Grava protocolo_anterior; repetição sem pedido não desliga uma troca já ligada; depois de uma decisão da equipe, a troca pedida abre linha nova (mesmo sem recomendação), exceto se a linha decidida já era de troca. Troca IGNORADA: a linha nova aberta logo depois (por recomendação nova) sai sem a troca, mas, se seguir pendente, uma passada seguinte que peça a troca a religa nela. Projeto de outro tenant que o da conta lança exceção.';

REVOKE ALL ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO service_role;

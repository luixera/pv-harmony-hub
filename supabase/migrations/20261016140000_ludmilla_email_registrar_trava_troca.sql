-- supabase/migrations/20261016140000_ludmilla_email_registrar_trava_troca.sql
-- Ludmilla — a troca de protocolo do cartão de e-mail: trava mais firme, e a troca
-- não se perde depois de uma decisão. Segue 20261016130000 (titular + troca).
-- Plano: docs/superpowers/plans/2026-10-13-ludmilla-enel-email.md (Task 5), rodada de correção 1.
--
--   1. A troca é RECUSADA quando o número do cartão é um número do PRÓPRIO projeto.
--      "9 dígitos ou mais" deixa passar UC (10 dígitos), CPF, CNPJ, nota de serviço e
--      protocolo de contato. O banco conhece a UC e o CPF/CNPJ do projeto e compara:
--      a UC por pedaço (`regexp_split_to_table(uc_number, '\D+')`, porque 4 projetos da
--      ENEL trazem DUAS UCs na mesma célula, 22 dígitos), o CPF/CNPJ pelos dígitos
--      todos, com os zeros à esquerda tirados dos dois lados. Não há `p_casamento <>
--      'protocolo'` de propósito: um e-mail que cita o nosso protocolo pode trazer uma
--      Carta com NT nova (reenvio), e aí a troca está certa. (A UC de OUTRO projeto
--      continua passando: a trava só olha o próprio; a decisão de pedir é do robô.)
--
--   2. A troca não se perde depois de uma decisão. Tentativa 1: a IA falha, abre-se um
--      cartão com recomendação, a equipe aplica. Tentativa 2: a NT chega, mas o ramo
--      "linha já decidida" só abria linha nova para recomendação nova, e a troca sumia.
--      Agora também abre quando há troca pedida e válida que a linha decidida não
--      levava, inclusive com `p_recomendacao` NULL (cartão só de troca). Linha decidida
--      que já era de troca (aplicada ou ignorada): não abre outra. A linha nova só leva
--      a troca se for ela quem a pede (`_abre_troca`), nunca repete uma troca ignorada.
--
--   3. `p_atualizar_protocolo` só vale com `p_abrir_cartao = TRUE` (o padrão): sem
--      cartão não há onde gravar a troca, e ela é descartada. O COMMENT passa a dizer isso.
--
--   4. Defesa em profundidade de tenant: a função lê `projects` só por id, e o titular
--      do cartão sai desse project_id. Projeto de outro tenant que o da conta → EXCEPTION.
--      Hoje nunca acontece (0 de 81 cartões reais; `ludmilla_email_projetos` já filtra
--      por tenant), então a EDP não muda.
--
-- ATENÇÃO — de onde veio o corpo: copiado do `prosrc` VIVO do banco, não de migração
-- (a lição de `ludmilla_aplicar_update`). md5 do corpo conferido antes de copiar =
-- aff4bb93341ce49dc496d17d86dd8f64 (o da 20261016130000). A assinatura NÃO muda (20 parâmetros),
-- então `CREATE OR REPLACE` basta; COMMENT, REVOKE e GRANT refeitos. Re-executável.

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
                 AND ltrim(regexp_replace(coalesce(g.holder_cpf_cnpj, ''), '\D', '', 'g'), '0') = ltrim(_ref, '0'));
  _status := upper(coalesce(p_tipo_documento, 'e-mail')) || coalesce(' · ' || upper(p_veredito), '');
  _raw := jsonb_build_object('assunto', p_assunto, 'remetente', p_remetente,
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
      -- O titular só preenche o que estava vazio.
      UPDATE public.portal_updates u
         SET status_portal = _status, recomendacao = coalesce(p_recomendacao, u.recomendacao),
             raw = _raw, detectado_em = now(),
             titular_portal = coalesce(u.titular_portal, _titular),
             atualizar_protocolo = (u.atualizar_protocolo OR _pedir),
             protocolo = CASE WHEN _pedir THEN _ref ELSE u.protocolo END,
             protocolo_anterior = CASE WHEN _pedir THEN _proj.protocol_number ELSE u.protocolo_anterior END
       WHERE u.id = _upd AND u.situacao = 'pendente';

      IF NOT FOUND THEN
        -- A equipe já aplicou ou ignorou: aquela linha não se mexe mais. Mas
        -- DESCARTAR a recomendação nova é perder a entrega da funcionalidade —
        -- run 1 com a IA falhando abre cartão sem etapa, a equipe marca como
        -- ignorada, run 2 lê o parecer e diz `favoravel`, e isso tem de chegar à
        -- tela. Abre linha NOVA, e só quando há recomendação nova a dar: sem
        -- recomendação (ou com a mesma de antes, ou já tendo uma pendente igual)
        -- não se abre nada, senão volta a duplicar.
        SELECT u.recomendacao, u.atualizar_protocolo INTO _recom_velha, _troca_velha
          FROM public.portal_updates u WHERE u.id = _upd;
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
  'Grava o e-mail lido (chave account+message_id+protocolo) e, quando p_abrir_cartao, abre/corrige o cartão em portal_updates. EDP: só os 16 primeiros parâmetros (protocolo da mensagem = protocolo do cartão, casamento protocolo). ENEL: protocolo = chave fixa da mensagem, p_referencia = número do projeto identificado (vira o protocolo do cartão), p_casamento = como achou (protocolo/uc/titular), p_abrir_cartao = false quando não há sugestão de etapa nem bloqueio. O cartão leva o titular do cadastro (holder_name, ou o título do projeto). p_atualizar_protocolo = o robô PEDE a troca do protocolo do cadastro pelo do cartão; o banco trava: só dígitos (9+), projeto existe, dígitos diferentes dos do cadastro e que não sejam a UC (por pedaço) nem o CPF/CNPJ do próprio projeto. IMPORTANTE: p_atualizar_protocolo SÓ VALE COM p_abrir_cartao = TRUE (o padrão): com FALSE nenhum cartão é aberto e o pedido é descartado. Grava protocolo_anterior; repetição sem pedido não desliga uma troca já ligada; depois de uma decisão da equipe, a troca pedida abre linha nova (mesmo sem recomendação), exceto se a linha decidida já era de troca. Projeto de outro tenant que o da conta lança exceção.';

REVOKE ALL ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO service_role;

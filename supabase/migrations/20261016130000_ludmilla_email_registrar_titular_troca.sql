-- supabase/migrations/20261016130000_ludmilla_email_registrar_titular_troca.sql
-- Ludmilla — o cartão do e-mail mostra o TITULAR e pode sugerir TROCAR o protocolo.
-- Plano: docs/superpowers/plans/2026-10-13-ludmilla-enel-email.md (Task 5).
--
-- Dois pedidos do usuário (16/10/2026), os dois em `ludmilla_email_registrar`:
--
--   1. O cartão mostra o titular. O caminho de e-mail gravava
--      `portal_updates.titular_portal = NULL` e a tela (Ludmilla.tsx) mostra esse
--      campo. Agora o banco grava o titular do CADASTRO do projeto
--      (`project_general_data.holder_name` e, sem ele, `projects.title`). Vale para
--      EDP e ENEL. É aditivo: só preenche o que ficava vazio, e o robô não manda nada.
--
--   2. O cartão pode sugerir trocar o protocolo. Na ENEL o protocolo do projeto é a
--      NT (9 dígitos), e a Carta traz a NT. Um projeto achado pela UC ou pelo titular
--      que esteja sem protocolo (ou com outro) sai com um cartão que sugere gravar a
--      NT: o mecanismo é o do portal (`atualizar_protocolo` + `protocolo_anterior`),
--      e o "Aplicar" grava `portal_updates.protocolo` em `projects.protocol_number`
--      (`ludmilla_aplicar_update`, 20261016120000). Quem DECIDE pedir é o robô
--      (`p_atualizar_protocolo`); o banco TRAVA: só liga se o protocolo do cartão
--      for só dígitos (9+), o projeto existir e os dígitos diferirem dos do cadastro
--      (sem zeros à esquerda). Falhou a trava? O cartão sai como sempre, sem erro.
--
-- ATENÇÃO — de onde veio o corpo. `ludmilla_aplicar_update` perdeu um ramo inteiro
-- porque alguém reescreveu a função a partir de uma migração antiga. Aqui o corpo
-- foi copiado do `prosrc` do BANCO (não de migração): md5 do corpo conferido antes
-- de copiar = 90799990980e7cfdb8f3f0a4730108e2
-- (idêntico ao de 20261013120000, a menos do \n inicial que o Postgres guarda).
-- Mudou SÓ o que está acima: duas variáveis, o cálculo do titular e da trava, os
-- dois INSERTs de `portal_updates` e o UPDATE da repetição. O resto está como estava.
--
-- A assinatura muda (19 → 20 parâmetros): `CREATE OR REPLACE` sozinho criaria uma
-- SEGUNDA função ao lado da antiga, então a antiga sai. O parâmetro novo tem DEFAULT:
-- a chamada da EDP (16 parâmetros nomeados) resolve para a nova sem mudança alguma.
-- Re-executável: o DROP é IF EXISTS e o CREATE é OR REPLACE.

DROP FUNCTION IF EXISTS public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN);

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
BEGIN
  -- A EDP não manda os dois: tudo segue como sempre (protocolo da mensagem, casamento 'protocolo').
  -- A ENEL usa uma chave fixa de mensagem ('') e manda a referência do projeto identificado.
  _ref := coalesce(nullif(p_referencia, ''), p_protocolo);
  _cas := coalesce(p_casamento, 'protocolo');

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
            AND ltrim(_ref, '0') IS DISTINCT FROM ltrim(regexp_replace(coalesce(_proj.protocol_number, ''), '\D', '', 'g'), '0');
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
        SELECT u.recomendacao INTO _recom_velha FROM public.portal_updates u WHERE u.id = _upd;
        IF p_recomendacao IS NOT NULL
           AND p_recomendacao IS DISTINCT FROM _recom_velha
           AND NOT EXISTS (SELECT 1 FROM public.portal_updates u
                            WHERE u.account_id = p_account_id AND u.protocolo = _ref
                              AND u.project_id = p_project_id AND u.situacao = 'pendente'
                              AND u.recomendacao = p_recomendacao) THEN
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
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN _msg;
END;
$$;
COMMENT ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) IS
  'Grava o e-mail lido (chave account+message_id+protocolo) e, quando p_abrir_cartao, abre/corrige o cartão em portal_updates. EDP: só os 16 primeiros parâmetros (protocolo da mensagem = protocolo do cartão, casamento protocolo). ENEL: protocolo = chave fixa da mensagem, p_referencia = número do projeto identificado (vira o protocolo do cartão), p_casamento = como achou (protocolo/uc/titular), p_abrir_cartao = false quando não há sugestão de etapa nem bloqueio. O cartão leva o titular do cadastro (holder_name, ou o título do projeto). p_atualizar_protocolo = o robô PEDE a troca do protocolo do cadastro pelo do cartão; o banco trava (só dígitos 9+, projeto existe, dígitos diferentes dos do cadastro) e grava protocolo_anterior; repetição sem pedido não desliga uma troca já ligada.';

REVOKE ALL ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO service_role;

-- supabase/migrations/20261013120000_ludmilla_enel_email.sql
-- Ludmilla — acompanhamento da ENEL por e-mail (fase 1).
-- Spec: docs/superpowers/specs/2026-10-13-ludmilla-enel-email-design.md
--
-- A ENEL inverte a premissa da EDP: lá a robô parte do projeto e exige o
-- protocolo no assunto; aqui ela parte do e-mail, pelos remetentes, e descobre
-- de qual projeto ele é. A forma de identificar passa a ser propriedade da conta.

-- ── 1. a ENEL vira conector aceito ───────────────────────────────────────────
ALTER TABLE public.portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_connector_check;
ALTER TABLE public.portal_accounts ADD CONSTRAINT portal_accounts_connector_check
  CHECK (connector = ANY (ARRAY['cpfl'::text, 'elektro'::text, 'edp'::text, 'enel'::text]));

-- ── 2. como a conta descobre o projeto de um e-mail ──────────────────────────
ALTER TABLE public.portal_accounts
  ADD COLUMN IF NOT EXISTS identificacao TEXT NOT NULL DEFAULT 'protocolo_no_assunto';
ALTER TABLE public.portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_identificacao_check;
ALTER TABLE public.portal_accounts ADD CONSTRAINT portal_accounts_identificacao_check
  CHECK (identificacao = ANY (ARRAY['protocolo_no_assunto'::text, 'remetente'::text]));
COMMENT ON COLUMN public.portal_accounts.identificacao IS
  'Como o run varredura_email descobre o projeto: protocolo_no_assunto (EDP: parte do projeto e exige o protocolo no assunto) ou remetente (ENEL: parte do e-mail, pelos remetentes, e procura nossos números no texto e no PDF).';

-- ── 3. os tipos de documento da ENEL ─────────────────────────────────────────
ALTER TABLE public.portal_email_regras DROP CONSTRAINT IF EXISTS portal_email_regras_tipo_documento_check;
ALTER TABLE public.portal_email_regras ADD CONSTRAINT portal_email_regras_tipo_documento_check
  CHECK (tipo_documento = ANY (ARRAY[
    'parecer'::text, 'carta_obras'::text, 'nota'::text, 'outro'::text,
    'carta_projeto'::text, 'resultado_vistoria'::text, 'troca_relogio'::text,
    'resposta_automatica'::text, 'devolucao'::text, 'comunicado'::text]));

-- ── 4. o sino toca UMA vez por mensagem: a retentativa não pode avisar de novo ─
ALTER TABLE public.portal_email_mensagens ADD COLUMN IF NOT EXISTS aviso_em TIMESTAMPTZ;

-- ── 5. modo e última verificação da conta ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_email_conta(p_account_id UUID)
RETURNS TABLE (identificacao TEXT, ultima_varredura_em TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.identificacao, a.ultima_varredura_em
    FROM public.portal_accounts a
   WHERE a.id = p_account_id AND (SELECT auth.role()) = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_conta(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_conta(UUID) TO service_role;

-- ── 6. TODOS os projetos da concessionária da conta, com o que identifica cada um
-- `ativo = false` (concluído/arquivado) ainda serve para RECONHECER um número
-- ("este e-mail é de um projeto já concluído") e para barrar arquivo de outro
-- projeto — mas nunca recebe documento nem sugestão.
CREATE OR REPLACE FUNCTION public.ludmilla_email_projetos(p_account_id UUID)
RETURNS TABLE (project_id UUID, company_id UUID, codigo TEXT, protocolo TEXT, uc TEXT,
               titular TEXT, status TEXT, ativo BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.company_id, p.code, p.protocol_number, g.uc_number, g.holder_name,
         p.status::text, (p.archived_at IS NULL AND p.status::text <> 'completed')
    FROM public.portal_accounts a
    JOIN public.projects p
      ON p.concessionaire_id = a.concessionaire_id AND p.tenant_id = a.tenant_id
    LEFT JOIN public.project_general_data g ON g.project_id = p.id
   WHERE a.id = p_account_id
     AND (SELECT auth.role()) = 'service_role'
     AND NOT p.is_deleted
   ORDER BY p.created_at DESC
   LIMIT 2000;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_projetos(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_projetos(UUID) TO service_role;

-- ── 7. aviso no sino para admin + staff do tenant, UMA vez por mensagem ──────
CREATE OR REPLACE FUNCTION public.ludmilla_email_avisar(
  p_account_id UUID, p_message_id TEXT, p_protocolo TEXT, p_project_id UUID,
  p_titulo TEXT, p_mensagem TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _conta public.portal_accounts%ROWTYPE; _msg UUID; _n INTEGER := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô toca o sino da Ludmilla';
  END IF;
  SELECT * INTO _conta FROM public.portal_accounts WHERE id = p_account_id;
  IF _conta.id IS NULL THEN RAISE EXCEPTION 'conta % não existe', p_account_id; END IF;

  -- A linha da mensagem já existe (a tentativa a abriu). Marcar e avisar no mesmo
  -- passo: a retentativa encontra aviso_em preenchido e não toca o sino de novo.
  UPDATE public.portal_email_mensagens
     SET aviso_em = now()
   WHERE account_id = p_account_id AND message_id = p_message_id
     AND protocolo = p_protocolo AND aviso_em IS NULL
  RETURNING id INTO _msg;
  IF _msg IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.notifications (tenant_id, user_id, title, message, type, project_id, read)
  SELECT _conta.tenant_id, pr.id, left(p_titulo, 200), left(p_mensagem, 1000), 'ludmilla',
         (SELECT x.id FROM public.projects x WHERE x.id = p_project_id AND x.tenant_id = _conta.tenant_id),
         FALSE
    FROM public.profiles pr
   WHERE pr.tenant_id = _conta.tenant_id AND pr.role IN ('admin', 'staff');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_email_avisar(UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_avisar(UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ── 8. o registro do e-mail lido: três parâmetros novos, a EDP não muda ──────
-- Cópia INTEIRA da definição mais recente (20261012120000, md5 do corpo
-- 799f5eed… conferido contra o banco antes de copiar), com SÓ o que a ENEL pede:
--   · `p_referencia`: o número do projeto identificado, que vira o `protocolo` do
--     cartão em `portal_updates`. A ENEL usa uma chave fixa de mensagem (`''`) —
--     um e-mail pode servir mais de um projeto —, então o número do projeto não
--     pode ser a chave da MENSAGEM, só a do cartão. Sem ele, vale o p_protocolo.
--   · `p_casamento`: como o projeto foi achado (protocolo/uc/titular). Sem ele,
--     'protocolo', como sempre.
--   · `p_abrir_cartao`: false não abre linha em `portal_updates` (e, por isso,
--     não toca o sino). A mensagem é gravada de qualquer jeito.
-- A assinatura muda (16 → 19 parâmetros): `CREATE OR REPLACE` sozinho criaria uma
-- SEGUNDA função ao lado da antiga, então a antiga sai. Os três novos têm
-- DEFAULT: a chamada da EDP (16 parâmetros nomeados) resolve para a nova sem
-- mudança alguma.
DROP FUNCTION IF EXISTS public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.ludmilla_email_registrar(
  p_run_id UUID, p_account_id UUID, p_message_id TEXT, p_protocolo TEXT,
  p_project_id UUID, p_assunto TEXT, p_remetente TEXT, p_recebido_em TIMESTAMPTZ,
  p_tipo_documento TEXT, p_veredito TEXT, p_resumo TEXT, p_anexos INTEGER,
  p_motivo TEXT, p_recomendacao TEXT, p_concluida BOOLEAN, p_arquivo_lido TEXT,
  p_referencia TEXT DEFAULT NULL, p_casamento TEXT DEFAULT NULL, p_abrir_cartao BOOLEAN DEFAULT TRUE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _conta public.portal_accounts%ROWTYPE; _msg UUID; _proj public.projects%ROWTYPE;
  _upd UUID; _tentativa INTEGER; _status TEXT; _raw JSONB; _recom_velha TEXT;
  _ref TEXT; _cas TEXT;
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
         project_id, casamento, recomendacao, situacao, detectado_em, raw)
      VALUES
        (_conta.tenant_id, p_account_id, _ref, NULL, _status,
         _proj.status::text, p_project_id, _cas, p_recomendacao, 'pendente', now(), _raw)
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
                            WHERE u.account_id = p_account_id AND u.protocolo = _ref
                              AND u.project_id = p_project_id AND u.situacao = 'pendente'
                              AND u.recomendacao = p_recomendacao) THEN
          INSERT INTO public.portal_updates
            (tenant_id, account_id, protocolo, titular_portal, status_portal, status_anterior,
             project_id, casamento, recomendacao, situacao, detectado_em, raw)
          VALUES
            (_conta.tenant_id, p_account_id, _ref, NULL, _status,
             _proj.status::text, p_project_id, _cas, p_recomendacao, 'pendente', now(), _raw)
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
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN) IS
  'Grava o e-mail lido (chave account+message_id+protocolo) e, quando p_abrir_cartao, abre/corrige o cartão em portal_updates. EDP: só os 16 primeiros parâmetros (protocolo da mensagem = protocolo do cartão, casamento protocolo). ENEL: protocolo = chave fixa da mensagem, p_referencia = número do projeto identificado (vira o protocolo do cartão), p_casamento = como achou (protocolo/uc/titular), p_abrir_cartao = false quando não há sugestão de etapa nem bloqueio.';

REVOKE ALL ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_registrar(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN)
  TO service_role;

-- ── 9. a conta da ENEL do tenant de biblioteca ───────────────────────────────
-- SEM login e SEM secret_id de propósito: o agendador (`ludmilla_agendar_varreduras`)
-- só enfileira contas com os dois, e por isso a EDP nunca recebeu varredura de
-- portal. A ENEL herda a mesma proteção. (É uma proteção acidental — anotada na
-- doc; não mexer no agendador, que é do caminho de portal.)
INSERT INTO public.portal_accounts (tenant_id, concessionaire_id, connector, acompanhamento, identificacao, modo, situacao)
SELECT c.tenant_id, c.id, 'enel', 'email', 'remetente', 'vps', 'ok'
  FROM public.energy_concessionaires c
  JOIN public.tenants t ON t.id = c.tenant_id
 WHERE t.is_library AND c.name ILIKE '%enel%'
   AND NOT EXISTS (SELECT 1 FROM public.portal_accounts x
                    WHERE x.connector = 'enel' AND x.tenant_id = c.tenant_id);

-- ── 10. as regras iniciais (spec §9) ─────────────────────────────────────────
-- Assunto '' = qualquer assunto daquele remetente. O tipo da regra é só uma DICA:
-- o que o e-mail É sai do corpo e do PDF.
INSERT INTO public.portal_email_regras (tenant_id, account_id, remetente, assunto, tipo_documento, anexar, ler_pdf, ativo, ordem)
SELECT a.tenant_id, a.id, r.remetente, '', r.tipo, r.anexar, r.ler_pdf, TRUE, r.ordem
  FROM public.portal_accounts a
 CROSS JOIN (VALUES
   ('nao.responda@enel.com',            'carta_projeto',       TRUE,  TRUE,  1),
   ('tecnico.abc@enel.com',             'resultado_vistoria',  TRUE,  TRUE,  2),
   ('tecnico.norte@enel.com',           'resultado_vistoria',  TRUE,  TRUE,  3),
   ('tecnico.oeste@enel.com',           'resultado_vistoria',  TRUE,  TRUE,  4),
   ('canalgd.sp@br.enel.com',           'troca_relogio',       TRUE,  TRUE,  5),
   ('no-reply@enel.com',                'resposta_automatica', FALSE, FALSE, 6),
   ('postmaster@enel.com',              'devolucao',           FALSE, FALSE, 7),
   ('atendimento.edsp@enel.com',        'comunicado',          FALSE, FALSE, 8)
 ) AS r(remetente, tipo, anexar, ler_pdf, ordem)
 WHERE a.connector = 'enel'
   AND NOT EXISTS (SELECT 1 FROM public.portal_email_regras x
                    WHERE x.account_id = a.id AND x.remetente = r.remetente);

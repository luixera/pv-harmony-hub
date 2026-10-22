-- ============================================================================
-- LUDMILLA — o "A fazer" da equipe e a linha do tempo do projeto (22/10/2026)
-- Spec: docs/superpowers/specs/2026-10-22-ludmilla-pagina-decidir-design.md §4
--
-- 1. portal_afazeres: o aviso que pede ação de uma pessoa (vistoria aprovada,
--    troca do relógio que falhou, e-mail nosso que voltou). Até aqui ele só
--    existia como uma linha em `notifications` POR PESSOA; o "Feito" é da
--    EQUIPE, uma vez. Leitura só da equipe do GD Manager; escrita só por RPC.
-- 2. ludmilla_email_avisar: corpo copiado do prosrc VIVO de 22/10/2026 (md5
--    f86bec4deda9d45e683aa42163e880bc) com UM acréscimo, marcado NOVO: grava o
--    "A fazer" da mensagem. O sino, o retorno (quantas pessoas avisadas) e o
--    guarda de service_role não mudam. Idempotente por mensagem, como o
--    `aviso_em`: só chega ao acréscimo quem acabou de preencher `aviso_em`, e a
--    UNIQUE (mensagem_id) segura o resto.
-- 3. ludmilla_afazer_feito(id): marca para a equipe toda.
-- 4. ludmilla_linha_do_tempo(projeto, limite): "Este projeto na Ludmilla". Os
--    ramos de `ludmilla_registro` que têm projeto (copiados do prosrc vivo, md5
--    ff561bfc0a7abff9803c2b7ca2893f0c), mais e-mails lidos e A fazer. Só leitura.
--
-- NÃO mexe em ludmilla_aplicar_update, ludmilla_registro, identificação,
-- classificação, varredura nem no worker.
-- ============================================================================

-- ── 1. A tabela ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_afazeres (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- a mensagem lida (portal_email_mensagens.id), NÃO o Message-ID do e-mail
  mensagem_id  UUID REFERENCES public.portal_email_mensagens(id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL DEFAULT 'aviso'
               CHECK (tipo IN ('vistoria_aprovada', 'troca_falhou', 'devolucao', 'aviso')),
  titulo       TEXT NOT NULL,
  mensagem     TEXT NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  feito_por    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  feito_em     TIMESTAMPTZ,
  CONSTRAINT portal_afazeres_mensagem_unica UNIQUE (mensagem_id),
  -- quem fez só existe com quando (o inverso pode: a pessoa foi apagada)
  CONSTRAINT portal_afazeres_feito_coerente CHECK (feito_por IS NULL OR feito_em IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_portal_afazeres_pendentes
  ON public.portal_afazeres (tenant_id, criado_em) WHERE feito_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_afazeres_projeto
  ON public.portal_afazeres (project_id);

ALTER TABLE public.portal_afazeres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.portal_afazeres;
CREATE POLICY tenant_isolation ON public.portal_afazeres
  AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((SELECT auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((SELECT auth.uid())));

DROP POLICY IF EXISTS equipe_le_afazeres ON public.portal_afazeres;
CREATE POLICY equipe_le_afazeres ON public.portal_afazeres
  FOR SELECT USING ((SELECT public.ludmilla_equipe_ok()));

-- nenhuma política de escrita: só as RPCs SECURITY DEFINER escrevem
REVOKE ALL ON public.portal_afazeres FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.portal_afazeres FROM authenticated;
GRANT SELECT ON public.portal_afazeres TO authenticated;

-- ── 2. O sino passa a gravar o A fazer ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_email_avisar(p_account_id uuid, p_message_id text, p_protocolo text, p_project_id uuid, p_titulo text, p_mensagem text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- NOVO (22/10/2026): o "A fazer" da EQUIPE — uma linha por mensagem, que
  -- qualquer pessoa marca como feita para todos. O `tipo` sai do título que o
  -- robô manda (worker/ludmilla/src/email/enel/decidir.ts, `avisosEnel`);
  -- título que ninguém previu vira 'aviso' e a tela mostra o próprio título.
  INSERT INTO public.portal_afazeres (tenant_id, account_id, project_id, mensagem_id, tipo, titulo, mensagem)
  VALUES (_conta.tenant_id, p_account_id,
          (SELECT x.id FROM public.projects x WHERE x.id = p_project_id AND x.tenant_id = _conta.tenant_id),
          _msg,
          CASE
            WHEN p_titulo ILIKE '%voltou%' THEN 'devolucao'
            WHEN p_titulo ILIKE '%vistoria%aprovada%' THEN 'vistoria_aprovada'
            WHEN p_titulo ILIKE '%rel_gio%' THEN 'troca_falhou'
            ELSE 'aviso'
          END,
          left(p_titulo, 200), left(p_mensagem, 1000))
  ON CONFLICT (mensagem_id) DO NOTHING;

  RETURN _n;
END;
$function$;
REVOKE ALL ON FUNCTION public.ludmilla_email_avisar(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_email_avisar(uuid, text, text, uuid, text, text) TO service_role;

-- ── 3. "Feito" para a equipe toda ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_afazer_feito(p_afazer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (SELECT auth.uid()); _tenant UUID; _n INTEGER;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);

  UPDATE public.portal_afazeres
     SET feito_por = _uid, feito_em = now()
   WHERE id = p_afazer_id AND tenant_id = _tenant AND feito_em IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 1 THEN RETURN TRUE; END IF;

  -- já estava feito (outra pessoa, ou clique duplo): o estado é o que se pediu
  IF EXISTS (SELECT 1 FROM public.portal_afazeres WHERE id = p_afazer_id AND tenant_id = _tenant) THEN
    RETURN FALSE;
  END IF;
  RAISE EXCEPTION 'Aviso não encontrado.';
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_afazer_feito(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_afazer_feito(UUID) TO authenticated;

-- ── 4. "Este projeto na Ludmilla" ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_linha_do_tempo(p_project_id UUID, p_limite INTEGER DEFAULT 60)
RETURNS TABLE(quando timestamptz, ator text, quem text, acao text, titulo text, detalhe text,
              situacao text, project_id uuid, projeto text, protocolo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE _tenant UUID; _codigo TEXT;
BEGIN
  IF NOT public.ludmilla_equipe_ok() THEN RAISE EXCEPTION 'Sem acesso à Ludmilla.'; END IF;
  _tenant := public.get_user_tenant_id((SELECT auth.uid()));
  SELECT pr.code INTO _codigo FROM public.projects pr WHERE pr.id = p_project_id AND pr.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Projeto não encontrado.'; END IF;

  RETURN QUERY
  WITH eventos AS (
    -- recomendações que ela levantou (ramo de ludmilla_registro, filtrado pelo projeto)
    SELECT u.detectado_em AS quando, 'ludmilla'::text AS ator, 'Ludmilla'::text AS quem,
           'recomendacao'::text AS acao,
           ('Mudança no portal: ' || u.status_portal)::text AS titulo,
           ('Protocolo ' || u.protocolo || coalesce(' · ' || u.titular_portal, '')
             || coalesce(' · sugere ' || u.recomendacao, ' · sem etapa sugerida')
             || CASE WHEN u.casamento IS NOT NULL AND u.casamento <> 'protocolo' THEN ' · casado por ' || u.casamento ELSE '' END)::text AS detalhe,
           'ok'::text AS situacao, u.protocolo::text AS protocolo
      FROM public.portal_updates u
     WHERE u.tenant_id = _tenant AND u.project_id = p_project_id

    UNION ALL
    -- o que a equipe decidiu sobre cada recomendação
    SELECT u.aplicada_em, 'equipe', coalesce(p.name, 'equipe'),
           CASE WHEN u.situacao = 'aplicada' THEN 'aplicada' ELSE 'ignorada' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'Recomendação aplicada' ELSE 'Recomendação ignorada' END,
           'Protocolo ' || u.protocolo
             || CASE WHEN u.situacao = 'aplicada' THEN coalesce(' → ' || u.recomendacao, '') ELSE '' END,
           CASE WHEN u.situacao = 'aplicada' THEN 'ok' ELSE 'aviso' END,
           u.protocolo
      FROM public.portal_updates u
      LEFT JOIN public.profiles p ON p.id = u.aplicada_por
     WHERE u.tenant_id = _tenant AND u.project_id = p_project_id
       AND u.situacao IN ('aplicada', 'ignorada') AND u.aplicada_em IS NOT NULL

    UNION ALL
    -- anexos que ela trouxe para o card
    SELECT coalesce(x.enviado_em, x.created_at), 'ludmilla', 'Ludmilla', 'anexo',
           CASE x.situacao WHEN 'enviado' THEN 'Anexo da concessionária no card'
                           WHEN 'bloqueado' THEN 'Anexo bloqueado (titular/UC não conferem)'
                           WHEN 'erro' THEN 'Anexo falhou' ELSE 'Anexo pendente' END,
           x.nome_arquivo || ' · protocolo ' || x.protocolo || coalesce(' · ' || x.motivo, '')
             || coalesce(' · conferido por ' || x.conferido_por, ''),
           CASE x.situacao WHEN 'enviado' THEN 'ok' WHEN 'erro' THEN 'erro' ELSE 'aviso' END,
           x.protocolo
      FROM public.portal_anexos x
     WHERE x.tenant_id = _tenant AND x.project_id = p_project_id

    UNION ALL
    -- pareceres do portal virando comentário no card
    SELECT pa.created_at, 'ludmilla', 'Ludmilla', 'parecer', 'Parecer da concessionária no card',
           coalesce(pa.analise || ' · ', '') || coalesce(pa.status, '') || ' · protocolo ' || pa.protocolo,
           'ok', pa.protocolo
      FROM public.portal_pareceres pa
     WHERE pa.tenant_id = _tenant AND pa.project_id = p_project_id

    UNION ALL
    -- tarefas encerradas porque o projeto mudou de etapa
    SELECT k.completed_at,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'ludmilla' ELSE 'equipe' END,
           CASE WHEN k.completed_by = '00000000-10d1-4000-8000-000000000002' THEN 'Ludmilla' ELSE coalesce(p.name, 'equipe') END,
           'tarefa_encerrada', 'Tarefa encerrada: ' || k.title,
           regexp_replace(split_part(k.description, '✅ ', 2), E'\\s+', ' ', 'g'),
           'ok', NULL::text
      FROM public.tasks k
      LEFT JOIN public.profiles p ON p.id = k.completed_by
     WHERE k.tenant_id = _tenant AND k.project_id = p_project_id AND k.status = 'completed'
       AND k.completed_at IS NOT NULL AND k.description LIKE '%✅ Encerrada%'

    UNION ALL
    -- NOVO: e-mails lidos deste projeto (EDP e ENEL)
    SELECT coalesce(m.recebido_em, m.created_at), 'ludmilla', 'Ludmilla', 'email',
           'E-mail lido: ' || coalesce(nullif(btrim(m.assunto), ''), '(sem assunto)'),
           nullif(concat_ws(' · ', nullif(btrim(m.remetente), ''), nullif(btrim(m.resumo), ''), nullif(btrim(m.motivo), '')), ''),
           CASE WHEN m.motivo IS NOT NULL THEN 'aviso' ELSE 'ok' END,
           nullif(m.protocolo, '')
      FROM public.portal_email_mensagens m
     WHERE m.tenant_id = _tenant AND m.project_id = p_project_id

    UNION ALL
    -- NOVO: o A fazer que ela levantou
    SELECT f.criado_em, 'ludmilla', 'Ludmilla', 'afazer', 'A fazer: ' || f.titulo, f.mensagem, 'aviso', NULL::text
      FROM public.portal_afazeres f
     WHERE f.tenant_id = _tenant AND f.project_id = p_project_id

    UNION ALL
    -- NOVO: quem marcou como feito
    SELECT f.feito_em, 'equipe', coalesce(p.name, 'equipe'), 'afazer_feito', 'Feito: ' || f.titulo, NULL::text, 'ok', NULL::text
      FROM public.portal_afazeres f
      LEFT JOIN public.profiles p ON p.id = f.feito_por
     WHERE f.tenant_id = _tenant AND f.project_id = p_project_id AND f.feito_em IS NOT NULL
  )
  SELECT e.quando, e.ator, e.quem, e.acao, e.titulo, e.detalhe, e.situacao, p_project_id, _codigo, e.protocolo
    FROM eventos e
   WHERE e.quando IS NOT NULL
   ORDER BY e.quando DESC
   LIMIT greatest(1, least(coalesce(p_limite, 60), 200));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_linha_do_tempo(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_linha_do_tempo(UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ASSINATURA — o Zé e o vencimento do certificado (03/10/2026)
--
-- O Zé avisa toda assinatura (recado) e autoriza a exceção: documento fora do
-- catálogo ou com "dúvida" na triagem só assina com o "pode" do gestor.
--
-- Esta migração é IDEMPOTENTE (CREATE OR REPLACE / IF NOT EXISTS): foi aplicada
-- uma vez e reaplicada na rodada de correção — ver .superpowers/sdd/.
--
-- Como o aviso chega ao gestor: uma OUTBOX (`ze_recados`). Quem decide avisar
-- (função do banco) só enfileira; o assinador, na VPS, pega a fila, manda cada
-- recado pelo `ze-brain` (modo 'recado') e marca como entregue. Um mecanismo só
-- para o "Libero?", o "não", a expiração e o vencimento do certificado.
-- ============================================================================

-- ── O CHECK de ze_pending_actions passa a aceitar a liberação ───────────────
ALTER TABLE public.ze_pending_actions DROP CONSTRAINT IF EXISTS ze_pending_actions_tipo_check;
ALTER TABLE public.ze_pending_actions
  ADD CONSTRAINT ze_pending_actions_tipo_check
  CHECK (tipo IN ('mover_etapa', 'liberar_assinatura'));

-- Quando o "Libero?" chegou de fato ao gestor. Sem isto preenchido o Zé não
-- pode liberar nada por conta própria (regra estrutural no resolver, abaixo).
ALTER TABLE public.ze_pending_actions ADD COLUMN IF NOT EXISTS perguntada_em TIMESTAMPTZ;

-- Uma pendência de liberação ABERTA por assinatura. O lock da função é a
-- cortesia; este índice é a trava de verdade.
CREATE UNIQUE INDEX IF NOT EXISTS ze_pendencia_liberar_unica
  ON public.ze_pending_actions ((payload->>'assinatura_id'))
  WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente';

-- ── A outbox de recados ─────────────────────────────────────────────────────
-- Tabela própria (e não colunas em ze_messages): ze_messages é a conversa
-- PRIVADA do gestor e `processada_em` já quer dizer "o cérebro consumiu". O
-- worker do assinador só enxerga esta fila, pelas RPCs abaixo.
CREATE TABLE IF NOT EXISTS public.ze_recados (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  texto        TEXT NOT NULL,
  -- o recado que é o "Libero?" de uma pendência: ao ser entregue, carimba
  -- perguntada_em nela
  pendencia_id UUID REFERENCES public.ze_pending_actions(id) ON DELETE SET NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_em     TIMESTAMPTZ,
  entregue_em  TIMESTAMPTZ,
  tentativas   SMALLINT NOT NULL DEFAULT 0,
  nota         TEXT
);
CREATE INDEX IF NOT EXISTS ze_recados_fila_idx ON public.ze_recados (criado_em) WHERE entregue_em IS NULL;

ALTER TABLE public.ze_recados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.ze_recados;
CREATE POLICY tenant_isolation ON public.ze_recados AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));
DROP POLICY IF EXISTS admin_le ON public.ze_recados;
CREATE POLICY admin_le ON public.ze_recados FOR SELECT USING ((select public.ze_admin_ok()));
-- escrita é só pelas RPCs (SECURITY DEFINER)
REVOKE INSERT, UPDATE, DELETE ON public.ze_recados FROM anon, authenticated;

-- ── Texto de fora vira texto limpo (uma linha, sem aspas nem cercas de código) ─
-- Nome de arquivo e motivo da triagem vêm de terceiros (a IA lê o PDF do
-- cliente) e acabam no prompt do Zé: nada de quebra de linha, aspas ou crase
-- para fechar o campo e abrir uma "instrução".
CREATE OR REPLACE FUNCTION public.ze_texto_limpo(_t TEXT, _max INTEGER)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT left(btrim(regexp_replace(
           regexp_replace(coalesce(_t, ''), '[\r\n\t"''`“”‘’«»<>]+', ' ', 'g'),
           '\s+', ' ', 'g')), _max);
$$;
REVOKE ALL ON FUNCTION public.ze_texto_limpo(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

-- "memorial.pdf" no PRJ-123 — para frases do Zé e comentários do card
CREATE OR REPLACE FUNCTION public.assinatura_rotulo(p_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce('"' || nullif(public.ze_texto_limpo(d.file_name, 120), '') || '"', 'o documento')
         || ' no ' || coalesce(pr.code, 'projeto')
    FROM public.assinaturas a
    LEFT JOIN public.documents d ON d.id = a.document_id
    LEFT JOIN public.projects pr ON pr.id = a.project_id
   WHERE a.id = p_id;
$$;
REVOKE ALL ON FUNCTION public.assinatura_rotulo(UUID) FROM PUBLIC, anon, authenticated;

-- ── Enfileirar um recado ────────────────────────────────────────────────────
-- Só enfileira se o tenant TEM Zé ligado: sem isso a fila encheria de aviso que
-- ninguém vai entregar.
CREATE OR REPLACE FUNCTION public.ze_recado_enfileirar(_tenant UUID, _texto TEXT, _pendencia UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID;
BEGIN
  IF coalesce(btrim(_texto), '') = '' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ze_config c WHERE c.tenant_id = _tenant AND c.enabled) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.ze_recados (tenant_id, texto, pendencia_id)
  VALUES (_tenant, left(_texto, 1200), _pendencia)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_recado_enfileirar(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ze_recado_enfileirar(UUID, TEXT, UUID) TO service_role;

-- ── O worker pega a fila ────────────────────────────────────────────────────
-- `tentativas` sobe AQUI (no pegar), e não só quando o worker conta o fracasso:
-- se o envio sai mas a marcação falha, o recado volta depois do prazo — e o
-- limite de tentativas impede o gestor de receber o mesmo aviso sem parar.
--
-- ESPERA CRESCENTE entre as tentativas: 2 min * 2^tentativas, no máximo 60 min,
-- até 8 tentativas (esperas de 4, 8, 16, 32, 60, 60 e 60 min: ~4 h no total).
-- Com espera fixa e teto 3, um Zé desconectado por 5 minutos esgotaria o
-- "Libero?" e o aviso de vencimento; assim aguenta horas fora do ar sem repetir
-- o aviso a cada 2 minutos. A rede final continua sendo o descarte por idade.
CREATE OR REPLACE FUNCTION public.ze_recados_pendentes()
RETURNS TABLE (id UUID, tenant_id UUID, texto TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- "vence em 7 dias" chegando dias depois é pior que não chegar (o sino
  -- continua mostrando): passou de 20 h, descarta.
  UPDATE public.ze_recados r
     SET entregue_em = now(), nota = 'descartado: mais de 20 h sem entrega'
   WHERE r.entregue_em IS NULL AND r.criado_em < now() - interval '20 hours';

  -- Pergunta obsoleta: o "Libero?" cuja pendência já foi decidida (pela tela, por
  -- expiração...) não pode chegar ao gestor — ele receberia uma pergunta que
  -- já não existe.
  UPDATE public.ze_recados r
     SET entregue_em = now(), nota = 'descartado: a pergunta já foi decidida'
   WHERE r.entregue_em IS NULL AND r.pendencia_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ze_pending_actions pa
                  WHERE pa.id = r.pendencia_id AND pa.situacao <> 'pendente');

  -- esgotou as 8 tentativas: fica registrado, não volta mais
  UPDATE public.ze_recados r
     SET nota = 'desistiu: 8 tentativas sem entrega'
   WHERE r.entregue_em IS NULL AND r.tentativas >= 8 AND r.nota IS DISTINCT FROM 'desistiu: 8 tentativas sem entrega';

  RETURN QUERY
    WITH pegos AS (
      SELECT r.id FROM public.ze_recados r
       WHERE r.entregue_em IS NULL AND r.tentativas < 8
         AND (r.claim_em IS NULL
              OR r.claim_em < now() - least(interval '60 minutes',
                                            interval '2 minutes' * power(2::double precision, r.tentativas::double precision)))
       ORDER BY r.criado_em
       LIMIT 10
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.ze_recados r
       SET claim_em = now(), tentativas = r.tentativas + 1
      FROM pegos
     WHERE r.id = pegos.id
    RETURNING r.id, r.tenant_id, r.texto;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_recados_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ze_recados_pendentes() TO service_role;

-- ── O worker fecha o recado ─────────────────────────────────────────────────
-- _ok: marca entregue (e, se era o "Libero?", carimba a pendência). Não _ok: a
-- tentativa já foi contada ao pegar; aqui só fica a nota — e o claim_em recente
-- faz o recado esperar (espera crescente, ver acima) antes de voltar.
CREATE OR REPLACE FUNCTION public.ze_recado_entregue(_id UUID, _ok BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _pend UUID; _achou BOOLEAN := FALSE;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF _ok THEN
    UPDATE public.ze_recados r SET entregue_em = now(), nota = NULL
     WHERE r.id = _id AND r.entregue_em IS NULL
    RETURNING r.pendencia_id INTO _pend;
    _achou := FOUND;
    IF _achou AND _pend IS NOT NULL THEN
      UPDATE public.ze_pending_actions pa SET perguntada_em = coalesce(pa.perguntada_em, now())
       WHERE pa.id = _pend AND pa.situacao = 'pendente';
    END IF;
    RETURN _achou;
  END IF;

  UPDATE public.ze_recados r SET nota = 'não entregue (Zé desconectado ou falha no envio)'
   WHERE r.id = _id AND r.entregue_em IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_recado_entregue(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ze_recado_entregue(UUID, BOOLEAN) TO service_role;

-- ── Recusar a assinatura pelo Zé (e deixar rastro no card) ──────────────────
-- Só mexe em quem ainda está em 'aguardando_ze'. O comentário no card é o mesmo
-- do assinatura_passo; o autor é quem negou, quando há, senão quem pediu, senão
-- um admin do tenant. Sem nenhum autor possível, recusa sem comentar (o
-- comentário não pode derrubar a recusa).
CREATE OR REPLACE FUNCTION public.assinatura_recusada_pelo_ze(
  p_id UUID, p_tenant UUID, p_motivo TEXT, p_autor UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _a public.assinaturas; _autor UUID; _nome TEXT;
BEGIN
  UPDATE public.assinaturas
     SET situacao = 'recusado', recusa = left(p_motivo, 500), claim_em = NULL, updated_at = now()
   WHERE id = p_id AND tenant_id = p_tenant AND situacao = 'aguardando_ze'
  RETURNING * INTO _a;
  IF _a.id IS NULL THEN RETURN FALSE; END IF;

  _autor := coalesce(p_autor, _a.pedida_por,
                     (SELECT pf.id FROM public.profiles pf
                       WHERE pf.tenant_id = _a.tenant_id AND pf.role = 'admin' ORDER BY pf.id LIMIT 1));
  IF _autor IS NOT NULL THEN
    SELECT da.nome INTO _nome FROM public.documentos_assinaveis da WHERE da.id = _a.assinavel_id;
    INSERT INTO public.comments (project_id, user_id, message, type)
    VALUES (_a.project_id, _autor,
            '🚫 Assinatura recusada — ' || coalesce(p_motivo, 'sem motivo')
              || ' (' || coalesce(_nome, 'documento') || ').', 'comment');
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_recusada_pelo_ze(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- A pendência expirou: recusa a assinatura, deixa rastro no card e conta ao gestor.
CREATE OR REPLACE FUNCTION public.assinatura_pendencia_expirou(p_tenant UUID, p_assinatura UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _rotulo TEXT := public.assinatura_rotulo(p_assinatura);
BEGIN
  IF public.assinatura_recusada_pelo_ze(
       p_assinatura, p_tenant, 'O pedido de liberação expirou sem resposta.', NULL) THEN
    PERFORM public.ze_recado_enfileirar(p_tenant,
      'O pedido para assinar ' || coalesce(_rotulo, 'o documento')
        || ' expirou sem resposta e a assinatura foi recusada.');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pendencia_expirou(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── O robô abre a pendência para o gestor ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.assinatura_pedir_ao_ze(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _a public.assinaturas; _pend UUID; _codigo TEXT; _nome TEXT; _arquivo TEXT; _quem TEXT; _resumo TEXT;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Duas chamadas ao mesmo tempo para a mesma assinatura esperam uma pela
  -- outra. O índice ze_pendencia_liberar_unica é a trava de verdade.
  PERFORM pg_advisory_xact_lock(hashtextextended('assinatura_pedir_ao_ze:' || p_id::text, 0));

  SELECT * INTO _a FROM public.assinaturas WHERE id = p_id AND situacao = 'aguardando_ze';
  IF _a.id IS NULL THEN RETURN NULL; END IF;

  -- não empilha: uma pendência por assinatura
  SELECT id INTO _pend FROM public.ze_pending_actions
   WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
     AND (payload->>'assinatura_id')::uuid = p_id;
  IF _pend IS NOT NULL THEN RETURN _pend; END IF;

  SELECT pr.code INTO _codigo FROM public.projects pr WHERE pr.id = _a.project_id;
  SELECT da.nome INTO _nome FROM public.documentos_assinaveis da WHERE da.id = _a.assinavel_id;
  SELECT d.file_name INTO _arquivo FROM public.documents d WHERE d.id = _a.document_id;
  SELECT p.name INTO _quem FROM public.profiles p WHERE p.id = _a.pedida_por;

  -- O resumo entra no prompt do Zé e vai para o WhatsApp do gestor. Nome de
  -- arquivo e motivo da triagem vêm de fora (a IA leu o PDF de um cliente):
  -- uma linha só, sem aspas nem crase, com tamanho limitado. As ÚNICAS aspas
  -- do texto são as nossas, em volta do nome do arquivo.
  _resumo := coalesce(nullif(public.ze_texto_limpo(_quem, 80), ''), 'Alguém')
    || ' quer assinar "' || coalesce(nullif(public.ze_texto_limpo(_arquivo, 120), ''), 'documento')
    || '" no ' || coalesce(public.ze_texto_limpo(_codigo, 40), 'projeto')
    || ' como ' || coalesce(nullif(public.ze_texto_limpo(_nome, 80), ''), 'documento')
    || '. ' || coalesce(nullif(public.ze_texto_limpo(_a.recusa, 300), ''), 'A triagem ficou em dúvida.')
    || ' Libero?';

  INSERT INTO public.ze_pending_actions (tenant_id, tipo, payload, resumo)
  VALUES (_a.tenant_id, 'liberar_assinatura',
          jsonb_build_object('assinatura_id', p_id, 'project_id', _a.project_id), _resumo)
  ON CONFLICT ((payload->>'assinatura_id')) WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
  DO NOTHING
  RETURNING id INTO _pend;

  IF _pend IS NULL THEN
    SELECT id INTO _pend FROM public.ze_pending_actions
     WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
       AND (payload->>'assinatura_id')::uuid = p_id;
    RETURN _pend;
  END IF;

  -- abrir a pendência não avisa ninguém: o "Libero?" vai pela outbox
  PERFORM public.ze_recado_enfileirar(_a.tenant_id, _resumo, _pend);
  RETURN _pend;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_pedir_ao_ze(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_pedir_ao_ze(UUID) TO service_role;

-- ── O "pode" (ou o "não") do gestor cai aqui (o mesmo caminho do mover_etapa) ─
CREATE OR REPLACE FUNCTION public.ze_resolver_pendencia(
  _id UUID, _confirmar BOOLEAN, _como_usuario UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _p public.ze_pending_actions; _autor UUID; _feito BOOLEAN; _motivo TEXT; _asn UUID;
BEGIN
  _autor := coalesce((select auth.uid()), _como_usuario);
  SELECT * INTO _p FROM public.ze_pending_actions WHERE id = _id;
  IF _p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'não encontrada'); END IF;
  IF _p.situacao <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'tipo', _p.tipo, 'motivo', 'já estava ' || _p.situacao);
  END IF;

  -- Tenant ANTES de qualquer efeito (inclusive o de expirar). IS DISTINCT FROM
  -- (e não <>): get_user_tenant_id devolve NULL para quem é de um tenant sem
  -- acesso (suspenso), e `NULL <> x` é NULL — o IF não disparava.
  IF (select auth.uid()) IS NOT NULL
     AND public.get_user_tenant_id((select auth.uid())) IS DISTINCT FROM _p.tenant_id THEN
    RAISE EXCEPTION 'pendência de outro tenant' USING ERRCODE = '42501';
  END IF;

  IF _p.tipo = 'liberar_assinatura' THEN _asn := (_p.payload->>'assinatura_id')::uuid; END IF;

  IF _p.expira_em < now() THEN
    UPDATE public.ze_pending_actions SET situacao = 'expirada', resolvida_em = now() WHERE id = _id;
    -- expirado = recusado: a assinatura não fica pendurada
    IF _asn IS NOT NULL THEN
      PERFORM public.assinatura_pendencia_expirou(_p.tenant_id, _asn);
    END IF;
    RETURN jsonb_build_object('ok', false, 'tipo', _p.tipo, 'motivo', 'expirou');
  END IF;

  IF NOT _confirmar THEN
    -- pela tela, recusar a assinatura de um colega também é coisa de admin
    -- (liberar já é: assinatura_liberar confere). Pelo Zé o autor é o dono.
    IF _asn IS NOT NULL AND (select auth.uid()) IS NOT NULL AND NOT public.assinatura_admin_ok() THEN
      RAISE EXCEPTION 'Só o admin decide sobre assinatura fora do catálogo.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.ze_pending_actions
       SET situacao = 'cancelada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
    IF _asn IS NOT NULL THEN
      -- liberada_por fica vazio de propósito: quem NEGOU não "liberou" nada.
      -- O comentário no card leva o nome de quem negou.
      IF public.assinatura_recusada_pelo_ze(_asn, _p.tenant_id, 'O gestor não liberou a assinatura.', _autor) THEN
        PERFORM public.ze_recado_enfileirar(_p.tenant_id,
          'Não assinei ' || coalesce(public.assinatura_rotulo(_asn), 'o documento')
            || ': você não liberou.');
      END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'tipo', _p.tipo, 'acao', 'cancelada');
  END IF;

  -- REGRA ESTRUTURAL (pelo Zé, ou seja, sem sessão de usuário): liberar uma
  -- assinatura exige que o "Libero?" tenha CHEGADO ao gestor e que ele tenha
  -- falado DEPOIS. O prompt do Zé carrega texto de documento de terceiro; se o
  -- modelo for enganado, o banco ainda não deixa liberar sem a palavra do gestor.
  IF _asn IS NOT NULL AND (select auth.uid()) IS NULL THEN
    IF _p.perguntada_em IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'tipo', _p.tipo,
        'motivo', 'o "Libero?" ainda não chegou ao gestor, então não dá para liberar');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ze_messages m
                    WHERE m.tenant_id = _p.tenant_id AND m.papel = 'user'
                      AND m.created_at > _p.perguntada_em) THEN
      RETURN jsonb_build_object('ok', false, 'tipo', _p.tipo,
        'motivo', 'o gestor ainda não respondeu depois da pergunta');
    END IF;
  END IF;

  IF _p.tipo = 'mover_etapa' THEN
    _feito := public.ze_mover_etapa(
      _p.tenant_id, (_p.payload->>'project_id')::uuid, _p.payload->>'to_status',
      _autor, _p.payload->>'motivo');
    IF NOT coalesce(_feito, false) THEN _motivo := 'o card já estava nessa etapa ou não foi encontrado'; END IF;
  ELSIF _p.tipo = 'liberar_assinatura' THEN
    _feito := public.assinatura_liberar(_asn, _autor);
    IF NOT coalesce(_feito, false) THEN _motivo := 'a assinatura já não estava aguardando liberação'; END IF;
  END IF;

  UPDATE public.ze_pending_actions
     SET situacao = 'confirmada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
  RETURN jsonb_build_object('ok', coalesce(_feito, false), 'tipo', _p.tipo, 'acao', 'confirmada', 'motivo', _motivo);
END;
$$;
GRANT EXECUTE ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;

-- ── Faxina: a pendência que ninguém respondeu também recusa a assinatura ─────
-- Sem isto o cron marcava a pendência como 'expirada' e a assinatura ficava em
-- 'aguardando_ze' para sempre — o caminho "expirou" do resolver só roda se
-- alguém tentar responder depois do prazo.
CREATE OR REPLACE FUNCTION public.ze_expirar_pendentes()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _m INTEGER := 0; _r RECORD;
BEGIN
  FOR _r IN
    SELECT pa.tenant_id, (pa.payload->>'assinatura_id')::uuid AS assinatura_id
      FROM public.ze_pending_actions pa
     WHERE pa.tipo = 'liberar_assinatura' AND pa.situacao = 'pendente' AND pa.expira_em < now()
  LOOP
    PERFORM public.assinatura_pendencia_expirou(_r.tenant_id, _r.assinatura_id);
  END LOOP;

  UPDATE public.ze_pending_actions SET situacao = 'expirada', resolvida_em = now()
   WHERE situacao = 'pendente' AND expira_em < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  -- Sugestão sem resposta em 7 dias conta como recusa branda (§7.1).
  UPDATE public.ze_tarefas_sugeridas SET situacao = 'expirada', resolvida_em = now()
   WHERE situacao = 'pendente' AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS _m = ROW_COUNT;
  RETURN _n + _m;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_expirar_pendentes() FROM PUBLIC, anon, authenticated;

-- De hora em hora (era 1x/dia): a pendência vive 24 h, não ~48.
SELECT cron.unschedule('ze-expirar') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ze-expirar');
SELECT cron.schedule('ze-expirar', '0 * * * *', $cron$ SELECT public.ze_expirar_pendentes(); $cron$);

-- ── Liberar / recusar pela TELA também fecham a pendência do Zé ─────────────
-- (copiadas de 20261003110000_assinatura_fluxo.sql; só o fechamento é novo)
CREATE OR REPLACE FUNCTION public.assinatura_liberar(p_id UUID, p_autor UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _autor UUID; _tenant UUID; _n INT;
BEGIN
  IF _uid IS NOT NULL THEN
    -- pela tela: só admin libera, e só dentro do próprio tenant.
    IF NOT public.assinatura_admin_ok() THEN
      RAISE EXCEPTION 'Só o admin libera assinatura fora do catálogo.' USING ERRCODE = '42501';
    END IF;
    _autor := _uid;
    _tenant := public.get_user_tenant_id(_uid);
  ELSE
    -- pelo Zé: chega como service_role com p_autor, que tem de ser admin do
    -- tenant DA LINHA (o robô não pode liberar com a identidade de qualquer um).
    IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
    END IF;
    IF p_autor IS NULL THEN
      RAISE EXCEPTION 'Informe quem está liberando (p_autor).';
    END IF;
    SELECT a.tenant_id INTO _tenant FROM public.assinaturas a WHERE a.id = p_id;
    IF _tenant IS NULL THEN RETURN FALSE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles pf
                    WHERE pf.id = p_autor AND pf.role = 'admin' AND pf.tenant_id = _tenant) THEN
      RAISE EXCEPTION 'Quem libera precisa ser admin do tenant deste pedido.' USING ERRCODE = '42501';
    END IF;
    _autor := p_autor;
  END IF;

  UPDATE public.assinaturas
     SET situacao = 'pendente', liberada_por = _autor, liberada_em = now(),
         claim_em = NULL, tentativas = 0, updated_at = now()
   WHERE id = p_id AND tenant_id = _tenant AND situacao = 'aguardando_ze';
  GET DIAGNOSTICS _n = ROW_COUNT;

  IF _n > 0 THEN
    -- o "Libero?" já foi respondido: não pode ficar no prompt do Zé por 24 h
    UPDATE public.ze_pending_actions
       SET situacao = 'confirmada', resolvida_em = now(), resolvida_por = _autor
     WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente' AND tenant_id = _tenant
       AND payload->>'assinatura_id' = p_id::text;
  END IF;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_liberar(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_liberar(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assinatura_recusar(p_id UUID, p_motivo TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid()); _n INT;
BEGIN
  IF _uid IS NULL OR NOT public.assinatura_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à assinatura digital.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.assinaturas
     SET situacao = 'recusado', recusa = left(coalesce(p_motivo, 'Recusado na tela.'), 500),
         claim_em = NULL, updated_at = now()
   WHERE id = p_id AND tenant_id = public.get_user_tenant_id(_uid)
     AND situacao IN ('preparando', 'conferir', 'triagem', 'aguardando_ze', 'pendente', 'assinando', 'erro');
  GET DIAGNOSTICS _n = ROW_COUNT;

  IF _n > 0 THEN
    UPDATE public.ze_pending_actions
       SET situacao = 'cancelada', resolvida_em = now(), resolvida_por = _uid
     WHERE tipo = 'liberar_assinatura' AND situacao = 'pendente'
       AND tenant_id = public.get_user_tenant_id(_uid)
       AND payload->>'assinatura_id' = p_id::text;
  END IF;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.assinatura_recusar(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_recusar(UUID, TEXT) TO authenticated;

-- ── O bug do `NULL <> x` nas duas de sugestão de tarefa (ambas com GRANT para authenticated)
-- (copiadas de 20260923200000_ze_escrita.sql; só a comparação muda)
CREATE OR REPLACE FUNCTION public.ze_aceitar_tarefa_sugerida(
  _id UUID, _ajustes JSONB DEFAULT '{}'::jsonb, _como_usuario UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _s public.ze_tarefas_sugeridas; _autor UUID; _task UUID;
BEGIN
  _autor := coalesce((select auth.uid()), _como_usuario);
  IF _autor IS NULL THEN RAISE EXCEPTION 'sem autor' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _s FROM public.ze_tarefas_sugeridas WHERE id = _id;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'sugestão não encontrada'; END IF;
  IF _s.situacao <> 'pendente' THEN RAISE EXCEPTION 'sugestão já foi %', _s.situacao; END IF;
  -- Quem chama pela tela só pode mexer no próprio tenant.
  IF (select auth.uid()) IS NOT NULL
     AND public.get_user_tenant_id((select auth.uid())) IS DISTINCT FROM _s.tenant_id THEN
    RAISE EXCEPTION 'sugestão de outro tenant' USING ERRCODE = '42501';
  END IF;

  _task := public.ze_criar_tarefa(
    _s.tenant_id, _autor,
    coalesce(_ajustes->>'titulo', _s.titulo),
    coalesce(_ajustes->>'descricao', _s.descricao),
    coalesce((_ajustes->>'vencimento')::date, _s.vencimento),
    coalesce(_ajustes->>'prioridade', _s.prioridade),
    _s.project_id,
    coalesce((_ajustes->>'assigned_to')::uuid, _s.assigned_to));

  UPDATE public.ze_tarefas_sugeridas
     SET situacao = 'aceita', task_id = _task, resolvida_em = now(), resolvida_por = _autor
   WHERE id = _id;
  RETURN _task;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ze_aceitar_tarefa_sugerida(UUID, JSONB, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.ze_aceitar_tarefa_sugerida(UUID, JSONB, UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ze_recusar_tarefa_sugerida(_id UUID, _como_usuario UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _autor UUID; _tenant UUID;
BEGIN
  _autor := coalesce((select auth.uid()), _como_usuario);
  SELECT tenant_id INTO _tenant FROM public.ze_tarefas_sugeridas WHERE id = _id AND situacao = 'pendente';
  IF _tenant IS NULL THEN RETURN FALSE; END IF;
  IF (select auth.uid()) IS NOT NULL
     AND public.get_user_tenant_id((select auth.uid())) IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'sugestão de outro tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ze_tarefas_sugeridas
     SET situacao = 'recusada', resolvida_em = now(), resolvida_por = _autor
   WHERE id = _id;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ze_recusar_tarefa_sugerida(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.ze_recusar_tarefa_sugerida(UUID, UUID) FROM PUBLIC, anon;

-- ── Vencimento do certificado: 30, 15, 7 e 1 dia antes (e no dia) ───────────
-- Idempotente: `avisado_em` guarda o último dia avisado; rodar duas vezes no
-- mesmo dia não repete notificação nem recado. Só certificado em 'ok' avisa.
ALTER TABLE public.certificados_digitais ADD COLUMN IF NOT EXISTS avisado_em DATE;

CREATE OR REPLACE FUNCTION public.certificados_avisar_vencimento()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _c RECORD; _dias INTEGER; _titulo TEXT; _msg TEXT;
BEGIN
  FOR _c IN
    SELECT c.*, (c.validade_fim - current_date) AS faltam
      FROM public.certificados_digitais c
     WHERE c.ativo AND c.situacao = 'ok' AND c.validade_fim IS NOT NULL
       AND (c.validade_fim - current_date) IN (30, 15, 7, 1, 0)
       AND c.avisado_em IS DISTINCT FROM current_date
  LOOP
    _dias := _c.faltam;
    _titulo := CASE WHEN _dias = 0 THEN 'Certificado digital vence HOJE'
                    ELSE 'Certificado digital vence em ' || _dias || ' dia' || CASE WHEN _dias > 1 THEN 's' ELSE '' END END;
    _msg := 'O certificado de ' || public.ze_texto_limpo(_c.titular_nome, 80) || ' vence em '
            || to_char(_c.validade_fim, 'DD/MM/YYYY') || '. Sem ele não dá para assinar documento nenhum.';

    INSERT INTO public.notifications (tenant_id, user_id, title, message, type, read)
    SELECT _c.tenant_id, p.id, _titulo, _msg, 'warning', FALSE
      FROM public.profiles p
     WHERE p.tenant_id = _c.tenant_id AND p.role = 'admin';

    -- e o recado do Zé (texto pronto, sem IA), pela outbox. Quando for entregue,
    -- o ze-brain o grava no chat "Você" como fala do Zé.
    PERFORM public.ze_recado_enfileirar(_c.tenant_id, _titulo || ' — ' || _msg);

    UPDATE public.certificados_digitais SET avisado_em = current_date WHERE id = _c.id;
    _n := _n + 1;
  END LOOP;

  -- quem passou da validade sai de 'ok' na hora
  UPDATE public.certificados_digitais
     SET situacao = 'vencido', erro = 'Venceu em ' || to_char(validade_fim, 'DD/MM/YYYY') || '.', updated_at = now()
   WHERE ativo AND situacao = 'ok' AND validade_fim IS NOT NULL AND validade_fim < current_date;

  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.certificados_avisar_vencimento() FROM PUBLIC, anon, authenticated;

-- 07:00 em Brasília (10:00 UTC)
SELECT cron.unschedule('certificado-vencimento') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'certificado-vencimento');
SELECT cron.schedule('certificado-vencimento', '0 10 * * *', $cron$ SELECT public.certificados_avisar_vencimento(); $cron$);

SELECT 'Zé e vencimento aplicados' AS resultado,
       (SELECT count(*) FROM cron.job WHERE jobname = 'certificado-vencimento') AS job,
       (SELECT schedule FROM cron.job WHERE jobname = 'ze-expirar') AS ze_expirar;

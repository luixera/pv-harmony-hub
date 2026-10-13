-- ============================================================================
-- API DE STATUS DA LUDMILLA (13/10/2026)
--
-- Uma porta NOSSA para o status de portal que a Ludmilla não consegue ler
-- sozinha. Caso que a motivou: o Portal GD da Elektro (Neoenergia) bloqueia
-- navegador automatizado pela Akamai antes da tela de login — até na estação
-- local, no PC de pessoa. A pessoa entra (é o que a distribuidora exige), lê
-- a lista de solicitações e entrega o que viu por aqui: protocolo, titular,
-- status. Daí em diante é o MESMO trilho da varredura — casamento com o
-- projeto, recomendação de etapa, cartão na /ludmilla para confirmar. Regra
-- da casa intacta: ninguém move card sem confirmar.
--
-- Autenticação: chave por tenant (`gdm_` + 40 hex), guardada só como SHA-256.
-- A chave em claro aparece UMA vez, na criação, e nunca mais sai do banco.
-- Quem a usa é a edge function `ludmilla-status`, que chama
-- `ludmilla_api_status_registrar` com service_role — a RPC não é exposta a
-- anon nem a authenticated.
-- ============================================================================

-- ── chaves ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ludmilla_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  prefixo       TEXT NOT NULL,                 -- "gdm_ab12cd34…" só para a tela reconhecer
  chave_hash    TEXT NOT NULL UNIQUE,          -- sha256 hex da chave inteira
  criado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_em TIMESTAMPTZ,
  revogada_em   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ludmilla_api_keys_tenant ON public.ludmilla_api_keys (tenant_id);
COMMENT ON TABLE public.ludmilla_api_keys IS
  'Chaves da API de status da Ludmilla (POST /functions/v1/ludmilla-status). Só o hash fica aqui.';

ALTER TABLE public.ludmilla_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.ludmilla_api_keys;
CREATE POLICY tenant_isolation ON public.ludmilla_api_keys AS RESTRICTIVE FOR ALL
  USING (tenant_id = public.get_user_tenant_id((select auth.uid())));

-- a equipe vê (prefixo, nome, uso); criar e revogar só pelas RPCs, só admin
DROP POLICY IF EXISTS equipe_le_chaves ON public.ludmilla_api_keys;
CREATE POLICY equipe_le_chaves ON public.ludmilla_api_keys FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));

-- ── criar (admin do tenant) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_api_key_criar(p_nome TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid    UUID := (select auth.uid());
  _tenant UUID;
  _chave  TEXT;
  _id     UUID;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok()
     OR NOT public.has_role(_uid, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Só o administrador cria chaves da API.';
  END IF;
  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Dê um nome à chave (ex.: "celular do Luiz", "script da Elektro").';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  _chave  := 'gdm_' || encode(extensions.gen_random_bytes(20), 'hex');

  INSERT INTO public.ludmilla_api_keys (tenant_id, nome, prefixo, chave_hash, criado_por)
  VALUES (_tenant, left(trim(p_nome), 80), left(_chave, 12) || '…',
          encode(extensions.digest(_chave, 'sha256'), 'hex'), _uid)
  RETURNING id INTO _id;

  -- a única vez que a chave em claro existe fora da cabeça de quem a criou
  RETURN jsonb_build_object('id', _id, 'prefixo', left(_chave, 12) || '…', 'chave', _chave);
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_api_key_criar(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_api_key_criar(TEXT) TO authenticated;

-- ── revogar (admin do tenant) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ludmilla_api_key_revogar(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := (select auth.uid());
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok()
     OR NOT public.has_role(_uid, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Só o administrador revoga chaves da API.';
  END IF;
  UPDATE public.ludmilla_api_keys
     SET revogada_em = now()
   WHERE id = p_id AND tenant_id = public.get_user_tenant_id(_uid) AND revogada_em IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_api_key_revogar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_api_key_revogar(UUID) TO authenticated;

-- ── registrar status (só a edge function, via service_role) ─────────────────
/**
 * Recebe a lista lida do portal e a põe no trilho da varredura.
 *
 * `p_protocolos`: [{ "protocolo": "...", "status": "...", "titular": "..." }, …]
 * — o MESMO formato que os conectores devolvem (`Protocolo` em
 * worker/ludmilla/src/conectores/index.ts), para que
 * `ludmilla_registrar_varredura` faça o resto sem saber de onde veio.
 *
 * O run fica com `dados.origem = 'api'` e `pedido_por` = quem criou a chave:
 * no Registro da Ludmilla aparece como visita da API, não da robô.
 */
CREATE OR REPLACE FUNCTION public.ludmilla_api_status_registrar(
  p_chave TEXT, p_connector TEXT, p_protocolos JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _key      public.ludmilla_api_keys%ROWTYPE;
  _conta    public.portal_accounts%ROWTYPE;
  _run_id   UUID;
  _qtd      INTEGER;
  _mudancas INTEGER;
  _p        JSONB;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só a edge function registra status';
  END IF;

  SELECT * INTO _key FROM public.ludmilla_api_keys
   WHERE chave_hash = encode(extensions.digest(coalesce(p_chave, ''), 'sha256'), 'hex');
  IF _key.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chave_invalida');
  END IF;
  IF _key.revogada_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chave_revogada');
  END IF;

  SELECT * INTO _conta FROM public.portal_accounts
   WHERE tenant_id = _key.tenant_id AND connector = lower(trim(p_connector)) AND enabled
   LIMIT 1;
  IF _conta.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conta_nao_encontrada',
      'detalhe', 'Não há conta de portal habilitada para "' || coalesce(p_connector, '') || '" neste tenant.');
  END IF;

  IF p_protocolos IS NULL OR jsonb_typeof(p_protocolos) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'protocolos_invalidos', 'detalhe', 'Envie "protocolos" como lista.');
  END IF;
  _qtd := 0;
  FOR _p IN SELECT * FROM jsonb_array_elements(p_protocolos) LOOP
    IF coalesce(trim(_p->>'protocolo'), '') = '' OR coalesce(trim(_p->>'status'), '') = '' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'protocolos_invalidos',
        'detalhe', 'Cada item precisa de "protocolo" e "status" preenchidos.');
    END IF;
    _qtd := _qtd + 1;
  END LOOP;
  IF _qtd = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'protocolos_invalidos', 'detalhe', 'A lista veio vazia.');
  END IF;

  UPDATE public.ludmilla_api_keys SET ultimo_uso_em = now() WHERE id = _key.id;

  -- o run nasce já "rodando", com o resultado que a varredura teria trazido
  INSERT INTO public.portal_sync_runs
    (tenant_id, account_id, tipo, situacao, pedido_por, pedido_em, iniciado_em, dados, resultado)
  VALUES
    (_key.tenant_id, _conta.id, 'varredura', 'rodando', _key.criado_por, now(), now(),
     jsonb_build_object('origem', 'api', 'chave', _key.prefixo),
     jsonb_build_object('protocolos', p_protocolos))
  RETURNING id INTO _run_id;

  _mudancas := public.ludmilla_registrar_varredura(_run_id);

  UPDATE public.portal_sync_runs
     SET situacao = 'ok', terminado_em = now(), protocolos_lidos = _qtd, mudancas = coalesce(_mudancas, 0)
   WHERE id = _run_id;
  UPDATE public.portal_accounts SET ultima_varredura_em = now(), situacao = 'ok' WHERE id = _conta.id;

  RETURN jsonb_build_object('ok', true, 'run_id', _run_id, 'protocolos', _qtd, 'mudancas', coalesce(_mudancas, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_api_status_registrar(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_api_status_registrar(TEXT, TEXT, JSONB) TO service_role;

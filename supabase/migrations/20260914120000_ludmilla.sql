-- ─────────────────────────────────────────────────────────────────────────────
-- Ludmilla — acompanhamento dos portais das concessionárias
--
-- Spec: docs/superpowers/specs/2026-09-14-ludmilla-design.md
--
-- A Ludmilla é uma funcionária como o Bidu: usuária `staff` de verdade, sem
-- senha (ninguém loga como ela), que entra nos portais das concessionárias,
-- LÊ o status de cada protocolo e devolve RECOMENDAÇÕES — nunca escreve no
-- portal, nunca move card sozinha (decisões do usuário, set/2026).
--
-- O que este arquivo cria:
--   1. a usuária
--   2. portal_accounts   — login por concessionária; a SENHA fica no Vault
--   3. portal_sync_runs  — fila e histórico das varreduras
--   4. portal_updates    — as linhas do relatório de recomendações
--   5. portal_status_map — "status do portal → etapa do Kanban"
--   6. bucket `ludmilla` para os prints
--   7. RPCs: gravar credencial (admin), ler credencial (SÓ service role),
--      pedir run (equipe), pegar run da fila e finalizar (SÓ service role)
--
-- Restrito ao tenant GD Manager (`is_library`), como o Bidu.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. A usuária ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  _ludmilla UUID := '00000000-10d1-4000-8000-000000000002';
  _tenant   UUID;
BEGIN
  SELECT id INTO _tenant FROM public.tenants WHERE is_library LIMIT 1;
  IF _tenant IS NULL THEN
    RAISE NOTICE 'Sem tenant biblioteca — Ludmilla não criada.';
    RETURN;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (_ludmilla, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'ludmilla@gdmanager.local', now(),
          jsonb_build_object('provider', 'system', 'providers', ARRAY['system'],
                             'role', 'staff', 'tenant_id', _tenant),
          jsonb_build_object('name', 'Ludmilla'), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, name, email, role, tenant_id)
  VALUES (_ludmilla, 'Ludmilla', 'ludmilla@gdmanager.local', 'staff', _tenant)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tenant_id = EXCLUDED.tenant_id;
END $$;

-- ── 2. Contas nos portais ────────────────────────────────────────────────────
-- Uma por concessionária do tenant. A senha NÃO está aqui: `secret_id`
-- aponta para o Vault, e só `ludmilla_portal_credentials` (service role)
-- consegue decifrar.
CREATE TABLE IF NOT EXISTS public.portal_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  concessionaire_id    UUID NOT NULL REFERENCES public.energy_concessionaires(id) ON DELETE CASCADE,
  -- qual roteiro o robô usa; concessionária nova = conector novo
  connector            TEXT NOT NULL CHECK (connector IN ('cpfl', 'elektro')),
  login                TEXT,
  secret_id            UUID,
  situacao             TEXT NOT NULL DEFAULT 'nao_configurado'
                       CHECK (situacao IN ('nao_configurado', 'ok', 'sessao_expirada', 'erro')),
  ultimo_erro          TEXT,
  ultima_varredura_em  TIMESTAMPTZ,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, concessionaire_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_accounts_tenant ON public.portal_accounts (tenant_id);

-- ── 3. Fila + histórico ──────────────────────────────────────────────────────
-- A mesma linha nasce `na_fila`, vira `rodando` quando o robô pega e termina
-- `ok`/`erro`. Sem tabela de fila separada: o histórico É a fila.
CREATE TABLE IF NOT EXISTS public.portal_sync_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  -- reconhecimento = abre a tela de login sem credencial e descreve o que vê
  -- varredura      = entra e lê os protocolos
  tipo             TEXT NOT NULL CHECK (tipo IN ('reconhecimento', 'varredura')),
  situacao         TEXT NOT NULL DEFAULT 'na_fila'
                   CHECK (situacao IN ('na_fila', 'rodando', 'ok', 'erro')),
  pedido_por       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pedido_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciado_em      TIMESTAMPTZ,
  terminado_em     TIMESTAMPTZ,
  protocolos_lidos INTEGER NOT NULL DEFAULT 0,
  mudancas         INTEGER NOT NULL DEFAULT 0,
  -- em português, para a tela — nunca stack trace
  erro             TEXT,
  -- caminho no bucket `ludmilla`
  print_path       TEXT,
  resultado        JSONB
);
CREATE INDEX IF NOT EXISTS idx_portal_sync_runs_tenant ON public.portal_sync_runs (tenant_id, pedido_em DESC);
-- o robô só procura o que está na fila
CREATE INDEX IF NOT EXISTS idx_portal_sync_runs_fila
  ON public.portal_sync_runs (pedido_em) WHERE situacao = 'na_fila';

-- ── 4. Relatório de recomendações ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_updates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id           UUID REFERENCES public.portal_sync_runs(id) ON DELETE SET NULL,
  account_id       UUID NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  protocolo        TEXT NOT NULL,
  titular_portal   TEXT,
  status_portal    TEXT NOT NULL,
  status_anterior  TEXT,
  project_id       UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- como a Ludmilla achou o projeto; nulo = não identificado
  casamento        TEXT CHECK (casamento IN ('protocolo', 'uc', 'titular')),
  -- etapa do Kanban recomendada (tradução por portal_status_map)
  recomendacao     TEXT,
  situacao         TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (situacao IN ('pendente', 'aplicada', 'ignorada')),
  aplicada_por     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  aplicada_em      TIMESTAMPTZ,
  detectado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw              JSONB
);
CREATE INDEX IF NOT EXISTS idx_portal_updates_tenant ON public.portal_updates (tenant_id, detectado_em DESC);
CREATE INDEX IF NOT EXISTS idx_portal_updates_pendentes
  ON public.portal_updates (tenant_id) WHERE situacao = 'pendente';
CREATE INDEX IF NOT EXISTS idx_portal_updates_project ON public.portal_updates (project_id);

-- ── 5. Tradução status do portal → etapa ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_status_map (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector      TEXT NOT NULL,
  status_portal  TEXT NOT NULL,
  project_status TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connector, status_portal)
);
CREATE INDEX IF NOT EXISTS idx_portal_status_map_tenant ON public.portal_status_map (tenant_id);

-- ── 6. Bucket dos prints (privado) ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('ludmilla', 'ludmilla', false)
ON CONFLICT (id) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.portal_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_sync_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_updates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_status_map ENABLE ROW LEVEL SECURITY;

-- Isolamento de tenant (RESTRICTIVE: vale junto com qualquer outra política).
-- auth.uid() dentro de (select …) para ser avaliado uma vez por consulta.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_accounts', 'portal_sync_runs', 'portal_updates', 'portal_status_map'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL
        USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
        WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())))
    $p$, t);
  END LOOP;
END $$;

-- Só a equipe (admin/staff) de tenant `is_library` — o mesmo recorte do Bidu.
CREATE OR REPLACE FUNCTION public.ludmilla_equipe_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid())
      AND p.role IN ('admin', 'staff')
      AND t.is_library
  );
$$;

-- Contas: a equipe lê; só ADMIN cria/edita (credencial é coisa de admin).
DROP POLICY IF EXISTS equipe_le_contas ON public.portal_accounts;
CREATE POLICY equipe_le_contas ON public.portal_accounts FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));
DROP POLICY IF EXISTS admin_gerencia_contas ON public.portal_accounts;
CREATE POLICY admin_gerencia_contas ON public.portal_accounts FOR ALL
  USING      ((select public.ludmilla_equipe_ok()) AND public.has_role((select auth.uid()), 'admin'))
  WITH CHECK ((select public.ludmilla_equipe_ok()) AND public.has_role((select auth.uid()), 'admin'));

-- Runs e relatório: a equipe lê; escrita passa por RPC ou pelo robô.
DROP POLICY IF EXISTS equipe_le_runs ON public.portal_sync_runs;
CREATE POLICY equipe_le_runs ON public.portal_sync_runs FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));

DROP POLICY IF EXISTS equipe_le_updates ON public.portal_updates;
CREATE POLICY equipe_le_updates ON public.portal_updates FOR SELECT
  USING ((select public.ludmilla_equipe_ok()));
-- aplicar/ignorar uma recomendação é UPDATE de situação — a equipe pode
DROP POLICY IF EXISTS equipe_decide_updates ON public.portal_updates;
CREATE POLICY equipe_decide_updates ON public.portal_updates FOR UPDATE
  USING      ((select public.ludmilla_equipe_ok()))
  WITH CHECK ((select public.ludmilla_equipe_ok()));

DROP POLICY IF EXISTS equipe_gerencia_mapa ON public.portal_status_map;
CREATE POLICY equipe_gerencia_mapa ON public.portal_status_map FOR ALL
  USING      ((select public.ludmilla_equipe_ok()))
  WITH CHECK ((select public.ludmilla_equipe_ok()));

-- Prints: a equipe do tenant lê os do próprio tenant (pasta = tenant_id).
DROP POLICY IF EXISTS ludmilla_prints_leitura ON storage.objects;
CREATE POLICY ludmilla_prints_leitura ON storage.objects FOR SELECT
  USING (
    bucket_id = 'ludmilla'
    AND (select public.ludmilla_equipe_ok())
    AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::text
  );

DROP TRIGGER IF EXISTS update_portal_accounts_updated_at ON public.portal_accounts;
CREATE TRIGGER update_portal_accounts_updated_at
  BEFORE UPDATE ON public.portal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 7. RPCs ──────────────────────────────────────────────────────────────────

-- Gravar credencial: só admin do tenant. A senha vai para o Vault e NUNCA
-- volta por esta função. Cria a conta se ainda não existe.
CREATE OR REPLACE FUNCTION public.set_portal_credentials(
  p_concessionaire_id UUID,
  p_login             TEXT,
  p_senha             TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid       UUID := (select auth.uid());
  _tenant    UUID;
  _account   public.portal_accounts%ROWTYPE;
  _connector TEXT;
  _nome      TEXT;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() OR NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Só um administrador do tenant pode gravar o acesso ao portal.';
  END IF;
  IF coalesce(trim(p_login), '') = '' OR coalesce(p_senha, '') = '' THEN
    RAISE EXCEPTION 'Informe login e senha do portal.';
  END IF;

  _tenant := public.get_user_tenant_id(_uid);

  SELECT name INTO _nome FROM public.energy_concessionaires
   WHERE id = p_concessionaire_id AND tenant_id = _tenant;
  IF _nome IS NULL THEN
    RAISE EXCEPTION 'Concessionária não encontrada neste tenant.';
  END IF;

  -- o conector sai do nome; concessionária sem conector ainda não é aceita
  _connector := CASE
    WHEN upper(_nome) LIKE '%CPFL%'    THEN 'cpfl'
    WHEN upper(_nome) LIKE '%ELEKTRO%' THEN 'elektro'
  END;
  IF _connector IS NULL THEN
    RAISE EXCEPTION 'A Ludmilla ainda não sabe entrar no portal da %.', _nome;
  END IF;

  SELECT * INTO _account FROM public.portal_accounts
   WHERE tenant_id = _tenant AND concessionaire_id = p_concessionaire_id;

  IF _account.id IS NULL THEN
    INSERT INTO public.portal_accounts (tenant_id, concessionaire_id, connector, login, secret_id, situacao, created_by)
    VALUES (_tenant, p_concessionaire_id, _connector, trim(p_login),
            vault.create_secret(p_senha, 'ludmilla:' || _tenant || ':' || p_concessionaire_id, 'Senha do portal ' || _nome),
            'ok', _uid)
    RETURNING * INTO _account;
  ELSE
    IF _account.secret_id IS NULL THEN
      _account.secret_id := vault.create_secret(p_senha, 'ludmilla:' || _tenant || ':' || p_concessionaire_id, 'Senha do portal ' || _nome);
    ELSE
      PERFORM vault.update_secret(_account.secret_id, p_senha);
    END IF;
    UPDATE public.portal_accounts
       SET login = trim(p_login), secret_id = _account.secret_id, connector = _connector,
           situacao = 'ok', ultimo_erro = NULL, enabled = TRUE
     WHERE id = _account.id;
  END IF;

  RETURN _account.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_portal_credentials(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_portal_credentials(UUID, TEXT, TEXT) TO authenticated;

-- Ler credencial: SÓ o robô (service role). É o único caminho de leitura da
-- senha. `authenticated` e `anon` não têm EXECUTE.
CREATE OR REPLACE FUNCTION public.ludmilla_portal_credentials(p_account_id UUID)
RETURNS TABLE (login TEXT, senha TEXT, connector TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô lê credenciais';
  END IF;
  RETURN QUERY
    SELECT a.login, s.decrypted_secret, a.connector
    FROM public.portal_accounts a
    JOIN vault.decrypted_secrets s ON s.id = a.secret_id
    WHERE a.id = p_account_id AND a.enabled;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_portal_credentials(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_portal_credentials(UUID) TO service_role;

-- Pedir um run (equipe): é o botão "Verificar agora" e o reconhecimento.
CREATE OR REPLACE FUNCTION public.ludmilla_pedir_run(p_account_id UUID, p_tipo TEXT DEFAULT 'varredura')
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid    UUID := (select auth.uid());
  _tenant UUID;
  _run    UUID;
BEGIN
  IF _uid IS NULL OR NOT public.ludmilla_equipe_ok() THEN
    RAISE EXCEPTION 'Sem acesso à Ludmilla.';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  IF NOT EXISTS (SELECT 1 FROM public.portal_accounts WHERE id = p_account_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Conta de portal não encontrada.';
  END IF;
  -- não empilha: um pedido igual já na fila é o mesmo pedido
  SELECT id INTO _run FROM public.portal_sync_runs
   WHERE account_id = p_account_id AND tipo = p_tipo AND situacao IN ('na_fila', 'rodando')
   LIMIT 1;
  IF _run IS NOT NULL THEN RETURN _run; END IF;

  INSERT INTO public.portal_sync_runs (tenant_id, account_id, tipo, pedido_por)
  VALUES (_tenant, p_account_id, p_tipo, _uid)
  RETURNING id INTO _run;
  RETURN _run;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_pedir_run(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ludmilla_pedir_run(UUID, TEXT) TO authenticated, service_role;

-- Pegar o próximo run da fila (SÓ o robô). SKIP LOCKED: dois robôs nunca
-- pegam o mesmo run.
CREATE OR REPLACE FUNCTION public.ludmilla_claim_run()
RETURNS SETOF public.portal_sync_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô pega runs';
  END IF;
  SELECT r.id INTO _id
    FROM public.portal_sync_runs r
    JOIN public.portal_accounts a ON a.id = r.account_id AND a.enabled
   WHERE r.situacao = 'na_fila'
   ORDER BY r.pedido_em
   FOR UPDATE OF r SKIP LOCKED
   LIMIT 1;
  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.portal_sync_runs
       SET situacao = 'rodando', iniciado_em = now()
     WHERE id = _id
    RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_claim_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_claim_run() TO service_role;

-- Finalizar um run (SÓ o robô) e refletir na situação da conta.
CREATE OR REPLACE FUNCTION public.ludmilla_finalizar_run(
  p_run_id        UUID,
  p_situacao      TEXT,               -- 'ok' | 'erro'
  p_erro          TEXT DEFAULT NULL,
  p_resultado     JSONB DEFAULT NULL,
  p_print_path    TEXT DEFAULT NULL,
  p_protocolos    INTEGER DEFAULT 0,
  p_mudancas      INTEGER DEFAULT 0,
  p_situacao_conta TEXT DEFAULT NULL  -- 'ok' | 'sessao_expirada' | 'erro' | NULL = não mexe
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _account UUID; _tipo TEXT;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'permission denied: só o robô finaliza runs';
  END IF;
  UPDATE public.portal_sync_runs
     SET situacao = p_situacao, terminado_em = now(), erro = p_erro, resultado = p_resultado,
         print_path = p_print_path, protocolos_lidos = p_protocolos, mudancas = p_mudancas
   WHERE id = p_run_id
   RETURNING account_id, tipo INTO _account, _tipo;
  IF _account IS NULL THEN RETURN; END IF;

  UPDATE public.portal_accounts
     SET situacao = coalesce(p_situacao_conta, situacao),
         ultimo_erro = CASE WHEN p_situacao = 'erro' THEN p_erro ELSE NULL END,
         ultima_varredura_em = CASE WHEN _tipo = 'varredura' AND p_situacao = 'ok' THEN now() ELSE ultima_varredura_em END
   WHERE id = _account;
END;
$$;
REVOKE ALL ON FUNCTION public.ludmilla_finalizar_run(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ludmilla_finalizar_run(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, INTEGER, TEXT) TO service_role;

COMMENT ON TABLE public.portal_accounts IS
  'Ludmilla: acesso ao portal de projetos de cada concessionária. A senha mora no Vault (secret_id).';
COMMENT ON TABLE public.portal_sync_runs IS
  'Ludmilla: fila e histórico das visitas aos portais (reconhecimento/varredura).';
COMMENT ON TABLE public.portal_updates IS
  'Ludmilla: recomendações de atualização de status lidas dos portais — uma pessoa aplica ou ignora.';

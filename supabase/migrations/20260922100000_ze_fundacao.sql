-- Zé (José) — fundação, Entrega 1
-- Spec: docs/superpowers/specs/2026-09-17-ze-whatsapp-design.md
-- Plano: docs/superpowers/plans/2026-09-17-ze-fundacao.md
--
-- Configuração por tenant, espelho do WhatsApp do gestor e o diálogo no chat
-- "Você". Só o dono (owner_user_id) lê o conteúdo do WhatsApp — regra dura 5.

-- ── ze_config: 1 linha por tenant ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ze_config (
  tenant_id            UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name        TEXT NOT NULL UNIQUE,
  phone_jid            TEXT,
  situacao             TEXT NOT NULL DEFAULT 'desconectado'
                       CHECK (situacao IN ('desconectado', 'aguardando_qr', 'conectado')),
  qr_code              TEXT,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  modelo_ia            TEXT NOT NULL DEFAULT 'claude-opus-5',
  esforco              TEXT NOT NULL DEFAULT 'medium' CHECK (esforco IN ('low', 'medium', 'high')),
  fuso                 TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  horas_sem_resposta   INTEGER NOT NULL DEFAULT 2 CHECK (horas_sem_resposta BETWEEN 1 AND 72),
  ignorar_grupos       BOOLEAN NOT NULL DEFAULT TRUE,
  dias_parado          INTEGER NOT NULL DEFAULT 7 CHECK (dias_parado BETWEEN 1 AND 90),
  transcrever_audios   TEXT NOT NULL DEFAULT 'todos' CHECK (transcrever_audios IN ('todos', 'so_meus', 'nenhum')),
  silencio_quando_vazio BOOLEAN NOT NULL DEFAULT TRUE,
  ocupado_ate          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── wa_chats: um por conversa (metadados, sem retenção) ─────────────────────
CREATE TABLE IF NOT EXISTS public.wa_chats (
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  jid                 TEXT NOT NULL,
  nome                TEXT,
  is_group            BOOLEAN NOT NULL DEFAULT FALSE,
  ultima_msg_em       TIMESTAMPTZ,
  ultima_de_mim       BOOLEAN,
  ultima_recebida_em  TIMESTAMPTZ,
  ultima_enviada_em   TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, jid)
);

-- ── wa_messages: espelho (texto/legenda/transcrição; mídia só como rótulo) ──
CREATE TABLE IF NOT EXISTS public.wa_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  jid         TEXT NOT NULL,
  jid_alt     TEXT,
  wa_id       TEXT NOT NULL,
  from_me     BOOLEAN NOT NULL,
  remetente   TEXT,
  tipo        TEXT NOT NULL DEFAULT 'texto'
              CHECK (tipo IN ('texto', 'audio', 'imagem', 'documento', 'video', 'outro')),
  texto       TEXT,
  transcrito  BOOLEAN NOT NULL DEFAULT FALSE,
  ts          TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wa_id)
);
CREATE INDEX IF NOT EXISTS wa_messages_chat_idx ON public.wa_messages (tenant_id, jid, ts DESC);

-- ── wa_contacts: quem é quem (contexto; a Entrega 4 preenche mais) ──────────
CREATE TABLE IF NOT EXISTS public.wa_contacts (
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  jid           TEXT NOT NULL,
  nome_push     TEXT,
  nome          TEXT,
  papel         TEXT CHECK (papel IN ('cliente', 'integrador', 'eletricista', 'concessionaria', 'fornecedor', 'pessoal', 'outro')),
  company_id    UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  project_ids   UUID[] NOT NULL DEFAULT '{}',
  notas         TEXT,
  ignorar       BOOLEAN NOT NULL DEFAULT FALSE,
  telefone      TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, jid)
);

-- ── ze_messages: o diálogo no chat "Você" (memória de curto prazo) ──────────
CREATE TABLE IF NOT EXISTS public.ze_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  papel         TEXT NOT NULL CHECK (papel IN ('user', 'ze', 'sistema')),
  texto         TEXT NOT NULL,
  wa_id         TEXT,
  rotina        TEXT,
  run_id        UUID,
  processada_em TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ze_messages_tenant_idx ON public.ze_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ze_messages_wa_idx ON public.ze_messages (tenant_id, wa_id) WHERE wa_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.ze_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_chats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ze_messages  ENABLE ROW LEVEL SECURITY;

-- Isolamento de tenant (RESTRICTIVE: vale junto com qualquer outra política).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ze_config', 'wa_chats', 'wa_messages', 'wa_contacts', 'ze_messages'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL
        USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
        WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())))
    $p$, t);
  END LOOP;
END $$;

-- Admin de tenant `is_library` (mesmo recorte do Bidu/Ludmilla, só admin).
CREATE OR REPLACE FUNCTION public.ze_admin_ok()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = (select auth.uid()) AND p.role = 'admin' AND t.is_library
  );
$$;

-- O dono do WhatsApp conectado (regra dura 5: o conteúdo é dele, de mais ninguém).
CREATE OR REPLACE FUNCTION public.ze_dono_ok(_tenant UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ze_config c
    WHERE c.tenant_id = _tenant AND c.owner_user_id = (select auth.uid())
  );
$$;

DROP POLICY IF EXISTS admin_le_config ON public.ze_config;
CREATE POLICY admin_le_config ON public.ze_config FOR SELECT
  USING ((select public.ze_admin_ok()));
DROP POLICY IF EXISTS admin_ajusta_config ON public.ze_config;
CREATE POLICY admin_ajusta_config ON public.ze_config FOR UPDATE
  USING      ((select public.ze_admin_ok()))
  WITH CHECK ((select public.ze_admin_ok()));
-- INSERT só pela RPC ze_ativar (SECURITY DEFINER).

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['wa_chats', 'wa_messages', 'wa_contacts', 'ze_messages'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS dono_le ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY dono_le ON public.%I FOR SELECT
        USING ((select public.ze_dono_ok(tenant_id)))
    $p$, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS dono_edita_contatos ON public.wa_contacts;
CREATE POLICY dono_edita_contatos ON public.wa_contacts FOR UPDATE
  USING      ((select public.ze_dono_ok(tenant_id)))
  WITH CHECK ((select public.ze_dono_ok(tenant_id)));

-- ── ze_ativar: cria a configuração do tenant de quem chama ──────────────────
CREATE OR REPLACE FUNCTION public.ze_ativar()
RETURNS public.ze_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _uid UUID := auth.uid(); _tenant UUID; _row public.ze_config;
BEGIN
  IF NOT public.ze_admin_ok() THEN
    RAISE EXCEPTION 'só o admin do GD Manager pode ativar o Zé' USING ERRCODE = '42501';
  END IF;
  _tenant := public.get_user_tenant_id(_uid);
  INSERT INTO public.ze_config (tenant_id, owner_user_id, instance_name)
  VALUES (_tenant, _uid, 'ze-' || left(replace(_tenant::text, '-', ''), 12))
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO _row FROM public.ze_config WHERE tenant_id = _tenant;
  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.ze_ativar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ze_ativar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ze_admin_ok() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ze_dono_ok(UUID) TO authenticated;

SELECT 'ze_fundacao aplicada' AS resultado;

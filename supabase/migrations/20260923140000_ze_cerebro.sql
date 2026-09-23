-- Zé — Entrega 2: o cérebro (leitura)
-- Spec: docs/superpowers/specs/2026-09-17-ze-whatsapp-design.md §7
--
-- O que entra aqui: o registro das execuções (ze_runs), a trava para não
-- rodar duas vezes ao mesmo tempo, o lançamento no extrato de IA sem sessão
-- de usuário, e as LEITURAS complexas que valem mais como SQL do que como
-- código (conversa sem resposta, card parado, dado faltando, panorama).
-- As leituras simples ficam no TypeScript da edge function.

-- ── ze_runs: cada execução do cérebro ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ze_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('mensagem', 'rotina', 'manual')),
  rotina        TEXT,
  iniciado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminado_em  TIMESTAMPTZ,
  ok            BOOLEAN,
  erro          TEXT,
  ferramentas   JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  ai_log_id     UUID
);
CREATE INDEX IF NOT EXISTS ze_runs_tenant_idx ON public.ze_runs (tenant_id, iniciado_em DESC);

ALTER TABLE public.ze_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.ze_runs;
CREATE POLICY tenant_isolation ON public.ze_runs AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())));

DROP POLICY IF EXISTS admin_le_runs ON public.ze_runs;
CREATE POLICY admin_le_runs ON public.ze_runs FOR SELECT
  USING ((select public.ze_admin_ok()));

-- ── Extrato de IA sem sessão de usuário ─────────────────────────────────────
-- A consume_ai_quota depende de auth.uid(); a rotina do Zé roda por cron, sem
-- usuário logado. Mesma conta, tenant e usuário vindos por parâmetro.
CREATE OR REPLACE FUNCTION public.consume_ai_quota_servidor(_tenant UUID, _kind TEXT, _user UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _quota INTEGER; _used INTEGER; _log_id UUID;
BEGIN
  IF _tenant IS NULL THEN
    RETURN json_build_object('allowed', false, 'reason', 'tenant_blocked');
  END IF;
  SELECT p.ai_analyses_per_month INTO _quota
    FROM public.tenants t JOIN public.plans p ON p.id = t.plan_id WHERE t.id = _tenant;
  SELECT count(*) INTO _used FROM public.ai_usage_log
   WHERE tenant_id = _tenant AND created_at >= date_trunc('month', now());
  IF _quota IS NOT NULL AND _used >= _quota THEN
    RETURN json_build_object('allowed', false, 'reason', 'quota_exceeded', 'used', _used, 'quota', _quota);
  END IF;
  INSERT INTO public.ai_usage_log (tenant_id, kind, user_id) VALUES (_tenant, _kind, _user)
  RETURNING id INTO _log_id;
  RETURN json_build_object('allowed', true, 'used', _used + 1, 'quota', _quota, 'log_id', _log_id);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_quota_servidor(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ── Trava: uma execução por vez, por tenant ─────────────────────────────────
-- Sem isso, duas mensagens seguidas abrem dois cérebros que se atropelam.
CREATE OR REPLACE FUNCTION public.ze_lock(_tenant UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _ok BOOLEAN;
BEGIN
  UPDATE public.ze_config
     SET ocupado_ate = now() + interval '3 minutes'
   WHERE tenant_id = _tenant
     AND (ocupado_ate IS NULL OR ocupado_ate < now())
  RETURNING TRUE INTO _ok;
  RETURN coalesce(_ok, FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.ze_lock(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ze_unlock(_tenant UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ UPDATE public.ze_config SET ocupado_ate = NULL WHERE tenant_id = _tenant; $$;
REVOKE ALL ON FUNCTION public.ze_unlock(UUID) FROM PUBLIC, anon, authenticated;

-- ── Panorama: os números que abrem toda conversa ────────────────────────────
CREATE OR REPLACE FUNCTION public.ze_panorama(_tenant UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'tarefas_abertas', (SELECT count(*) FROM public.tasks
                         WHERE tenant_id = _tenant AND status <> 'completed'),
    'tarefas_hoje', (SELECT count(*) FROM public.tasks
                      WHERE tenant_id = _tenant AND status <> 'completed'
                        AND due_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'tarefas_atrasadas', (SELECT count(*) FROM public.tasks
                           WHERE tenant_id = _tenant AND status <> 'completed'
                             AND due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date),
    'projetos_por_etapa', coalesce((SELECT jsonb_object_agg(s, n) FROM (
        SELECT p.status::text AS s, count(*) AS n FROM public.projects p
         WHERE p.tenant_id = _tenant AND NOT coalesce(p.is_deleted, false)
           AND p.archived_at IS NULL AND p.status::text <> 'completed'
         GROUP BY p.status::text) x), '{}'::jsonb),
    'emails_sem_aplicar', (SELECT count(*) FROM public.email_updates
                            WHERE tenant_id = _tenant AND status = 'pending'
                              AND ai_suggested_status IS NOT NULL),
    'ludmilla_pendentes', (SELECT count(*) FROM public.portal_updates
                            WHERE tenant_id = _tenant AND situacao = 'pendente'),
    'equipe', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', name, 'papel', role))
                          FROM public.profiles
                         WHERE tenant_id = _tenant AND role IN ('admin', 'staff')), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.ze_panorama(UUID) FROM PUBLIC, anon, authenticated;

-- ── Conversas sem resposta ──────────────────────────────────────────────────
-- Individuais (grupo entra só se o gestor quiser), última mensagem do OUTRO
-- lado há mais de _horas, contato não marcado como "ignorar", e nunca o
-- próprio chat "Você" — falar consigo mesmo não é ficar sem resposta.
CREATE OR REPLACE FUNCTION public.ze_conversas_sem_resposta(
  _tenant UUID, _horas INTEGER DEFAULT 2, _ignorar_grupos BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  jid TEXT, quem TEXT, papel TEXT, horas INTEGER,
  ultima_em TIMESTAMPTZ, ultima_msg TEXT, projetos UUID[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.jid,
         coalesce(ct.nome, ct.nome_push, c.nome, c.jid) AS quem,
         ct.papel,
         (extract(epoch FROM (now() - c.ultima_msg_em)) / 3600)::int AS horas,
         c.ultima_msg_em,
         (SELECT m.texto FROM public.wa_messages m
           WHERE m.tenant_id = c.tenant_id AND m.jid = c.jid
           ORDER BY m.ts DESC LIMIT 1) AS ultima_msg,
         coalesce(ct.project_ids, '{}') AS projetos
    FROM public.wa_chats c
    LEFT JOIN public.wa_contacts ct ON ct.tenant_id = c.tenant_id AND ct.jid = c.jid
   WHERE c.tenant_id = _tenant
     AND (NOT _ignorar_grupos OR NOT c.is_group)
     AND c.ultima_de_mim IS NOT TRUE
     AND c.ultima_msg_em < now() - make_interval(hours => _horas)
     AND coalesce(ct.ignorar, false) = false
     AND c.jid IS DISTINCT FROM (SELECT z.phone_jid FROM public.ze_config z WHERE z.tenant_id = _tenant)
   ORDER BY c.ultima_msg_em;
$$;
REVOKE ALL ON FUNCTION public.ze_conversas_sem_resposta(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ── Cards parados ───────────────────────────────────────────────────────────
-- O limite é o `stale_days` da coluna do Kanban quando houver (cada etapa tem
-- seu ritmo); só cai no _dias geral quando a coluna não disser nada.
CREATE OR REPLACE FUNCTION public.ze_projetos_parados(_tenant UUID, _dias INTEGER DEFAULT 7)
RETURNS TABLE (
  project_id UUID, codigo TEXT, etapa TEXT, etapa_label TEXT,
  titular TEXT, empresa TEXT, dias INTEGER, protocolo TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.code, p.status::text,
         coalesce(kc.status_label, p.status::text),
         g.holder_name, co.name,
         (extract(epoch FROM (now() - coalesce(p.last_status_change, p.updated_at))) / 86400)::int,
         p.protocol_number
    FROM public.projects p
    LEFT JOIN public.project_general_data g ON g.project_id = p.id
    LEFT JOIN public.companies co ON co.id = p.company_id
    LEFT JOIN public.kanban_columns kc
           ON kc.kanban_model_id = p.kanban_model_id AND kc.status_key = p.status::text
   WHERE p.tenant_id = _tenant
     AND NOT coalesce(p.is_deleted, false)
     AND p.archived_at IS NULL
     AND p.status::text <> 'completed'
     AND coalesce(p.last_status_change, p.updated_at)
         < now() - make_interval(days => coalesce(nullif(kc.stale_days, 0), _dias))
   ORDER BY coalesce(p.last_status_change, p.updated_at);
$$;
REVOKE ALL ON FUNCTION public.ze_projetos_parados(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

-- ── Dados faltando ──────────────────────────────────────────────────────────
-- O que trava a homologação mais tarde: sem titular, sem CPF/CNPJ, sem UC,
-- sem telefone, sem equipamento — e sem protocolo em etapa que exige.
CREATE OR REPLACE FUNCTION public.ze_projetos_dados_faltando(_tenant UUID)
RETURNS TABLE (project_id UUID, codigo TEXT, etapa TEXT, titular TEXT, empresa TEXT, falta TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.code, p.status::text, g.holder_name, co.name,
         array_to_string(array_remove(ARRAY[
           CASE WHEN coalesce(g.holder_name, '') = ''     THEN 'titular'    END,
           CASE WHEN coalesce(g.holder_cpf_cnpj, '') = '' THEN 'CPF/CNPJ'   END,
           CASE WHEN coalesce(g.uc_number, '') = ''       THEN 'UC'         END,
           CASE WHEN coalesce(g.holder_phone, '') = ''    THEN 'telefone'   END,
           CASE WHEN e.project_id IS NULL                 THEN 'equipamento' END,
           CASE WHEN coalesce(kc.requires_protocol, false)
                 AND coalesce(p.protocol_number, '') = ''  THEN 'protocolo'  END
         ], NULL), ', ')
    FROM public.projects p
    LEFT JOIN public.project_general_data g ON g.project_id = p.id
    LEFT JOIN public.project_equipment e ON e.project_id = p.id
    LEFT JOIN public.companies co ON co.id = p.company_id
    LEFT JOIN public.kanban_columns kc
           ON kc.kanban_model_id = p.kanban_model_id AND kc.status_key = p.status::text
   WHERE p.tenant_id = _tenant
     AND NOT coalesce(p.is_deleted, false)
     AND p.archived_at IS NULL
     AND p.status::text NOT IN ('completed', 'pending')
     AND (coalesce(g.holder_name, '') = '' OR coalesce(g.holder_cpf_cnpj, '') = ''
       OR coalesce(g.uc_number, '') = '' OR coalesce(g.holder_phone, '') = ''
       OR e.project_id IS NULL
       OR (coalesce(kc.requires_protocol, false) AND coalesce(p.protocol_number, '') = ''))
   ORDER BY p.code;
$$;
REVOKE ALL ON FUNCTION public.ze_projetos_dados_faltando(UUID) FROM PUBLIC, anon, authenticated;

SELECT 'ze_cerebro aplicada' AS resultado;

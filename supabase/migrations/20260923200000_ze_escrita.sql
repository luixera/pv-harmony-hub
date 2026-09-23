-- Zé — Entrega 3: a escrita (com confirmação)
-- Spec: docs/superpowers/specs/2026-09-17-ze-whatsapp-design.md §7.1
--
-- Decisão do usuário (23/09): a lista oficial de tarefas NÃO recebe palpite
-- de robô. O que o Zé inventa fica em `ze_tarefas_sugeridas` e só vira tarefa
-- quando o gestor aceita. Pedido direto do gestor no chat cria na hora — o
-- pedido já é a confirmação.
--
-- Mover etapa nunca acontece sem um "sim": vira pendência em
-- `ze_pending_actions`, que expira em 24 h.

-- ── Caixa de sugestões de tarefa ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ze_tarefas_sugeridas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  descricao     TEXT,
  vencimento    DATE,
  prioridade    TEXT NOT NULL DEFAULT 'medium' CHECK (prioridade IN ('low', 'medium', 'high')),
  project_id    UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  assigned_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo        TEXT,
  origem        TEXT NOT NULL DEFAULT 'conversa' CHECK (origem IN ('rotina', 'conversa', 'varredura')),
  run_id        UUID,
  situacao      TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'aceita', 'recusada', 'expirada')),
  task_id       UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  resolvida_em  TIMESTAMPTZ,
  resolvida_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ze_sugeridas_pendentes_idx
  ON public.ze_tarefas_sugeridas (tenant_id, created_at DESC) WHERE situacao = 'pendente';

-- ── Ações que esperam um "sim" (hoje: mover etapa) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.ze_pending_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('mover_etapa')),
  payload       JSONB NOT NULL,
  resumo        TEXT NOT NULL,
  situacao      TEXT NOT NULL DEFAULT 'pendente'
                CHECK (situacao IN ('pendente', 'confirmada', 'cancelada', 'expirada')),
  expira_em     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  resolvida_em  TIMESTAMPTZ,
  resolvida_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  run_id        UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ze_pendencias_idx
  ON public.ze_pending_actions (tenant_id, created_at DESC) WHERE situacao = 'pendente';

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.ze_tarefas_sugeridas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ze_pending_actions   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ze_tarefas_sugeridas', 'ze_pending_actions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL
        USING      (tenant_id = public.get_user_tenant_id((select auth.uid())))
        WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid())))
    $p$, t);
    EXECUTE format('DROP POLICY IF EXISTS admin_le ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY admin_le ON public.%I FOR SELECT USING ((select public.ze_admin_ok()))
    $p$, t);
  END LOOP;
END $$;

-- ── Criar tarefa (pedido direto do gestor) ──────────────────────────────────
-- Vai DIRETO para a lista oficial: quem pediu foi ele. Autor = o gestor,
-- origem = 'ze' (padrão da casa: a pessoa assina, o agente é a procedência).
CREATE OR REPLACE FUNCTION public.ze_criar_tarefa(
  _tenant UUID, _autor UUID, _titulo TEXT, _descricao TEXT DEFAULT NULL,
  _vencimento DATE DEFAULT NULL, _prioridade TEXT DEFAULT 'medium',
  _project_id UUID DEFAULT NULL, _assigned_to UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _id UUID; _resp UUID;
BEGIN
  -- Responsável tem de ser da equipe DESTE tenant (mesma regra das tarefas
  -- automáticas); se vier alguém de fora, cai no próprio gestor.
  SELECT p.id INTO _resp FROM public.profiles p
   WHERE p.id = _assigned_to AND p.tenant_id = _tenant AND p.role IN ('admin', 'staff');
  IF _project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = _project_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'projeto de outro tenant' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tasks (tenant_id, title, description, due_date, priority,
                            project_id, assigned_to, created_by, status, origin)
  VALUES (_tenant, _titulo, _descricao, _vencimento, coalesce(_prioridade, 'medium'),
          _project_id, coalesce(_resp, _autor), _autor, 'pending', 'ze')
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_criar_tarefa(UUID, UUID, TEXT, TEXT, DATE, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ── Aceitar uma sugestão ────────────────────────────────────────────────────
-- Dois caminhos entram aqui: a tela (usuário logado) e o WhatsApp (service
-- role, passando _como_usuario). auth.uid() tem precedência — ninguém
-- logado consegue se passar por outro.
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
     AND public.get_user_tenant_id((select auth.uid())) <> _s.tenant_id THEN
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
     AND public.get_user_tenant_id((select auth.uid())) <> _tenant THEN
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

-- ── Mexer em tarefa que já existe ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ze_mexer_tarefa(
  _tenant UUID, _task_id UUID, _acao TEXT,
  _nova_data DATE DEFAULT NULL, _assigned_to UUID DEFAULT NULL, _autor UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _ok BOOLEAN; _resp UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = _task_id AND tenant_id = _tenant) THEN
    RETURN FALSE;
  END IF;

  IF _acao = 'concluir' THEN
    UPDATE public.tasks SET status = 'completed', completed_at = now(), completed_by = _autor
     WHERE id = _task_id RETURNING TRUE INTO _ok;
  ELSIF _acao = 'adiar' THEN
    IF _nova_data IS NULL THEN RETURN FALSE; END IF;
    UPDATE public.tasks SET due_date = _nova_data WHERE id = _task_id RETURNING TRUE INTO _ok;
  ELSIF _acao = 'reatribuir' THEN
    SELECT p.id INTO _resp FROM public.profiles p
     WHERE p.id = _assigned_to AND p.tenant_id = _tenant AND p.role IN ('admin', 'staff');
    IF _resp IS NULL THEN RETURN FALSE; END IF;
    UPDATE public.tasks SET assigned_to = _resp WHERE id = _task_id RETURNING TRUE INTO _ok;
  ELSE
    RETURN FALSE;
  END IF;
  RETURN coalesce(_ok, FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.ze_mexer_tarefa(UUID, UUID, TEXT, DATE, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Anotar no card ──────────────────────────────────────────────────────────
-- Vai para o mesmo lugar de sempre: comentário + linha no histórico, com a
-- pessoa como autora e "(via Zé)" para ninguém achar que foi digitado à mão.
CREATE OR REPLACE FUNCTION public.ze_anotar_no_card(
  _tenant UUID, _project_id UUID, _texto TEXT, _autor UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _nome TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND tenant_id = _tenant) THEN
    RETURN FALSE;
  END IF;
  SELECT name INTO _nome FROM public.profiles WHERE id = _autor;

  INSERT INTO public.comments (project_id, user_id, message, type)
  VALUES (_project_id, _autor, _texto, 'internal');

  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (_project_id, 'Anotação', _texto, _autor, coalesce(_nome, 'gestor') || ' (via Zé)');
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_anotar_no_card(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ── Mover etapa (só depois do "sim") ────────────────────────────────────────
-- Faz o mesmo que a tela: muda o status e escreve o histórico no formato que
-- o front usa. Os gatilhos existentes (tarefa automática, aviso) disparam
-- sozinhos porque a mudança é um UPDATE comum em projects.
CREATE OR REPLACE FUNCTION public.ze_mover_etapa(
  _tenant UUID, _project_id UUID, _to_status TEXT, _autor UUID, _motivo TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _de TEXT; _nome TEXT; _label_de TEXT; _label_para TEXT; _modelo UUID;
BEGIN
  SELECT p.status::text, p.kanban_model_id INTO _de, _modelo
    FROM public.projects p WHERE p.id = _project_id AND p.tenant_id = _tenant;
  IF _de IS NULL THEN RETURN FALSE; END IF;
  IF _de = _to_status THEN RETURN FALSE; END IF;

  -- A etapa tem de existir no template de Kanban do projeto (a mesma regra
  -- das tarefas automáticas: o enum tem valores que o template não usa).
  IF NOT EXISTS (SELECT 1 FROM public.kanban_columns
                  WHERE kanban_model_id = _modelo AND status_key = _to_status) THEN
    RAISE EXCEPTION 'etapa % não existe no quadro deste projeto', _to_status;
  END IF;

  SELECT status_label INTO _label_de   FROM public.kanban_columns
   WHERE kanban_model_id = _modelo AND status_key = _de;
  SELECT status_label INTO _label_para FROM public.kanban_columns
   WHERE kanban_model_id = _modelo AND status_key = _to_status;
  SELECT name INTO _nome FROM public.profiles WHERE id = _autor;

  UPDATE public.projects
     SET status = _to_status::public.project_status, last_status_change = now()
   WHERE id = _project_id;

  INSERT INTO public.project_history (project_id, action, description, user_id, user_name)
  VALUES (_project_id, 'Etapa alterada',
          'Etapa alterada de "' || coalesce(_label_de, _de) || '" para "' || coalesce(_label_para, _to_status) || '"'
            || coalesce(' — via Zé: ' || _motivo, ' — via Zé'),
          _autor, coalesce(_nome, 'gestor') || ' (via Zé)');
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.ze_mover_etapa(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── Confirmar / cancelar a pendência (tela e WhatsApp caem aqui) ────────────
CREATE OR REPLACE FUNCTION public.ze_resolver_pendencia(
  _id UUID, _confirmar BOOLEAN, _como_usuario UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _p public.ze_pending_actions; _autor UUID; _feito BOOLEAN;
BEGIN
  _autor := coalesce((select auth.uid()), _como_usuario);
  SELECT * INTO _p FROM public.ze_pending_actions WHERE id = _id;
  IF _p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'não encontrada'); END IF;
  IF _p.situacao <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'já estava ' || _p.situacao);
  END IF;
  IF _p.expira_em < now() THEN
    UPDATE public.ze_pending_actions SET situacao = 'expirada', resolvida_em = now() WHERE id = _id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'expirou');
  END IF;
  IF (select auth.uid()) IS NOT NULL
     AND public.get_user_tenant_id((select auth.uid())) <> _p.tenant_id THEN
    RAISE EXCEPTION 'pendência de outro tenant' USING ERRCODE = '42501';
  END IF;

  IF NOT _confirmar THEN
    UPDATE public.ze_pending_actions
       SET situacao = 'cancelada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
    RETURN jsonb_build_object('ok', true, 'acao', 'cancelada');
  END IF;

  IF _p.tipo = 'mover_etapa' THEN
    _feito := public.ze_mover_etapa(
      _p.tenant_id, (_p.payload->>'project_id')::uuid, _p.payload->>'to_status',
      _autor, _p.payload->>'motivo');
  END IF;

  UPDATE public.ze_pending_actions
     SET situacao = 'confirmada', resolvida_em = now(), resolvida_por = _autor WHERE id = _id;
  RETURN jsonb_build_object('ok', coalesce(_feito, false), 'acao', 'confirmada');
END;
$$;
GRANT EXECUTE ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.ze_resolver_pendencia(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;

-- ── Faxina: sugestão e pendência não apodrecem ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ze_expirar_pendentes()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE _n INTEGER := 0; _m INTEGER := 0;
BEGIN
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

SELECT cron.unschedule('ze-expirar') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ze-expirar');
SELECT cron.schedule('ze-expirar', '0 4 * * *', $cron$ SELECT public.ze_expirar_pendentes(); $cron$);

SELECT 'ze_escrita aplicada' AS resultado;

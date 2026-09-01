-- ─────────────────────────────────────────────────────────────────────────────
-- Tarefas automáticas por mudança de etapa do Kanban
--
-- Regra do tenant: "quando o card entrar em ETAPA X (opcionalmente vindo da
-- ETAPA Y), crie uma tarefa para FULANO com N dias de prazo".
--
-- Por que o gatilho fica no banco e não no front: a etapa do projeto muda por
-- caminhos diferentes — arrastar no quadro, o seletor do modal do projeto e a
-- aplicação de etapa vinda do /email-updates. Um gatilho em `projects` pega
-- todos de uma vez; espalhar a criação pelo front deixaria buracos.
--
-- As etapas são gravadas como TEXTO (o `status_key` do template de Kanban), e
-- não como o enum project_status: o template é a fonte da verdade das etapas
-- que o usuário enxerga, e ele tem colunas que o enum não tem (e vice-versa).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_automations (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,

  -- Etapa de destino (obrigatória) e de origem (NULL = "de qualquer etapa").
  from_status       TEXT,
  to_status         TEXT        NOT NULL,

  assigned_to       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  days_to_complete  INT         NOT NULL DEFAULT 3
                                CHECK (days_to_complete BETWEEN 0 AND 365),
  priority          TEXT        NOT NULL DEFAULT 'medium'
                                CHECK (priority IN ('low','medium','high','urgent')),

  -- Aceitam as variáveis {codigo} {titular} {empresa} {etapa} {etapa_anterior} {dias}
  title             TEXT        NOT NULL,
  description       TEXT,

  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_automations_disparo
  ON public.task_automations (tenant_id, to_status) WHERE enabled;

ALTER TABLE public.task_automations ENABLE ROW LEVEL SECURITY;

-- Isolamento de tenant (RESTRICTIVE: vale junto com qualquer outra política).
DROP POLICY IF EXISTS tenant_isolation ON public.task_automations;
CREATE POLICY tenant_isolation ON public.task_automations
  AS RESTRICTIVE FOR ALL
  USING      (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Quem configura é o admin do tenant.
DROP POLICY IF EXISTS admin_manage_task_automations ON public.task_automations;
CREATE POLICY admin_manage_task_automations ON public.task_automations
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- O projetista precisa conseguir LER a regra para a tela mostrar "esta tarefa
-- nasceu da automação X"; alterar, não.
DROP POLICY IF EXISTS staff_read_task_automations ON public.task_automations;
CREATE POLICY staff_read_task_automations ON public.task_automations
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','staff')));

DROP TRIGGER IF EXISTS update_task_automations_updated_at ON public.task_automations;
CREATE TRIGGER update_task_automations_updated_at
  BEFORE UPDATE ON public.task_automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Marca a tarefa que nasceu de uma automação. Serve para dois fins: mostrar a
-- origem na tela e evitar que o mesmo card, indo e voltando de etapa, empilhe
-- tarefas repetidas.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS automation_id UUID
    REFERENCES public.task_automations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_automation
  ON public.tasks (automation_id, project_id)
  WHERE automation_id IS NOT NULL;

-- ── Gatilho ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_run_task_automations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_titular    TEXT;
  v_empresa    TEXT;
  v_etapa      TEXT;
  v_etapa_ant  TEXT;
  v_titulo     TEXT;
  v_desc       TEXT;
  v_autor      UUID;
BEGIN
  -- "UPDATE OF status" dispara mesmo quando o SET repete o valor atual.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Rótulos legíveis vêm do template de Kanban; se a coluna não existir mais
  -- no template, cai para a própria chave.
  SELECT c.status_label INTO v_etapa
    FROM public.kanban_columns c
    JOIN public.kanban_models m ON m.id = c.kanban_model_id
   WHERE m.is_active AND c.status_key = NEW.status::TEXT
   LIMIT 1;
  v_etapa := COALESCE(v_etapa, NEW.status::TEXT);

  SELECT c.status_label INTO v_etapa_ant
    FROM public.kanban_columns c
    JOIN public.kanban_models m ON m.id = c.kanban_model_id
   WHERE m.is_active AND c.status_key = OLD.status::TEXT
   LIMIT 1;
  v_etapa_ant := COALESCE(v_etapa_ant, OLD.status::TEXT);

  SELECT g.holder_name INTO v_titular
    FROM public.project_general_data g WHERE g.project_id = NEW.id LIMIT 1;
  SELECT co.name INTO v_empresa
    FROM public.companies co WHERE co.id = NEW.company_id LIMIT 1;

  FOR r IN
    SELECT * FROM public.task_automations
     WHERE tenant_id = NEW.tenant_id
       AND enabled
       AND to_status = NEW.status::TEXT
       AND (from_status IS NULL OR from_status = OLD.status::TEXT)
     ORDER BY created_at
  LOOP
    -- Defesa: o responsável tem de ser admin/projetista DO MESMO tenant. Sem
    -- isto, uma regra órfã (usuário removido ou movido de tenant) criaria
    -- tarefa para fora do tenant.
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = r.assigned_to
         AND p.tenant_id = NEW.tenant_id
         AND p.role IN ('admin','staff')
    ) THEN
      CONTINUE;
    END IF;

    -- Não empilha: se a tarefa anterior da mesma regra para este projeto ainda
    -- está aberta, o card voltando e entrando de novo não gera outra.
    IF EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.project_id = NEW.id
         AND t.automation_id = r.id
         AND t.status IN ('pending','in_progress')
    ) THEN
      CONTINUE;
    END IF;

    v_titulo := r.title;
    v_desc   := COALESCE(r.description, '');

    v_titulo := replace(v_titulo, '{codigo}',        COALESCE(NEW.code, ''));
    v_titulo := replace(v_titulo, '{titular}',       COALESCE(v_titular, ''));
    v_titulo := replace(v_titulo, '{empresa}',       COALESCE(v_empresa, ''));
    v_titulo := replace(v_titulo, '{etapa}',         v_etapa);
    v_titulo := replace(v_titulo, '{etapa_anterior}', v_etapa_ant);
    v_titulo := replace(v_titulo, '{dias}',          r.days_to_complete::TEXT);

    v_desc := replace(v_desc, '{codigo}',        COALESCE(NEW.code, ''));
    v_desc := replace(v_desc, '{titular}',       COALESCE(v_titular, ''));
    v_desc := replace(v_desc, '{empresa}',       COALESCE(v_empresa, ''));
    v_desc := replace(v_desc, '{etapa}',         v_etapa);
    v_desc := replace(v_desc, '{etapa_anterior}', v_etapa_ant);
    v_desc := replace(v_desc, '{dias}',          r.days_to_complete::TEXT);

    -- created_by é NOT NULL. auth.uid() é nulo quando a etapa muda por uma
    -- rotina de servidor (ex.: aplicação de etapa vinda do e-mail), então cai
    -- para quem criou a regra e, por último, para o próprio responsável.
    v_autor := COALESCE(auth.uid(), r.created_by, r.assigned_to);

    INSERT INTO public.tasks
      (tenant_id, title, description, status, priority, due_date,
       project_id, created_by, assigned_to, automation_id)
    VALUES
      (NEW.tenant_id, v_titulo, NULLIF(v_desc, ''), 'pending', r.priority,
       (CURRENT_DATE + r.days_to_complete),
       NEW.id, v_autor, r.assigned_to, r.id);

    INSERT INTO public.notifications
      (tenant_id, user_id, title, message, type, project_id, read)
    VALUES
      (NEW.tenant_id, r.assigned_to, '📋 Nova tarefa automática',
       v_titulo || ' · Prazo: ' ||
         to_char(CURRENT_DATE + r.days_to_complete, 'DD/MM/YYYY'),
       'task_assigned', NEW.id, FALSE);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_automations ON public.projects;
CREATE TRIGGER trg_task_automations
  AFTER UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_run_task_automations();

COMMENT ON TABLE public.task_automations IS
  'Regras "mudou para a etapa X do Kanban → cria tarefa para fulano com N dias".';

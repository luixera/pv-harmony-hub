-- ── Tasks ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','in_progress','completed','cancelled')),
  priority     TEXT        NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low','medium','high','urgent')),
  due_date     DATE,
  project_id   UUID        REFERENCES projects(id) ON DELETE SET NULL,
  created_by   UUID        NOT NULL REFERENCES auth.users(id),
  assigned_to  UUID        REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  completed_by UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Admin: acesso total
CREATE POLICY "admin_all_tasks"
  ON tasks FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Staff: vê/edita somente as suas (criadas ou atribuídas)
CREATE POLICY "staff_own_tasks"
  ON tasks FOR ALL
  USING (
    auth.uid() = created_by OR auth.uid() = assigned_to
  )
  WITH CHECK (
    auth.uid() = created_by OR auth.uid() = assigned_to
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_tasks_assigned  ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_created   ON tasks(created_by,  status);
CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks(project_id)  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due       ON tasks(due_date)    WHERE status NOT IN ('completed','cancelled');

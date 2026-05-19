-- =============================================================================
-- 004_performance_indexes.sql
-- Índices de performance — GD Manager Energy
-- Aplique em: Supabase Dashboard → SQL Editor → New query → Run
--
-- Cria índices nas FKs que não tinham índice (identificadas por auditoria).
-- Cada FK sem índice = table scan em queries com JOIN/WHERE nessa coluna.
-- Todos os CREATE INDEX são IF NOT EXISTS (idempotentes, seguros para re-executar).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- projects — 4 FKs sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_concessionaire_id
  ON projects(concessionaire_id);

CREATE INDEX IF NOT EXISTS idx_projects_created_by
  ON projects(created_by);

CREATE INDEX IF NOT EXISTS idx_projects_deleted_by
  ON projects(deleted_by)
  WHERE deleted_by IS NOT NULL; -- partial index: só projetos deletados

CREATE INDEX IF NOT EXISTS idx_projects_form_config_id
  ON projects(form_config_id)
  WHERE form_config_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- documents — uploaded_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by
  ON documents(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- comments — user_id sem índice (FK para auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comments_user_id
  ON comments(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- project_history — user_id sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_history_user_id
  ON project_history(user_id)
  WHERE user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- financials — company_id sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_financials_company_id
  ON financials(company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- financial_payments — financial_id sem índice (FK para financials)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_financial_payments_financial_id
  ON financial_payments(financial_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- form_configs — created_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_form_configs_created_by
  ON form_configs(created_by)
  WHERE created_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- form_field_rules — field_id sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_form_field_rules_field_id
  ON form_field_rules(field_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- project_assignments — assigned_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_assignments_assigned_by
  ON project_assignments(assigned_by)
  WHERE assigned_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- kanban_models — created_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kanban_models_created_by
  ON kanban_models(created_by)
  WHERE created_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- company_kanban_model — assigned_by e kanban_model_id sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_company_kanban_model_assigned_by
  ON company_kanban_model(assigned_by)
  WHERE assigned_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_kanban_model_kanban_model_id
  ON company_kanban_model(kanban_model_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- energy_concessionaires — created_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_energy_concessionaires_created_by
  ON energy_concessionaires(created_by)
  WHERE created_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- concessionaire_documents — concessionaire_id e uploaded_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_concessionaire_documents_concessionaire_id
  ON concessionaire_documents(concessionaire_id);

CREATE INDEX IF NOT EXISTS idx_concessionaire_documents_uploaded_by
  ON concessionaire_documents(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- concessionaire_templates — concessionaire_id e uploaded_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_concessionaire_templates_concessionaire_id
  ON concessionaire_templates(concessionaire_id);

CREATE INDEX IF NOT EXISTS idx_concessionaire_templates_uploaded_by
  ON concessionaire_templates(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- project_revisions — created_by sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_revisions_created_by
  ON project_revisions(created_by)
  WHERE created_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- revision_general_data — revision_id sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_revision_general_data_revision_id
  ON revision_general_data(revision_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- revision_equipment — revision_id sem índice
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_revision_equipment_revision_id
  ON revision_equipment(revision_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Índices compostos de alta utilidade (queries frequentes do sistema)
-- ─────────────────────────────────────────────────────────────────────────────

-- Kanban: busca por empresa + status (Dashboard e Kanban board)
CREATE INDEX IF NOT EXISTS idx_projects_company_status
  ON projects(company_id, status)
  WHERE is_deleted = false;

-- Histórico: mais recente primeiro por projeto
CREATE INDEX IF NOT EXISTS idx_project_history_project_created
  ON project_history(project_id, created_at DESC);

-- Comentários por projeto, mais recente primeiro
CREATE INDEX IF NOT EXISTS idx_comments_project_created
  ON comments(project_id, created_at DESC);

-- Notificações não lidas por usuário (sino)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read = false;

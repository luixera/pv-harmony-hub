-- ============================================================
-- Migration: Sistema de Revisões para projetos reprovados
-- ============================================================

-- 1. Adicionar 'rejected' ao enum project_status
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'rejected' AFTER 'approved';

-- ============================================================
-- 1.1 TABELA project_revisions
-- ============================================================
CREATE TABLE IF NOT EXISTS project_revisions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_number  INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'pending',
  is_current       BOOLEAN NOT NULL DEFAULT true,
  rejection_reason TEXT,
  rejected_by      TEXT,
  rejected_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_project_revisions_project_id
  ON project_revisions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_revisions_is_current
  ON project_revisions(project_id, is_current);

-- ============================================================
-- 1.2 TABELA revision_general_data
-- ============================================================
CREATE TABLE IF NOT EXISTS revision_general_data (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  revision_id            UUID NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  holder_name            TEXT,
  holder_cpf_cnpj        TEXT,
  holder_phone           TEXT,
  holder_email           TEXT,
  address                TEXT,
  city                   TEXT,
  state                  TEXT,
  cep                    TEXT,
  uc_number              TEXT,
  utility_company        TEXT,
  circuit_breaker_current TEXT,
  phase_type             TEXT,
  coordinates            TEXT,
  is_rural               BOOLEAN DEFAULT false,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_general_data_revision_id
  ON revision_general_data(revision_id);

-- ============================================================
-- 1.3 TABELA revision_equipment
-- ============================================================
CREATE TABLE IF NOT EXISTS revision_equipment (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  revision_id          UUID NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  inverter_brand       TEXT,
  inverter_model       TEXT,
  inverter_power       NUMERIC,
  inverter_quantity    INTEGER,
  module_brand         TEXT,
  module_model         TEXT,
  module_power         NUMERIC,
  module_quantity      INTEGER,
  total_installed_power NUMERIC,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_equipment_revision_id
  ON revision_equipment(revision_id);

-- ============================================================
-- 1.4 RLS POLICIES
-- ============================================================
ALTER TABLE project_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_general_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_equipment ENABLE ROW LEVEL SECURITY;

-- project_revisions: admin acesso total
CREATE POLICY "admin_all_revisions"
  ON project_revisions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- project_revisions: staff pode ver
CREATE POLICY "staff_read_revisions"
  ON project_revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- project_revisions: company pode ver seus projetos
CREATE POLICY "company_read_revisions"
  ON project_revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN companies c ON c.id = p.company_id
      JOIN profiles pr ON pr.company_id = c.id
      WHERE p.id = project_revisions.project_id
        AND pr.id = auth.uid()
    )
  );

-- revision_general_data: admin acesso total
CREATE POLICY "admin_all_rev_general"
  ON revision_general_data FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- revision_general_data: leitura para autenticados
CREATE POLICY "read_rev_general"
  ON revision_general_data FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- revision_general_data: insert para autenticados (para criar revisões)
CREATE POLICY "insert_rev_general"
  ON revision_general_data FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- revision_equipment: admin acesso total
CREATE POLICY "admin_all_rev_equipment"
  ON revision_equipment FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- revision_equipment: leitura para autenticados
CREATE POLICY "read_rev_equipment"
  ON revision_equipment FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- revision_equipment: insert para autenticados (para criar revisões)
CREATE POLICY "insert_rev_equipment"
  ON revision_equipment FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- project_revisions: insert para autenticados (admin/staff criam revisões)
CREATE POLICY "insert_project_revisions"
  ON project_revisions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- project_revisions: update para admin/staff
CREATE POLICY "update_project_revisions"
  ON project_revisions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'staff')
    )
  );

-- ============================================================
-- 1.5 FUNÇÃO: criar primeira revisão automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION create_first_revision()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO project_revisions (
    project_id,
    revision_number,
    status,
    is_current,
    created_by
  ) VALUES (
    NEW.id,
    1,
    COALESCE(NEW.status::TEXT, 'pending'),
    true,
    NEW.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to allow idempotent migration
DROP TRIGGER IF EXISTS trigger_create_first_revision ON projects;

CREATE TRIGGER trigger_create_first_revision
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION create_first_revision();

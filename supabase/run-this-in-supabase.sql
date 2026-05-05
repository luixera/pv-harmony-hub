-- ============================================================
-- EXECUTAR ESTE SCRIPT NO SUPABASE SQL EDITOR
-- Sistema de Revisões — pv-harmony-hub
-- Data: 2026-04-01
-- ============================================================
-- Acesse: Supabase Dashboard → SQL Editor → New Query
-- Cole este conteúdo e clique em "Run"
-- ============================================================

-- 1. Adicionar 'rejected' ao enum project_status
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'rejected' AFTER 'approved';

-- Confirmar enum atualizado (opcional)
-- SELECT unnest(enum_range(NULL::project_status));

-- ============================================================
-- TABELA: project_revisions
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
-- TABELA: revision_general_data
-- ============================================================
CREATE TABLE IF NOT EXISTS revision_general_data (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  revision_id             UUID NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  holder_name             TEXT,
  holder_cpf_cnpj         TEXT,
  holder_phone            TEXT,
  holder_email            TEXT,
  address                 TEXT,
  city                    TEXT,
  state                   TEXT,
  cep                     TEXT,
  uc_number               TEXT,
  utility_company         TEXT,
  circuit_breaker_current TEXT,
  phase_type              TEXT,
  coordinates             TEXT,
  is_rural                BOOLEAN DEFAULT false,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_general_data_revision_id
  ON revision_general_data(revision_id);

-- ============================================================
-- TABELA: revision_equipment
-- ============================================================
CREATE TABLE IF NOT EXISTS revision_equipment (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  revision_id           UUID NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  inverter_brand        TEXT,
  inverter_model        TEXT,
  inverter_power        NUMERIC,
  inverter_quantity     INTEGER,
  module_brand          TEXT,
  module_model          TEXT,
  module_power          NUMERIC,
  module_quantity       INTEGER,
  total_installed_power NUMERIC,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_equipment_revision_id
  ON revision_equipment(revision_id);

-- ============================================================
-- RLS: Habilitar Row Level Security
-- ============================================================
ALTER TABLE project_revisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_general_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_equipment  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLICIES: project_revisions
-- ============================================================
DROP POLICY IF EXISTS "admin_all_revisions"      ON project_revisions;
DROP POLICY IF EXISTS "staff_read_revisions"     ON project_revisions;
DROP POLICY IF EXISTS "company_read_revisions"   ON project_revisions;
DROP POLICY IF EXISTS "insert_project_revisions" ON project_revisions;
DROP POLICY IF EXISTS "update_project_revisions" ON project_revisions;

CREATE POLICY "admin_all_revisions"
  ON project_revisions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "staff_read_revisions"
  ON project_revisions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','staff'))
  );

CREATE POLICY "company_read_revisions"
  ON project_revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      JOIN companies c  ON c.id  = p.company_id
      JOIN profiles  pr ON pr.company_id = c.id
      WHERE p.id = project_revisions.project_id
        AND pr.id = auth.uid()
    )
  );

CREATE POLICY "insert_project_revisions"
  ON project_revisions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "update_project_revisions"
  ON project_revisions FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','staff'))
  );

-- ============================================================
-- POLICIES: revision_general_data
-- ============================================================
DROP POLICY IF EXISTS "admin_all_rev_general" ON revision_general_data;
DROP POLICY IF EXISTS "read_rev_general"      ON revision_general_data;
DROP POLICY IF EXISTS "insert_rev_general"    ON revision_general_data;

CREATE POLICY "admin_all_rev_general"
  ON revision_general_data FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "read_rev_general"
  ON revision_general_data FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "insert_rev_general"
  ON revision_general_data FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- POLICIES: revision_equipment
-- ============================================================
DROP POLICY IF EXISTS "admin_all_rev_equipment" ON revision_equipment;
DROP POLICY IF EXISTS "read_rev_equipment"      ON revision_equipment;
DROP POLICY IF EXISTS "insert_rev_equipment"    ON revision_equipment;

CREATE POLICY "admin_all_rev_equipment"
  ON revision_equipment FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "read_rev_equipment"
  ON revision_equipment FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "insert_rev_equipment"
  ON revision_equipment FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- FUNÇÃO + TRIGGER: primeira revisão automática
-- ============================================================
CREATE OR REPLACE FUNCTION create_first_revision()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO project_revisions (
    project_id, revision_number, status, is_current, created_by
  ) VALUES (
    NEW.id, 1, COALESCE(NEW.status::TEXT, 'pending'), true, NEW.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_create_first_revision ON projects;

CREATE TRIGGER trigger_create_first_revision
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION create_first_revision();

-- ============================================================
-- Verificação final
-- ============================================================
SELECT 'project_revisions'    AS tabela, COUNT(*) AS total FROM project_revisions
UNION ALL
SELECT 'revision_general_data', COUNT(*) FROM revision_general_data
UNION ALL
SELECT 'revision_equipment',    COUNT(*) FROM revision_equipment;

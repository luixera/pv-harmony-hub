-- ============================================================
-- Migration: Sistema de Número de Protocolo
-- ============================================================

-- 1. Campo de protocolo na tabela projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS protocol_number TEXT DEFAULT NULL;

-- 2. Campo na tabela kanban_columns (similar ao is_rejection_stage)
ALTER TABLE kanban_columns
  ADD COLUMN IF NOT EXISTS requires_protocol BOOLEAN NOT NULL DEFAULT false;

-- 3. Histórico de protocolos (uma linha por registro)
CREATE TABLE IF NOT EXISTS project_protocols (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_number    INTEGER NOT NULL DEFAULT 1,
  protocol_number    TEXT,
  no_protocol        BOOLEAN NOT NULL DEFAULT false,
  no_protocol_reason TEXT,
  registered_by      UUID REFERENCES auth.users(id),
  registered_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Índices
CREATE INDEX IF NOT EXISTS idx_protocols_project
  ON project_protocols(project_id);

CREATE INDEX IF NOT EXISTS idx_protocols_registered_at
  ON project_protocols(registered_at DESC);

CREATE INDEX IF NOT EXISTS idx_kanban_columns_requires_protocol
  ON kanban_columns(requires_protocol)
  WHERE requires_protocol = true;

-- 5. RLS
ALTER TABLE project_protocols ENABLE ROW LEVEL SECURITY;

-- Admin e staff: acesso total
CREATE POLICY "admin_staff_protocols"
  ON project_protocols FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'staff')
    )
  );

-- Qualquer autenticado pode ler
CREATE POLICY "read_protocols"
  ON project_protocols FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 6. Verificação final
SELECT 'projects' AS tabela, column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'projects' AND column_name = 'protocol_number'
UNION ALL
SELECT 'kanban_columns', column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'kanban_columns' AND column_name = 'requires_protocol';

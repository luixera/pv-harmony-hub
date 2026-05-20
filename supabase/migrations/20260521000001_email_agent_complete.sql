-- ══════════════════════════════════════════════════════════
-- EMAIL AGENT — MIGRATION COMPLETA
-- ══════════════════════════════════════════════════════════

-- ══════════════════════════════════
-- 1. CONFIGURAÇÃO DO AGENTE
-- ══════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_config (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  config_key         TEXT        NOT NULL UNIQUE,
  gmail_email        TEXT,
  gmail_client_id    TEXT,
  gmail_client_secret TEXT,
  gmail_refresh_token TEXT,
  scan_times         TEXT[]      DEFAULT ARRAY['08:00', '17:00'],
  is_active          BOOLEAN     DEFAULT true,
  is_configured      BOOLEAN     DEFAULT false,
  configured_by      UUID        REFERENCES auth.users(id),
  configured_at      TIMESTAMPTZ,
  last_tested_at     TIMESTAMPTZ,
  last_test_success  BOOLEAN,
  last_test_error    TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO agent_config (config_key)
VALUES ('email_agent')
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;

-- Admin: acesso total (incluindo credenciais)
CREATE POLICY "admin_full_agent_config"
ON agent_config FOR ALL
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- View segura para staff (sem credenciais sensíveis)
CREATE OR REPLACE VIEW agent_config_safe AS
SELECT
  id,
  config_key,
  gmail_email,
  scan_times,
  is_active,
  is_configured,
  configured_by,
  configured_at,
  last_tested_at,
  last_test_success,
  last_test_error,
  -- Indicadores booleanos sem expor os valores
  (gmail_client_id    IS NOT NULL AND gmail_client_id    != '') AS has_client_id,
  (gmail_refresh_token IS NOT NULL AND gmail_refresh_token != '') AS has_refresh_token
FROM agent_config;

GRANT SELECT ON agent_config_safe TO authenticated;

-- ══════════════════════════════════
-- 2. HISTÓRICO DE VARREDURAS
-- ══════════════════════════════════

CREATE TABLE IF NOT EXISTS email_scan_runs (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at            TIMESTAMPTZ DEFAULT NOW(),
  finished_at           TIMESTAMPTZ,
  emails_analyzed       INTEGER     DEFAULT 0,
  projects_found        INTEGER     DEFAULT 0,
  approved_count        INTEGER     DEFAULT 0,
  rejected_count        INTEGER     DEFAULT 0,
  pending_count         INTEGER     DEFAULT 0,
  inspection_count      INTEGER     DEFAULT 0,
  attachments_processed INTEGER     DEFAULT 0,
  error_message         TEXT,
  status                TEXT        DEFAULT 'running'
  -- running | completed | error
);

ALTER TABLE email_scan_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_staff_scan_runs"
ON email_scan_runs FOR ALL
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
);

-- ══════════════════════════════════
-- 3. ATUALIZAÇÕES DE EMAIL
-- ══════════════════════════════════

CREATE TABLE IF NOT EXISTS email_updates (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Email original
  gmail_message_id          TEXT        NOT NULL UNIQUE,
  subject                   TEXT        NOT NULL,
  sender                    TEXT        NOT NULL,
  received_at               TIMESTAMPTZ NOT NULL,
  email_body                TEXT,

  -- Projeto identificado
  project_id                UUID        REFERENCES projects(id) ON DELETE SET NULL,
  protocol_number           TEXT,

  -- Análise do corpo pelo Claude
  ai_summary                TEXT,
  ai_classification         TEXT,
  -- approved | rejected | pending | inspection | informational | unknown
  ai_suggested_status       TEXT,
  ai_confidence             INTEGER     DEFAULT 0,
  ai_reasoning              TEXT,

  -- Análise consolidada dos anexos
  attachments_count         INTEGER     DEFAULT 0,
  attachments_processed     INTEGER     DEFAULT 0,
  attachments_summary       TEXT,
  attachment_classification TEXT,

  -- Controle
  status                    TEXT        NOT NULL DEFAULT 'pending',
  -- pending | applied | ignored | reviewed
  applied_by                UUID        REFERENCES auth.users(id),
  applied_at                TIMESTAMPTZ,
  scan_run_id               UUID        REFERENCES email_scan_runs(id),
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_staff_email_updates"
ON email_updates FOR ALL
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
);

CREATE INDEX IF NOT EXISTS idx_email_updates_project
  ON email_updates(project_id);
CREATE INDEX IF NOT EXISTS idx_email_updates_protocol
  ON email_updates(protocol_number);
CREATE INDEX IF NOT EXISTS idx_email_updates_status
  ON email_updates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_updates_scan_run
  ON email_updates(scan_run_id);

-- ══════════════════════════════════
-- 4. ANEXOS DE EMAIL
-- ══════════════════════════════════

CREATE TABLE IF NOT EXISTS email_attachments (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email_update_id     UUID        NOT NULL REFERENCES email_updates(id) ON DELETE CASCADE,
  filename            TEXT        NOT NULL,
  mime_type           TEXT        NOT NULL,
  size_bytes          INTEGER,
  gmail_attachment_id TEXT,
  extracted_text      TEXT,
  ai_summary          TEXT,
  ai_classification   TEXT,
  ai_confidence       INTEGER     DEFAULT 0,
  processing_status   TEXT        DEFAULT 'pending',
  -- pending | processed | failed | skipped
  processing_error    TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_staff_attachments"
ON email_attachments FOR ALL
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_email_update
  ON email_attachments(email_update_id);

-- ══════════════════════════════════
-- 5. VERIFICAÇÃO FINAL
-- ══════════════════════════════════

SELECT table_name, COUNT(*) AS columns
FROM information_schema.columns
WHERE table_name IN (
  'agent_config', 'email_scan_runs',
  'email_updates', 'email_attachments'
)
AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

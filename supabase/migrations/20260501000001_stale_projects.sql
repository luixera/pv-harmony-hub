-- ============================================================
-- Stale Projects Alert System
-- ============================================================

-- 1. Add stale_days to kanban_columns
ALTER TABLE kanban_columns
  ADD COLUMN IF NOT EXISTS stale_days INTEGER DEFAULT NULL;

COMMENT ON COLUMN kanban_columns.stale_days IS
  'Number of days without status movement before the project is considered stale. NULL = no limit for this column.';

-- 2. Add last_status_change to projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS last_status_change TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN projects.last_status_change IS
  'Timestamp of the last time the project status was changed. Updated automatically by trigger.';

-- Initialize existing projects: use created_at as baseline
UPDATE projects
SET last_status_change = COALESCE(created_at, NOW())
WHERE last_status_change IS NULL;

-- 3. Trigger function: update last_status_change when status changes
CREATE OR REPLACE FUNCTION fn_update_last_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_change := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Attach trigger to projects table
DROP TRIGGER IF EXISTS trg_update_last_status_change ON projects;

CREATE TRIGGER trg_update_last_status_change
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_last_status_change();

-- 5. View: stale_projects
--    Returns every project that has been in its current status column
--    longer than the column's stale_days threshold.
CREATE OR REPLACE VIEW stale_projects AS
SELECT
  p.id,
  p.code,
  p.status,
  p.last_status_change,
  p.company_id,
  kc.id            AS column_id,
  kc.status_label,
  kc.stale_days,
  EXTRACT(EPOCH FROM (NOW() - p.last_status_change)) / 86400.0 AS days_stale
FROM projects p
JOIN kanban_columns kc
  ON kc.status_key = p.status::text
WHERE
  kc.stale_days IS NOT NULL
  AND (p.is_deleted IS NULL OR p.is_deleted = FALSE)
  AND EXTRACT(EPOCH FROM (NOW() - p.last_status_change)) / 86400.0 >= kc.stale_days;

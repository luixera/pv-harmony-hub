-- ============================================================
-- Migration: add type to comments, observations + coordinates to project_general_data
-- ============================================================

-- Add type to comments (default 'comment', future use for 'form_observation')
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'comment';

CREATE INDEX IF NOT EXISTS idx_comments_type ON comments(type);

-- Add observations field to project_general_data (from NewProject / PublicProjectForm)
ALTER TABLE project_general_data
  ADD COLUMN IF NOT EXISTS observations TEXT;

-- coordinates already exists (added in a previous migration or schema)
-- Ensure it exists just in case:
ALTER TABLE project_general_data
  ADD COLUMN IF NOT EXISTS coordinates TEXT;

-- Corrigir FKs da tabela tasks: auth.users → profiles
-- Necessário para PostgREST conseguir fazer o join
-- creator:profiles!created_by(name, role)

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_completed_by_fkey;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_completed_by_fkey
  FOREIGN KEY (completed_by) REFERENCES profiles(id) ON DELETE SET NULL;

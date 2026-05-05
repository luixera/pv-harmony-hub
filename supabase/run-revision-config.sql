-- ============================================================
-- EXECUTAR NO SUPABASE SQL EDITOR
-- Configuração de Coluna de Reprovação no Kanban
-- ============================================================

-- 1. Adicionar campos à tabela kanban_columns
ALTER TABLE kanban_columns
  ADD COLUMN IF NOT EXISTS is_rejection_stage BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE kanban_columns
  ADD COLUMN IF NOT EXISTS triggers_revision BOOLEAN NOT NULL DEFAULT false;

-- 2. Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_kanban_columns_rejection
  ON kanban_columns(is_rejection_stage)
  WHERE is_rejection_stage = true;

-- 3. Marcar coluna 'rejected' do modelo padrão automaticamente
UPDATE kanban_columns
SET
  is_rejection_stage = true,
  triggers_revision  = true
WHERE
  status_key = 'rejected';

-- 4. Verificação
SELECT
  km.name AS modelo,
  kc.status_label AS coluna,
  kc.status_key,
  kc.is_rejection_stage,
  kc.triggers_revision
FROM kanban_columns kc
JOIN kanban_models km ON km.id = kc.kanban_model_id
WHERE kc.is_rejection_stage = true;

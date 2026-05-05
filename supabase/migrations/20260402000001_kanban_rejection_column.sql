-- ============================================================
-- Migration: Adicionar campos de reprovação às colunas do Kanban
-- ============================================================

-- is_rejection_stage: esta coluna representa projetos reprovados
--   pela concessionária (ativa o sistema de revisões)
-- triggers_revision: mover projeto para esta coluna abre o
--   fluxo de criação de nova revisão

ALTER TABLE kanban_columns
  ADD COLUMN IF NOT EXISTS is_rejection_stage BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE kanban_columns
  ADD COLUMN IF NOT EXISTS triggers_revision BOOLEAN NOT NULL DEFAULT false;

-- Índice para busca rápida da coluna de reprovação
CREATE INDEX IF NOT EXISTS idx_kanban_columns_rejection
  ON kanban_columns(is_rejection_stage)
  WHERE is_rejection_stage = true;

-- Marcar a coluna 'rejected' do modelo padrão como coluna de reprovação
UPDATE kanban_columns
SET
  is_rejection_stage = true,
  triggers_revision  = true
WHERE
  status_key = 'rejected'
  AND kanban_model_id IN (
    SELECT id FROM kanban_models WHERE name = 'Modelo Padrão'
  );

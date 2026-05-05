-- ============================================================
-- fix-status-constraint.sql
-- Adiciona os valores 'pendencia' e 'vistoria_solicitada'
-- ao enum project_status do banco Supabase.
--
-- CONTEXTO:
-- O enum project_status foi criado originalmente com apenas
-- 6 valores (pending, analysis, documentation, approval,
-- approved, completed). As colunas customizadas do Kanban
-- usam status_key = 'pendencia' e 'vistoria_solicitada',
-- que o banco rejeitava com erro 400.
--
-- ESTA MIGRATION JÁ FOI APLICADA em 2026-05-04.
-- Este arquivo serve como documentação e referência.
-- ============================================================

-- 1. Ver o estado atual do enum
SELECT e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'project_status'
ORDER BY e.enumsortorder;

-- 2. Adicionar valores ausentes (IF NOT EXISTS é idempotente)
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'pendencia';
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'vistoria_solicitada';

-- 3. Confirmar estado final do enum
SELECT e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'project_status'
ORDER BY e.enumsortorder;

-- Resultado esperado (8 valores):
-- pending
-- analysis
-- documentation
-- approval
-- approved
-- completed
-- pendencia
-- vistoria_solicitada

-- NOTA: Para adicionar novos status_key de colunas Kanban
-- no futuro, use o mesmo padrão:
-- ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'novo_status';

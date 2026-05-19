-- =============================================================================
-- 003_database_cleanup.sql
-- Limpeza e consolidação do banco — GD Manager Energy
-- Aplique em: Supabase Dashboard → SQL Editor → New query → Run
--
-- Problema: duas tabelas paralelas para financeiro de projeto:
--   • financials  → tem company_id, project_value, amount_paid (usada pelo admin)
--   • project_financials → tem project_value, paid_value, payment_status enum (usada pelo company)
--   Os valores divergem porque nenhum trigger sincroniza as duas.
--
-- Solução: adicionar company_id em project_financials (backfill do projects),
-- sincronizar os dados existentes, e criar view de compatibilidade.
-- Tabelas notifications/stage_checklists/payment_history já existem — apenas
-- garantir RLS e índices adequados.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Adicionar company_id em project_financials (campo que faltava)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_financials
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- Backfill: preenche company_id a partir da tabela projects
UPDATE project_financials pf
SET company_id = p.company_id
FROM projects p
WHERE pf.project_id = p.id
  AND pf.company_id IS NULL;

-- Índice na nova FK
CREATE INDEX IF NOT EXISTS idx_project_financials_company_id
  ON project_financials(company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sincronizar dados existentes de financials → project_financials
-- Migra registros de financials que não existem ainda em project_financials
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO project_financials (project_id, company_id, project_value, paid_value, payment_status, due_date, created_at, updated_at)
SELECT
  f.project_id,
  f.company_id,
  f.project_value,
  f.amount_paid,
  CASE f.status
    WHEN 'paid'    THEN 'paid'::payment_status
    WHEN 'partial' THEN 'partial'::payment_status
    ELSE                'pending'::payment_status
  END,
  f.due_date,
  f.created_at,
  f.updated_at
FROM financials f
WHERE NOT EXISTS (
  SELECT 1 FROM project_financials pf WHERE pf.project_id = f.project_id
)
ON CONFLICT (project_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger para manter as duas tabelas sincronizadas
-- Enquanto o código não for migrado para usar só project_financials,
-- qualquer escrita em financials se reflete em project_financials e vice-versa.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_financials_to_project_financials()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO project_financials (project_id, company_id, project_value, paid_value, payment_status, due_date, updated_at)
  VALUES (
    NEW.project_id,
    NEW.company_id,
    NEW.project_value,
    NEW.amount_paid,
    CASE NEW.status
      WHEN 'paid'    THEN 'paid'::payment_status
      WHEN 'partial' THEN 'partial'::payment_status
      ELSE                'pending'::payment_status
    END,
    NEW.due_date,
    now()
  )
  ON CONFLICT (project_id) DO UPDATE SET
    project_value  = EXCLUDED.project_value,
    paid_value     = EXCLUDED.paid_value,
    payment_status = EXCLUDED.payment_status,
    due_date       = EXCLUDED.due_date,
    updated_at     = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_financials ON financials;
CREATE TRIGGER trg_sync_financials
  AFTER INSERT OR UPDATE ON financials
  FOR EACH ROW EXECUTE FUNCTION sync_financials_to_project_financials();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Atualizar policy de company em project_financials para usar company_id direto
--    (mais eficiente que JOIN em projects)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Company can view own financials" ON project_financials;
CREATE POLICY "Company can view own financials"
  ON project_financials FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'company')
    AND company_id = get_user_company_id(auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Garantir RLS habilitado em todas as tabelas críticas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_checklists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_financials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE financials          ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_payments  ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Índice em notifications.user_id (consulta mais frequente do sino)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_project_id
  ON notifications(project_id);

CREATE INDEX IF NOT EXISTS idx_notifications_read
  ON notifications(user_id, read) WHERE read = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Índice em payment_history.project_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_history_project_id
  ON payment_history(project_id);

CREATE INDEX IF NOT EXISTS idx_payment_history_registered_by
  ON payment_history(registered_by);

COMMENT ON TABLE financials IS
  'DEPRECATED: usar project_financials. Mantida por compatibilidade — trigger sincroniza automaticamente.';
COMMENT ON TABLE project_financials IS
  'Tabela principal de financeiro por projeto. Tem company_id (adicionado em 003_database_cleanup).';

-- =============================================================================
-- 002_security_high.sql
-- Correções de segurança alta — GD Manager Energy
-- Aplique em: Supabase Dashboard → SQL Editor → New query → Run
--
-- Fecha:
--   A. comments UPDATE sem WITH CHECK → qualquer usuário pode hijack comentários de outros
--   B. project_revisions leitura aberta a qualquer autenticado (vazamento entre empresas)
--   C. revision_general_data / revision_equipment mesma falha
--   D. concessionaire_templates usa profiles.role diretamente → usar has_role()
--   E. stage_checklists usa profiles.role diretamente → usar has_role()
--   F. payment_history usa profiles.role diretamente → usar has_role()
--   G. payment_history sem policy de leitura para company
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A. comments — UPDATE sem WITH CHECK
-- Vulnerabilidade: UPDATE sem WITH CHECK permite alterar user_id do comentário,
-- "roubando" comentários de outros usuários ou injetando como outro usuário.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update own comments" ON comments;
CREATE POLICY "Users can update own comments"
  ON comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()); -- impede troca de user_id pós-update

-- ─────────────────────────────────────────────────────────────────────────────
-- B. project_revisions — leitura irrestrita para qualquer autenticado
-- Vulnerabilidade: "company_read_revisions" usa auth.uid() IS NOT NULL,
-- ou seja, qualquer usuário logado lê revisões de QUALQUER empresa.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "company_read_revisions" ON project_revisions;
DROP POLICY IF EXISTS "staff_read_revisions" ON project_revisions;
DROP POLICY IF EXISTS "admin_all_revisions" ON project_revisions;

-- Admin: acesso total
CREATE POLICY "admin_all_revisions"
  ON project_revisions FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Staff global: lê todas
CREATE POLICY "staff_global_read_revisions"
  ON project_revisions FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'staff')
    AND (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global'
  );

-- Staff restrito: lê apenas projetos atribuídos
CREATE POLICY "staff_assigned_read_revisions"
  ON project_revisions FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'staff')
    AND (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only'
    AND EXISTS (
      SELECT 1 FROM project_assignments
      WHERE project_id = project_revisions.project_id
        AND staff_user_id = auth.uid()
    )
  );

-- Company: lê apenas revisões dos próprios projetos
CREATE POLICY "company_read_own_revisions"
  ON project_revisions FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'company')
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_revisions.project_id
        AND p.company_id = get_user_company_id(auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- C. revision_general_data — leitura irrestrita (mesmo problema das revisions)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "read_rev_general" ON revision_general_data;
DROP POLICY IF EXISTS "admin_all_rev_general" ON revision_general_data;

CREATE POLICY "admin_all_rev_general"
  ON revision_general_data FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_revisions pr
      JOIN projects p ON p.id = pr.project_id
      WHERE pr.id = revision_general_data.revision_id
        AND has_role(auth.uid(), 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_revisions pr
      JOIN projects p ON p.id = pr.project_id
      WHERE pr.id = revision_general_data.revision_id
        AND has_role(auth.uid(), 'admin')
    )
  );

CREATE POLICY "staff_or_company_read_rev_general"
  ON revision_general_data FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_revisions pr
      JOIN projects p ON p.id = pr.project_id
      WHERE pr.id = revision_general_data.revision_id
        AND (
          -- Staff global
          (has_role(auth.uid(), 'staff')
           AND (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global')
          OR
          -- Staff restrito (apenas projetos atribuídos)
          (has_role(auth.uid(), 'staff')
           AND (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only'
           AND EXISTS (SELECT 1 FROM project_assignments pa
                       WHERE pa.project_id = p.id AND pa.staff_user_id = auth.uid()))
          OR
          -- Company: apenas seus próprios projetos
          (has_role(auth.uid(), 'company')
           AND p.company_id = get_user_company_id(auth.uid()))
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- C2. revision_equipment — mesmo problema
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "read_rev_equipment" ON revision_equipment;
DROP POLICY IF EXISTS "admin_all_rev_equipment" ON revision_equipment;

CREATE POLICY "admin_all_rev_equipment"
  ON revision_equipment FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_revisions pr
      WHERE pr.id = revision_equipment.revision_id
        AND has_role(auth.uid(), 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_revisions pr
      WHERE pr.id = revision_equipment.revision_id
        AND has_role(auth.uid(), 'admin')
    )
  );

CREATE POLICY "staff_or_company_read_rev_equipment"
  ON revision_equipment FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM project_revisions pr
      JOIN projects p ON p.id = pr.project_id
      WHERE pr.id = revision_equipment.revision_id
        AND (
          (has_role(auth.uid(), 'staff')
           AND (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global')
          OR
          (has_role(auth.uid(), 'staff')
           AND (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only'
           AND EXISTS (SELECT 1 FROM project_assignments pa
                       WHERE pa.project_id = p.id AND pa.staff_user_id = auth.uid()))
          OR
          (has_role(auth.uid(), 'company')
           AND p.company_id = get_user_company_id(auth.uid()))
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- D. concessionaire_templates — substituir profiles.role por has_role()
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_all_templates" ON concessionaire_templates;
DROP POLICY IF EXISTS "staff_read_templates" ON concessionaire_templates;

CREATE POLICY "admin_all_templates"
  ON concessionaire_templates FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "staff_read_templates"
  ON concessionaire_templates FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'staff'));

-- ─────────────────────────────────────────────────────────────────────────────
-- E. stage_checklists — substituir profiles.role por has_role()
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_manage_checklists" ON stage_checklists;
DROP POLICY IF EXISTS "staff_read_checklists" ON stage_checklists;

CREATE POLICY "admin_manage_checklists"
  ON stage_checklists FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "staff_read_checklists"
  ON stage_checklists FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'staff') OR has_role(auth.uid(), 'admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- F+G. payment_history — usar has_role() + adicionar acesso de company
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_all_payment_history" ON payment_history;

CREATE POLICY "admin_all_payment_history"
  ON payment_history FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "staff_read_payment_history" ON payment_history;
CREATE POLICY "staff_read_payment_history"
  ON payment_history FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'staff'));

DROP POLICY IF EXISTS "company_read_own_payment_history" ON payment_history;
CREATE POLICY "company_read_own_payment_history"
  ON payment_history FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'company')
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = payment_history.project_id
        AND p.company_id = get_user_company_id(auth.uid())
    )
  );

COMMENT ON TABLE comments IS 'Comentários de projeto. UPDATE policy com WITH CHECK impede hijack de user_id.';
COMMENT ON TABLE project_revisions IS 'Revisões de projeto. Leitura restrita à empresa proprietária do projeto.';
COMMENT ON TABLE payment_history IS 'Histórico de pagamentos. Acessível por admin (all), staff (read), company (próprios projetos).';

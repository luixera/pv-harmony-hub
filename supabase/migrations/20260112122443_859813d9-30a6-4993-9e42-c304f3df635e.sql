-- ============================================
-- CORREÇÃO DE POLÍTICAS PERMISSIVAS
-- Refinar políticas para maior segurança
-- ============================================

-- Remover políticas permissivas de project_general_data
DROP POLICY IF EXISTS "Authenticated can insert project data" ON public.project_general_data;
DROP POLICY IF EXISTS "Anonymous can insert project data" ON public.project_general_data;

-- Criar políticas mais restritivas para project_general_data
CREATE POLICY "Admin/Staff can insert project data"
  ON public.project_general_data FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can insert own project data"
  ON public.project_general_data FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Anonymous can insert project data for public form"
  ON public.project_general_data FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.source = 'public_form'
    )
  );

-- Remover políticas permissivas de project_equipment
DROP POLICY IF EXISTS "Authenticated can insert equipment" ON public.project_equipment;
DROP POLICY IF EXISTS "Anonymous can insert equipment" ON public.project_equipment;

-- Criar políticas mais restritivas para project_equipment
CREATE POLICY "Admin/Staff can insert equipment"
  ON public.project_equipment FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can insert own equipment"
  ON public.project_equipment FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Anonymous can insert equipment for public form"
  ON public.project_equipment FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.source = 'public_form'
    )
  );

-- Remover políticas permissivas de documents
DROP POLICY IF EXISTS "Authenticated can insert documents" ON public.documents;
DROP POLICY IF EXISTS "Anonymous can insert documents" ON public.documents;

-- Criar políticas mais restritivas para documents
CREATE POLICY "Admin/Staff can insert documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can insert own documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Anonymous can insert documents for public form"
  ON public.documents FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.source = 'public_form'
    )
  );

-- Remover políticas permissivas de project_history
DROP POLICY IF EXISTS "Authenticated can insert history" ON public.project_history;
DROP POLICY IF EXISTS "Anonymous can insert history" ON public.project_history;

-- Criar políticas mais restritivas para project_history
CREATE POLICY "Admin/Staff can insert history"
  ON public.project_history FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Company can insert own project history"
  ON public.project_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.company_id = public.get_user_company_id(auth.uid())
    )
  );

CREATE POLICY "Anonymous can insert history for public form"
  ON public.project_history FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = project_id 
      AND p.source = 'public_form'
    )
  );

-- Corrigir function sem search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
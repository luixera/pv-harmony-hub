-- Add soft delete columns to projects table
ALTER TABLE public.projects
ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN deleted_by UUID REFERENCES public.profiles(id),
ADD COLUMN delete_reason TEXT;

-- Create index for faster filtering of non-deleted projects
CREATE INDEX idx_projects_not_deleted ON public.projects(is_deleted) WHERE is_deleted = false;

-- Create function to soft delete a project (admin only)
CREATE OR REPLACE FUNCTION public.soft_delete_project(
  _project_id UUID,
  _reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID;
BEGIN
  -- Get current user
  _user_id := auth.uid();
  
  -- Check if user is admin
  IF NOT has_role(_user_id, 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir projetos';
  END IF;
  
  -- Check if project exists and is not already deleted
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = _project_id AND is_deleted = false) THEN
    RAISE EXCEPTION 'Projeto não encontrado ou já excluído';
  END IF;
  
  -- Perform soft delete
  UPDATE projects
  SET 
    is_deleted = true,
    deleted_at = now(),
    deleted_by = _user_id,
    delete_reason = _reason
  WHERE id = _project_id;
  
  -- Add history entry
  INSERT INTO project_history (project_id, action, description, user_id, user_name)
  SELECT 
    _project_id,
    'Projeto excluído',
    'Projeto removido do sistema. Motivo: ' || _reason,
    _user_id,
    p.name
  FROM profiles p WHERE p.id = _user_id;
  
  RETURN true;
END;
$$;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.soft_delete_project(UUID, TEXT) TO authenticated;

-- Update RLS policies for projects to filter out deleted projects

-- Drop existing policies that need to be updated
DROP POLICY IF EXISTS "Admin can view all projects" ON public.projects;
DROP POLICY IF EXISTS "Staff with global access can view all projects" ON public.projects;
DROP POLICY IF EXISTS "Staff with restricted access can view assigned projects" ON public.projects;
DROP POLICY IF EXISTS "Company users can view their own projects" ON public.projects;
DROP POLICY IF EXISTS "Anonymous can view projects by public token" ON public.projects;

-- Recreate policies with is_deleted = false filter

-- Admin can view all non-deleted projects
CREATE POLICY "Admin can view all projects" 
ON public.projects 
FOR SELECT 
USING (has_role(auth.uid(), 'admin') AND is_deleted = false);

-- Staff with global access can view all non-deleted projects
CREATE POLICY "Staff with global access can view all projects" 
ON public.projects 
FOR SELECT 
USING (
  has_role(auth.uid(), 'staff') 
  AND ((SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global')
  AND is_deleted = false
);

-- Staff with restricted access can view assigned non-deleted projects
CREATE POLICY "Staff with restricted access can view assigned projects" 
ON public.projects 
FOR SELECT 
USING (
  has_role(auth.uid(), 'staff') 
  AND ((SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only')
  AND EXISTS (
    SELECT 1 FROM project_assignments 
    WHERE project_assignments.project_id = projects.id 
    AND project_assignments.staff_user_id = auth.uid()
  )
  AND is_deleted = false
);

-- Company users can view their own non-deleted projects
CREATE POLICY "Company users can view their own projects" 
ON public.projects 
FOR SELECT 
USING (
  company_id = get_user_company_id(auth.uid())
  AND is_deleted = false
);

-- Anonymous can view non-deleted projects by public token (for public form submissions)
CREATE POLICY "Anonymous can view projects by public token" 
ON public.projects 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM companies c 
    WHERE c.id = projects.company_id 
    AND c.active = true
  )
  AND source = 'public_form'
  AND is_deleted = false
);

-- Admin can view deleted projects for audit purposes (separate policy)
CREATE POLICY "Admin can view deleted projects" 
ON public.projects 
FOR SELECT 
USING (has_role(auth.uid(), 'admin') AND is_deleted = true);
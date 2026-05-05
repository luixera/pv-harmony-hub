-- ============================================
-- STAFF ACCESS CONTROL SYSTEM
-- Adds configurable access modes for staff users
-- ============================================

-- 1. Create ENUM for staff access mode
CREATE TYPE public.staff_access_mode AS ENUM ('global', 'assigned_only');

-- 2. Add new columns to profiles table for staff access control
ALTER TABLE public.profiles
ADD COLUMN staff_access_mode public.staff_access_mode DEFAULT 'global',
ADD COLUMN hide_company_name boolean DEFAULT false;

-- 3. Create project_assignments table
CREATE TABLE public.project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, staff_user_id)
);

-- 4. Enable RLS on project_assignments
ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies for project_assignments

-- Admin has full access to project_assignments
CREATE POLICY "Admin can manage project_assignments"
ON public.project_assignments
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role))
WITH CHECK (has_role(auth.uid(), 'admin'::user_role));

-- Staff can view their own assignments
CREATE POLICY "Staff can view own assignments"
ON public.project_assignments
FOR SELECT
TO authenticated
USING (staff_user_id = auth.uid());

-- 6. Create helper function to check if staff has access to project
CREATE OR REPLACE FUNCTION public.staff_can_access_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      -- Admins always have access
      WHEN has_role(_user_id, 'admin'::user_role) THEN true
      -- Staff with global access have access to all
      WHEN has_role(_user_id, 'staff'::user_role) AND 
           (SELECT staff_access_mode FROM profiles WHERE id = _user_id) = 'global' THEN true
      -- Staff with assigned_only access need an assignment
      WHEN has_role(_user_id, 'staff'::user_role) AND 
           (SELECT staff_access_mode FROM profiles WHERE id = _user_id) = 'assigned_only' THEN
           EXISTS (SELECT 1 FROM project_assignments WHERE project_id = _project_id AND staff_user_id = _user_id)
      ELSE false
    END
$$;

-- 7. Create helper function to check if user should see company name hidden
CREATE OR REPLACE FUNCTION public.should_hide_company_name(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT hide_company_name FROM profiles WHERE id = _user_id AND has_role(_user_id, 'staff'::user_role)),
    false
  )
$$;

-- 8. Update RLS policies for projects table to support restricted staff access
-- First, drop the existing policy
DROP POLICY IF EXISTS "Admin/Staff can view all projects" ON public.projects;

-- Create separate policies for admin and staff
CREATE POLICY "Admin can view all projects"
ON public.projects
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Staff with global access can view all projects"
ON public.projects
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global'
);

CREATE POLICY "Staff with restricted access can view assigned projects"
ON public.projects
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only' AND
  EXISTS (SELECT 1 FROM project_assignments WHERE project_id = projects.id AND staff_user_id = auth.uid())
);

-- 9. Update RLS policies for project_general_data 
DROP POLICY IF EXISTS "Admin/Staff can view all project data" ON public.project_general_data;

CREATE POLICY "Admin can view all project data"
ON public.project_general_data
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Staff with global access can view all project data"
ON public.project_general_data
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global'
);

CREATE POLICY "Staff with restricted access can view assigned project data"
ON public.project_general_data
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only' AND
  EXISTS (SELECT 1 FROM project_assignments WHERE project_id = project_general_data.project_id AND staff_user_id = auth.uid())
);

-- 10. Update RLS policies for project_equipment
DROP POLICY IF EXISTS "Admin/Staff can view all equipment" ON public.project_equipment;

CREATE POLICY "Admin can view all equipment"
ON public.project_equipment
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Staff with global access can view all equipment"
ON public.project_equipment
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global'
);

CREATE POLICY "Staff with restricted access can view assigned equipment"
ON public.project_equipment
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only' AND
  EXISTS (SELECT 1 FROM project_assignments WHERE project_id = project_equipment.project_id AND staff_user_id = auth.uid())
);

-- 11. Update RLS policies for comments
DROP POLICY IF EXISTS "Admin/Staff can view all comments" ON public.comments;

CREATE POLICY "Admin can view all comments"
ON public.comments
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Staff with global access can view all comments"
ON public.comments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global'
);

CREATE POLICY "Staff with restricted access can view assigned project comments"
ON public.comments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only' AND
  EXISTS (SELECT 1 FROM project_assignments WHERE project_id = comments.project_id AND staff_user_id = auth.uid())
);

-- 12. Update RLS policies for documents
DROP POLICY IF EXISTS "Admin/Staff can view all documents" ON public.documents;

CREATE POLICY "Admin can view all documents"
ON public.documents
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Staff with global access can view all documents"
ON public.documents
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global'
);

CREATE POLICY "Staff with restricted access can view assigned documents"
ON public.documents
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only' AND
  EXISTS (SELECT 1 FROM project_assignments WHERE project_id = documents.project_id AND staff_user_id = auth.uid())
);

-- 13. Update RLS policies for project_history
DROP POLICY IF EXISTS "Admin/Staff can view all history" ON public.project_history;

CREATE POLICY "Admin can view all history"
ON public.project_history
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role));

CREATE POLICY "Staff with global access can view all history"
ON public.project_history
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'global'
);

CREATE POLICY "Staff with restricted access can view assigned history"
ON public.project_history
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'staff'::user_role) AND 
  (SELECT staff_access_mode FROM profiles WHERE id = auth.uid()) = 'assigned_only' AND
  EXISTS (SELECT 1 FROM project_assignments WHERE project_id = project_history.project_id AND staff_user_id = auth.uid())
);

-- 14. Update RLS policies for project_financials (staff cannot access financials, only admin)
DROP POLICY IF EXISTS "Admin/Staff can view all financials" ON public.project_financials;

CREATE POLICY "Admin can view all financials"
ON public.project_financials
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::user_role));

-- Staff does not have access to financials (per PRD requirement)

-- 15. Create index for better performance
CREATE INDEX idx_project_assignments_staff_user ON public.project_assignments(staff_user_id);
CREATE INDEX idx_project_assignments_project ON public.project_assignments(project_id);
CREATE INDEX idx_profiles_staff_access_mode ON public.profiles(staff_access_mode) WHERE role = 'staff';
-- FIX ERROR 4: Company users cannot insert project_financials
-- Add INSERT policy for company users to insert financials for their own projects
CREATE POLICY "Company can insert own financials"
ON public.project_financials
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_financials.project_id
    AND p.company_id = get_user_company_id(auth.uid())
  )
);
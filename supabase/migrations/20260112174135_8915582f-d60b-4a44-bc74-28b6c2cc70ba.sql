-- Fix storage policy: Company should be able to view documents of their projects
-- even when uploaded via public form (path starts with 'public/')

-- First drop the existing restrictive policy
DROP POLICY IF EXISTS "Company can view own project documents" ON storage.objects;

-- Create a better policy that checks via the documents table relationship
CREATE POLICY "Company can view own project documents" ON storage.objects
FOR SELECT USING (
  bucket_id = 'project-documents' AND (
    -- Direct company folder
    (storage.foldername(name))[1] = (get_user_company_id(auth.uid()))::text
    OR
    -- Public form uploads - check via documents table
    (
      (storage.foldername(name))[1] = 'public' 
      AND EXISTS (
        SELECT 1 FROM documents d
        JOIN projects p ON p.id = d.project_id
        WHERE d.file_url = name
        AND p.company_id = get_user_company_id(auth.uid())
      )
    )
  )
);

-- Also allow anonymous to SELECT public uploads (for immediate viewing after upload)
DROP POLICY IF EXISTS "Anonymous can view public uploads" ON storage.objects;
CREATE POLICY "Anonymous can view public uploads" ON storage.objects
FOR SELECT USING (
  bucket_id = 'project-documents' 
  AND (storage.foldername(name))[1] = 'public'
);
-- Drop the restrictive policy
DROP POLICY IF EXISTS "Admins and operators can upload documents" ON public.site_documents;

-- Allow all authenticated users to upload documents
CREATE POLICY "Authenticated users can upload documents"
ON public.site_documents
FOR INSERT
TO authenticated
WITH CHECK (true);
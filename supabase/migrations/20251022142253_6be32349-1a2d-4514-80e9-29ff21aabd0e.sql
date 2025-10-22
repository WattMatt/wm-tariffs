-- Drop the restrictive delete policy
DROP POLICY IF EXISTS "Admins can delete documents" ON public.site_documents;

-- Allow authenticated users to delete documents
CREATE POLICY "Authenticated users can delete documents"
ON public.site_documents
FOR DELETE
TO authenticated
USING (true);
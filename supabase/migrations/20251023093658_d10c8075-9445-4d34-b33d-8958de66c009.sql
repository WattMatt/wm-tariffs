-- Add UPDATE policy for document_extractions table
CREATE POLICY "Authenticated users can update extractions"
ON public.document_extractions
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
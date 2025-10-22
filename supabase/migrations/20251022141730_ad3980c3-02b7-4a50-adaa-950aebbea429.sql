-- Create site-documents bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-documents', 'site-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can upload site documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their site documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their site documents" ON storage.objects;

-- Allow authenticated users to upload site documents
CREATE POLICY "Users can upload site documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'site-documents');

-- Allow authenticated users to view site documents
CREATE POLICY "Users can view their site documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'site-documents');

-- Allow authenticated users to delete site documents
CREATE POLICY "Users can delete their site documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'site-documents');
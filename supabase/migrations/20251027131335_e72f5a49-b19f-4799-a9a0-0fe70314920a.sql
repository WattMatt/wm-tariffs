-- Create storage bucket for meter scan snippets
INSERT INTO storage.buckets (id, name, public)
VALUES ('meter-snippets', 'meter-snippets', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policy to allow anyone to read meter snippets (public bucket)
CREATE POLICY "Anyone can view meter snippets"
ON storage.objects FOR SELECT
USING (bucket_id = 'meter-snippets');

-- Create RLS policy to allow authenticated users to upload meter snippets
CREATE POLICY "Authenticated users can upload meter snippets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'meter-snippets' 
  AND auth.role() = 'authenticated'
);

-- Create RLS policy to allow authenticated users to delete meter snippets
CREATE POLICY "Authenticated users can delete meter snippets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'meter-snippets'
  AND auth.role() = 'authenticated'
);
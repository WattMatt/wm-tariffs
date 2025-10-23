-- Create storage bucket for tariff extraction images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tariff-extractions',
  'tariff-extractions',
  true,
  20971520, -- 20MB limit
  ARRAY['image/png', 'image/jpeg', 'image/webp']
);

-- RLS policies for tariff-extractions bucket
CREATE POLICY "Authenticated users can upload tariff images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tariff-extractions');

CREATE POLICY "Anyone can read tariff extraction images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'tariff-extractions');

CREATE POLICY "Users can delete their own tariff images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'tariff-extractions');
-- Create new tariff-files bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('tariff-files', 'tariff-files', true);

-- Add RLS policy for public read access
CREATE POLICY "Allow public read access on tariff-files"
ON storage.objects FOR SELECT
USING (bucket_id = 'tariff-files');

-- Add policy for authenticated users to upload
CREATE POLICY "Allow authenticated upload to tariff-files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'tariff-files');

-- Add policy for authenticated users to update
CREATE POLICY "Allow authenticated update on tariff-files"
ON storage.objects FOR UPDATE
USING (bucket_id = 'tariff-files');

-- Add policy for authenticated users to delete
CREATE POLICY "Allow authenticated delete on tariff-files"
ON storage.objects FOR DELETE
USING (bucket_id = 'tariff-files');
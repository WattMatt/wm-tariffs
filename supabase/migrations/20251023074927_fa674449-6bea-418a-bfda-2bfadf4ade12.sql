-- Make site-documents bucket public
UPDATE storage.buckets 
SET public = true 
WHERE id = 'site-documents';
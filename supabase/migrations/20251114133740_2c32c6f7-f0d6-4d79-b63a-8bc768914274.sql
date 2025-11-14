-- Delete all objects from old storage buckets before deleting the buckets
-- These buckets are being consolidated into client-files and app-assets

-- Delete all objects from old buckets
DELETE FROM storage.objects WHERE bucket_id = 'schematics';
DELETE FROM storage.objects WHERE bucket_id = 'client-logos';
DELETE FROM storage.objects WHERE bucket_id = 'meter-csvs';
DELETE FROM storage.objects WHERE bucket_id = 'site-documents';
DELETE FROM storage.objects WHERE bucket_id = 'tariff-extractions';
DELETE FROM storage.objects WHERE bucket_id = 'meter-snippets';
DELETE FROM storage.objects WHERE bucket_id = 'logos';

-- Now delete the empty buckets
DELETE FROM storage.buckets WHERE id = 'schematics';
DELETE FROM storage.buckets WHERE id = 'client-logos';
DELETE FROM storage.buckets WHERE id = 'meter-csvs';
DELETE FROM storage.buckets WHERE id = 'site-documents';
DELETE FROM storage.buckets WHERE id = 'tariff-extractions';
DELETE FROM storage.buckets WHERE id = 'meter-snippets';
DELETE FROM storage.buckets WHERE id = 'logos';
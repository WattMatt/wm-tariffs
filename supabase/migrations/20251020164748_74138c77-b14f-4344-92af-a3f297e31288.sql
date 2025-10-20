-- Add RLS policies for meter-csvs bucket to allow file deletion

-- Allow authenticated users to delete files in meter-csvs bucket
CREATE POLICY "Allow authenticated users to delete meter CSV files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'meter-csvs');

-- Allow authenticated users to view files in meter-csvs bucket
CREATE POLICY "Allow authenticated users to view meter CSV files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'meter-csvs');

-- Allow authenticated users to upload files to meter-csvs bucket
CREATE POLICY "Allow authenticated users to upload meter CSV files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'meter-csvs');
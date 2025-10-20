-- Create storage bucket for meter CSV files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('meter-csvs', 'meter-csvs', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload CSVs
CREATE POLICY "Users can upload meter CSVs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'meter-csvs');

-- Allow users to read their own uploaded CSVs
CREATE POLICY "Users can read meter CSVs"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'meter-csvs');
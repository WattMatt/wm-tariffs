-- Create logos storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('logos', 'logos', true, 2097152)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for logo uploads
CREATE POLICY "Admins can upload logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'logos' 
  AND has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Admins can update logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'logos' 
  AND has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Everyone can view logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'logos');

CREATE POLICY "Admins can delete logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'logos' 
  AND has_role(auth.uid(), 'admin'::app_role)
);
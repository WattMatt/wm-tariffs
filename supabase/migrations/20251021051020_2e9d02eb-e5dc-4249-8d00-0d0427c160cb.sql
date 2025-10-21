-- Fix RLS policy for meter_csv_files to allow authenticated users to insert their own records
DROP POLICY IF EXISTS "Admins and operators can manage csv file records" ON public.meter_csv_files;

-- Allow authenticated users to insert csv file records for any site they have access to
CREATE POLICY "Authenticated users can insert csv file records"
ON public.meter_csv_files
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update their own csv file records
CREATE POLICY "Authenticated users can update csv file records"
ON public.meter_csv_files
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete csv file records
CREATE POLICY "Authenticated users can delete csv file records"
ON public.meter_csv_files
FOR DELETE
TO authenticated
USING (true);
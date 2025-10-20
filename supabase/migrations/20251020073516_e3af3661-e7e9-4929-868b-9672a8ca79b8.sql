-- Update RLS policy to allow service role inserts for meter readings
-- This is needed for the CSV import edge function
DROP POLICY IF EXISTS "Operators and admins can upload readings" ON meter_readings;

CREATE POLICY "Operators and admins can upload readings" 
ON meter_readings 
FOR INSERT 
WITH CHECK (
  -- Allow service role (used by edge functions)
  auth.jwt()->>'role' = 'service_role'
  OR
  -- Allow operators and admins
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'operator'::app_role)
);
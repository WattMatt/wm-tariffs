-- Fix meters table RLS policy - same issue as meter_readings
DROP POLICY IF EXISTS "Authenticated users can view meters" ON meters;

CREATE POLICY "Authenticated users can view meters"
ON meters
FOR SELECT
TO authenticated
USING (true);
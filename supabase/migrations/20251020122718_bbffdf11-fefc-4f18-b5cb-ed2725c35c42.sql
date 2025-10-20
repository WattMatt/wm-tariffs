-- Drop the incorrectly configured policy
DROP POLICY IF EXISTS "Authenticated users can view readings" ON meter_readings;

-- Recreate with correct role assignment
CREATE POLICY "Authenticated users can view readings"
ON meter_readings
FOR SELECT
TO authenticated
USING (true);
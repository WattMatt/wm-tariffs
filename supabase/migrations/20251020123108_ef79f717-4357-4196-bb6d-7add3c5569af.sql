-- Temporarily add a very permissive policy to test
CREATE POLICY "Test - Allow all reads"
ON meter_readings
FOR SELECT
TO public
USING (true);
-- Allow authenticated users to insert meter connections
DROP POLICY IF EXISTS "Authenticated users can create meter connections" ON meter_connections;

CREATE POLICY "Authenticated users can create meter connections"
ON meter_connections
FOR INSERT
TO authenticated
WITH CHECK (true);
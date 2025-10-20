-- Add DELETE policy for meter_readings so admins and operators can clear data
CREATE POLICY "Admins and operators can delete readings"
ON meter_readings
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));
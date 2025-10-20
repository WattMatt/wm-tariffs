-- Add UPDATE policy for meter_readings so operators and admins can edit readings
CREATE POLICY "Admins and operators can update readings"
ON meter_readings
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'operator'::app_role)
);
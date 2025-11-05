-- Add council_meter to the meter_type check constraint
-- First, drop the existing constraint if it exists
ALTER TABLE meters DROP CONSTRAINT IF EXISTS meters_meter_type_check;

-- Add the new constraint with council_meter included
ALTER TABLE meters ADD CONSTRAINT meters_meter_type_check 
CHECK (meter_type IN ('bulk_meter', 'council_meter', 'check_meter', 'tenant_meter', 'other'));
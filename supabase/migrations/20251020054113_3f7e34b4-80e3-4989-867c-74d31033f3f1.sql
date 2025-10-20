-- Drop the old constraint
ALTER TABLE meters DROP CONSTRAINT IF EXISTS meters_meter_type_check;

-- Add the new constraint including 'solar'
ALTER TABLE meters ADD CONSTRAINT meters_meter_type_check 
CHECK (meter_type = ANY (ARRAY['council_bulk'::text, 'check_meter'::text, 'solar'::text, 'distribution'::text]));
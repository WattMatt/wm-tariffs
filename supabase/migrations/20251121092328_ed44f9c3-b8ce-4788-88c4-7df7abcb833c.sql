-- Drop existing check constraints
ALTER TABLE tariff_structures 
  DROP CONSTRAINT IF EXISTS tariff_structures_meter_configuration_check;

ALTER TABLE tariff_structures 
  DROP CONSTRAINT IF EXISTS tariff_structures_tariff_type_check;

-- Add new check constraints supporting both old and new values
ALTER TABLE tariff_structures 
  ADD CONSTRAINT tariff_structures_meter_configuration_check 
  CHECK (meter_configuration IN ('prepaid', 'conventional', 'postpaid', 'both'));

-- Support both 'residential' (old) and 'domestic' (new)
ALTER TABLE tariff_structures 
  ADD CONSTRAINT tariff_structures_tariff_type_check 
  CHECK (tariff_type IN ('domestic', 'residential', 'commercial', 'industrial', 'agricultural'));
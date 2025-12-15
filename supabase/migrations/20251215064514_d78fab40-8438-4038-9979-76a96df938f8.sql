-- Remove kwh_value and kva_value columns from meter_readings and hierarchical_meter_readings
-- All values are now stored in metadata.imported_fields

-- Step 1: Drop kwh_value and kva_value columns from meter_readings
ALTER TABLE public.meter_readings DROP COLUMN IF EXISTS kwh_value;
ALTER TABLE public.meter_readings DROP COLUMN IF EXISTS kva_value;

-- Step 2: Drop kwh_value and kva_value columns from hierarchical_meter_readings
ALTER TABLE public.hierarchical_meter_readings DROP COLUMN IF EXISTS kwh_value;
ALTER TABLE public.hierarchical_meter_readings DROP COLUMN IF EXISTS kva_value;
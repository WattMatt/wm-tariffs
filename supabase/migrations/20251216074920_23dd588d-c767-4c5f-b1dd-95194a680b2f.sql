-- Drop deprecated kwh_value and kva_value columns from meter_readings
ALTER TABLE public.meter_readings DROP COLUMN IF EXISTS kwh_value;
ALTER TABLE public.meter_readings DROP COLUMN IF EXISTS kva_value;

-- Drop deprecated kwh_value and kva_value columns from hierarchical_meter_readings
ALTER TABLE public.hierarchical_meter_readings DROP COLUMN IF EXISTS kwh_value;
ALTER TABLE public.hierarchical_meter_readings DROP COLUMN IF EXISTS kva_value;
-- Step 1: Drop the existing check constraint
ALTER TABLE public.meters DROP CONSTRAINT IF EXISTS meters_meter_type_check;

-- Step 2: Update existing meter types to match the legend types
UPDATE public.meters 
SET meter_type = 'bulk_meter'
WHERE meter_type = 'council_bulk';

UPDATE public.meters 
SET meter_type = 'submeter'
WHERE meter_type = 'distribution';

UPDATE public.meters 
SET meter_type = 'other'
WHERE meter_type = 'solar';

-- Step 3: Add new check constraint with the 4 meter types from the legend
ALTER TABLE public.meters ADD CONSTRAINT meters_meter_type_check 
  CHECK (meter_type IN ('bulk_meter', 'check_meter', 'submeter', 'other'));
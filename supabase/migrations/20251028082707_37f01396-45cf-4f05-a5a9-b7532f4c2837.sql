-- Step 1: Drop the constraint first (no validation)
ALTER TABLE public.meters DROP CONSTRAINT IF EXISTS meters_meter_type_check;

-- Step 2: Update existing records
UPDATE public.meters 
SET meter_type = 'tenant_meter'
WHERE meter_type = 'submeter';

-- Step 3: Add new constraint
ALTER TABLE public.meters ADD CONSTRAINT meters_meter_type_check 
  CHECK (meter_type IN ('bulk_meter', 'check_meter', 'tenant_meter', 'other'));
-- Step 1: Drop the old meter_configuration constraint
ALTER TABLE public.tariff_structures DROP CONSTRAINT IF EXISTS tariff_structures_meter_configuration_check;

-- Step 2: Update existing 'conventional' values to 'postpaid'
UPDATE public.tariff_structures 
SET meter_configuration = 'postpaid' 
WHERE meter_configuration = 'conventional';

-- Step 3: Add new constraint with prepaid, postpaid, both
ALTER TABLE public.tariff_structures 
ADD CONSTRAINT tariff_structures_meter_configuration_check 
CHECK (meter_configuration = ANY (ARRAY['prepaid'::text, 'postpaid'::text, 'both'::text]));
-- Step 1: Drop the old constraint first
ALTER TABLE public.tariff_structures DROP CONSTRAINT IF EXISTS tariff_structures_tariff_type_check;

-- Step 2: Update existing 'domestic' tariff types to 'residential'
UPDATE public.tariff_structures 
SET tariff_type = 'residential' 
WHERE tariff_type = 'domestic';

-- Step 3: Add new constraint matching MunicipalityExtractionDialog options
ALTER TABLE public.tariff_structures 
ADD CONSTRAINT tariff_structures_tariff_type_check 
CHECK (tariff_type = ANY (ARRAY['commercial'::text, 'residential'::text, 'industrial'::text, 'agricultural'::text]));
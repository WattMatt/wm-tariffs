-- Add meter specification fields to meters table
ALTER TABLE public.meters 
ADD COLUMN IF NOT EXISTS phase text CHECK (phase IN ('1', '3')),
ADD COLUMN IF NOT EXISTS mccb_size integer,
ADD COLUMN IF NOT EXISTS ct_ratio text,
ADD COLUMN IF NOT EXISTS supply_level text,
ADD COLUMN IF NOT EXISTS supply_description text;

-- Add comments for documentation
COMMENT ON COLUMN public.meters.phase IS 'Single phase (1) or Three phase (3)';
COMMENT ON COLUMN public.meters.mccb_size IS 'Moulded Case Circuit Breaker size in Amps';
COMMENT ON COLUMN public.meters.ct_ratio IS 'Current Transformer ratio (e.g., 2000/5, DOL for direct online)';
COMMENT ON COLUMN public.meters.supply_level IS 'Supply level (e.g., Minisub 1, MDB-1, KIOSK-1)';
COMMENT ON COLUMN public.meters.supply_description IS 'Additional description of the supply point';
-- Add new required fields to meters table
ALTER TABLE public.meters
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS area NUMERIC,
ADD COLUMN IF NOT EXISTS rating TEXT,
ADD COLUMN IF NOT EXISTS cable_specification TEXT,
ADD COLUMN IF NOT EXISTS serial_number TEXT,
ADD COLUMN IF NOT EXISTS ct_type TEXT;

-- Add comment to clarify meter_number is the NO field
COMMENT ON COLUMN public.meters.meter_number IS 'Meter identifier/number (NO field on schematic)';
COMMENT ON COLUMN public.meters.name IS 'Meter name/description (NAME field on schematic)';
COMMENT ON COLUMN public.meters.area IS 'Area served by meter in square meters';
COMMENT ON COLUMN public.meters.rating IS 'Amperage rating (e.g., 100A TP)';
COMMENT ON COLUMN public.meters.cable_specification IS 'Cable specification details';
COMMENT ON COLUMN public.meters.serial_number IS 'Meter serial number';
COMMENT ON COLUMN public.meters.ct_type IS 'Current Transformer type (e.g., DOL)';
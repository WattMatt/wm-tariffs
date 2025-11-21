-- Add assigned_tariff_name to meters table for multi-period tariff support
ALTER TABLE public.meters 
ADD COLUMN IF NOT EXISTS assigned_tariff_name TEXT;

-- Create function to get applicable tariff periods for a date range
CREATE OR REPLACE FUNCTION public.get_applicable_tariff_periods(
  p_supply_authority_id UUID,
  p_tariff_name TEXT,
  p_date_from TIMESTAMP WITH TIME ZONE,
  p_date_to TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  tariff_id UUID,
  tariff_name TEXT,
  effective_from DATE,
  effective_to DATE,
  tariff_type TEXT,
  uses_tou BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ts.id as tariff_id,
    ts.name as tariff_name,
    ts.effective_from,
    ts.effective_to,
    ts.tariff_type,
    ts.uses_tou
  FROM public.tariff_structures ts
  WHERE 
    ts.supply_authority_id = p_supply_authority_id
    AND ts.name = p_tariff_name
    AND ts.active = true
    AND (
      -- Tariff period overlaps with requested date range
      (ts.effective_from <= p_date_to::DATE)
      AND (ts.effective_to IS NULL OR ts.effective_to >= p_date_from::DATE)
    )
  ORDER BY ts.effective_from ASC;
END;
$$;

-- Populate assigned_tariff_name from existing tariff_structure_id assignments
UPDATE public.meters m
SET assigned_tariff_name = ts.name
FROM public.tariff_structures ts
WHERE m.tariff_structure_id = ts.id
  AND m.assigned_tariff_name IS NULL;
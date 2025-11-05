-- Sync existing tariff column values with tariff_structure_id
-- This fixes historical data inconsistency where tariff and tariff_structure_id don't match

UPDATE meters 
SET tariff = tariff_structure_id::text
WHERE tariff_structure_id IS NOT NULL 
  AND (tariff IS NULL OR tariff != tariff_structure_id::text);
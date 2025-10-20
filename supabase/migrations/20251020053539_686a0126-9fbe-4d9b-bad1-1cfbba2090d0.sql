-- Fix corrupted meter positions for schematic 9e84dba8-b41e-4b06-bf30-d267cbb98574
-- Scale pixel coordinates back to percentages (0-100)
-- Assuming canvas was ~1400x900 (the default from SchematicEditor)

UPDATE meter_positions
SET 
  x_position = LEAST(100, GREATEST(0, (x_position / 1400) * 100)),
  y_position = LEAST(100, GREATEST(0, (y_position / 900) * 100)),
  updated_at = NOW()
WHERE schematic_id = '9e84dba8-b41e-4b06-bf30-d267cbb98574'
  AND (x_position > 100 OR y_position > 100);

-- Show the corrected positions
SELECT 
  mp.id,
  m.meter_number,
  mp.label,
  ROUND(mp.x_position::numeric, 2) as x_percent,
  ROUND(mp.y_position::numeric, 2) as y_percent
FROM meter_positions mp
LEFT JOIN meters m ON mp.meter_id = m.id
WHERE mp.schematic_id = '9e84dba8-b41e-4b06-bf30-d267cbb98574'
ORDER BY mp.created_at;
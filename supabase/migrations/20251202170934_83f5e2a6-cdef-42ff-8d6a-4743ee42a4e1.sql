-- Move hierarchical_aggregation readings from meter_readings to hierarchical_meter_readings
INSERT INTO hierarchical_meter_readings (
  meter_id,
  reading_timestamp,
  kwh_value,
  kva_value,
  metadata,
  uploaded_by,
  created_at
)
SELECT 
  meter_id,
  reading_timestamp,
  kwh_value,
  kva_value,
  metadata,
  uploaded_by,
  created_at
FROM meter_readings
WHERE metadata->>'source' = 'hierarchical_aggregation'
ON CONFLICT DO NOTHING;

-- Delete the migrated records from meter_readings
DELETE FROM meter_readings
WHERE metadata->>'source' = 'hierarchical_aggregation';
-- Delete duplicate readings, keeping only the most recent entry (by created_at)
DELETE FROM meter_readings
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY meter_id, reading_timestamp ORDER BY created_at DESC) as rn
    FROM meter_readings
  ) sub
  WHERE rn > 1
);

-- Add unique constraint to prevent future duplicates at database level
ALTER TABLE meter_readings 
ADD CONSTRAINT meter_readings_meter_timestamp_unique 
UNIQUE (meter_id, reading_timestamp);
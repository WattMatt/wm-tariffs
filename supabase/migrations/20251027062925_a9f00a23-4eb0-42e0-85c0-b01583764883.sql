-- Add tariff_structure_id column to meters table
ALTER TABLE meters 
ADD COLUMN tariff_structure_id uuid REFERENCES tariff_structures(id);

-- Add index for better query performance
CREATE INDEX idx_meters_tariff_structure ON meters(tariff_structure_id);
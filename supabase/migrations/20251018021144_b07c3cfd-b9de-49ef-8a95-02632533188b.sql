-- Add voltage level and transmission zone fields to tariff structures
ALTER TABLE tariff_structures
ADD COLUMN voltage_level TEXT,
ADD COLUMN transmission_zone TEXT;
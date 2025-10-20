-- Add kVA value as a core field to meter_readings table
ALTER TABLE public.meter_readings 
ADD COLUMN kva_value numeric;
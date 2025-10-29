-- Drop the connection_type column from meter_connections table
ALTER TABLE public.meter_connections 
DROP COLUMN IF EXISTS connection_type;
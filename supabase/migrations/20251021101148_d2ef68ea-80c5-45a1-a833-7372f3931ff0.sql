-- Add column_mapping field to store the parsing configuration
ALTER TABLE public.meter_csv_files
ADD COLUMN column_mapping jsonb;
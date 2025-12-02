-- Add date range columns to track when hierarchical CSVs were generated for
ALTER TABLE meter_csv_files 
ADD COLUMN IF NOT EXISTS generated_date_from timestamp with time zone,
ADD COLUMN IF NOT EXISTS generated_date_to timestamp with time zone;

-- Add index for efficient date range queries on hierarchical CSVs
CREATE INDEX IF NOT EXISTS idx_meter_csv_files_generated_dates 
ON meter_csv_files(meter_id, generated_date_from, generated_date_to) 
WHERE generated_date_from IS NOT NULL;
-- Add columns to store CSV file interpretation settings
ALTER TABLE meter_csv_files 
ADD COLUMN separator text DEFAULT 'tab',
ADD COLUMN header_row_number integer DEFAULT 1;
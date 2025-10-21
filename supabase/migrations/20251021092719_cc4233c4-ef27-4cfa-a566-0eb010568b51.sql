-- Add column to track parsed CSV file path
ALTER TABLE meter_csv_files 
ADD COLUMN parsed_file_path text;
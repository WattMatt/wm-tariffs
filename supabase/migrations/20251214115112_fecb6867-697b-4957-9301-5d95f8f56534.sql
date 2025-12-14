-- Add common_area_kwh and common_area_cost columns to reconciliation_runs table
ALTER TABLE reconciliation_runs 
ADD COLUMN common_area_kwh numeric DEFAULT 0,
ADD COLUMN common_area_cost numeric DEFAULT 0;
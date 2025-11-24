-- Add demand_charges column to reconciliation_meter_results table
ALTER TABLE reconciliation_meter_results 
ADD COLUMN IF NOT EXISTS demand_charges NUMERIC DEFAULT 0;
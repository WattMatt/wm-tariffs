-- Add hierarchical_total column to reconciliation_meter_results
ALTER TABLE reconciliation_meter_results
ADD COLUMN hierarchical_total numeric DEFAULT 0;
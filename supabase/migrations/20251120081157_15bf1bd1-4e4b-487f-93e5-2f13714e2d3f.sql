-- Add meter_order column to reconciliation_runs to preserve hierarchical meter order
ALTER TABLE reconciliation_runs 
ADD COLUMN meter_order text[] DEFAULT '{}'::text[];
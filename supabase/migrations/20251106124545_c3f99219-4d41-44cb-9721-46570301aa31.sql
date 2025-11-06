-- Add meters_for_summation column to site_reconciliation_settings
ALTER TABLE site_reconciliation_settings 
ADD COLUMN meters_for_summation text[] DEFAULT '{}'::text[];
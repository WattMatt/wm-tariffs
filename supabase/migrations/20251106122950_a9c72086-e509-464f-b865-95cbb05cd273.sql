-- Add meter_order column to site_reconciliation_settings
ALTER TABLE site_reconciliation_settings 
ADD COLUMN meter_order text[] DEFAULT '{}'::text[];
-- Add additional columns to site_reconciliation_settings
ALTER TABLE public.site_reconciliation_settings 
ADD COLUMN IF NOT EXISTS selected_columns text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS column_operations jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS column_factors jsonb DEFAULT '{}';
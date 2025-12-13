-- Add columns for direct vs hierarchical data separation in reconciliation_meter_results
ALTER TABLE public.reconciliation_meter_results
ADD COLUMN IF NOT EXISTS direct_total_kwh numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS direct_readings_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS direct_column_totals jsonb,
ADD COLUMN IF NOT EXISTS direct_column_max_values jsonb,
ADD COLUMN IF NOT EXISTS hierarchical_column_totals jsonb,
ADD COLUMN IF NOT EXISTS hierarchical_column_max_values jsonb,
ADD COLUMN IF NOT EXISTS hierarchical_readings_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS direct_total_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS direct_energy_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS direct_fixed_charges numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS direct_demand_charges numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS direct_avg_cost_per_kwh numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS hierarchical_total_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS hierarchical_energy_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS hierarchical_fixed_charges numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS hierarchical_demand_charges numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS hierarchical_avg_cost_per_kwh numeric DEFAULT 0;

-- Add comments for clarity
COMMENT ON COLUMN public.reconciliation_meter_results.direct_total_kwh IS 'Total kWh from direct meter readings (from CSV)';
COMMENT ON COLUMN public.reconciliation_meter_results.hierarchical_total IS 'Total kWh from hierarchical aggregation';
COMMENT ON COLUMN public.reconciliation_meter_results.direct_column_totals IS 'Column totals from direct readings, filtered by selected columns';
COMMENT ON COLUMN public.reconciliation_meter_results.hierarchical_column_totals IS 'Column totals from hierarchical aggregation, filtered by selected columns';
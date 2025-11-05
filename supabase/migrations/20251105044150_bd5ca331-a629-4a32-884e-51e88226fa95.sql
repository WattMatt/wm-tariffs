-- Add revenue reconciliation columns to reconciliation_runs table
ALTER TABLE reconciliation_runs
ADD COLUMN IF NOT EXISTS grid_supply_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS solar_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS tenant_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_revenue NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_cost_per_kwh NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS revenue_enabled BOOLEAN DEFAULT false;

-- Add revenue reconciliation columns to reconciliation_meter_results table
ALTER TABLE reconciliation_meter_results
ADD COLUMN IF NOT EXISTS tariff_structure_id UUID REFERENCES tariff_structures(id),
ADD COLUMN IF NOT EXISTS tariff_name TEXT,
ADD COLUMN IF NOT EXISTS energy_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS fixed_charges NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_cost_per_kwh NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_calculation_error TEXT;
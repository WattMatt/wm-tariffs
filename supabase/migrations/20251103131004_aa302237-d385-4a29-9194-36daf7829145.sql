-- Create reconciliation_runs table to store reconciliation summary data
CREATE TABLE public.reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  run_name TEXT NOT NULL,
  run_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Date range parameters
  date_from TIMESTAMP WITH TIME ZONE NOT NULL,
  date_to TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Summary totals
  bulk_total NUMERIC NOT NULL DEFAULT 0,
  solar_total NUMERIC NOT NULL DEFAULT 0,
  tenant_total NUMERIC NOT NULL DEFAULT 0,
  total_supply NUMERIC NOT NULL DEFAULT 0,
  recovery_rate NUMERIC NOT NULL DEFAULT 0,
  discrepancy NUMERIC NOT NULL DEFAULT 0,
  
  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create reconciliation_meter_results table to store meter-level data
CREATE TABLE public.reconciliation_meter_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id UUID NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  
  -- Meter info snapshot (for historical accuracy)
  meter_number TEXT NOT NULL,
  meter_type TEXT NOT NULL,
  meter_name TEXT,
  location TEXT,
  
  -- Assignment
  assignment TEXT,
  
  -- Calculated values
  total_kwh NUMERIC NOT NULL DEFAULT 0,
  total_kwh_positive NUMERIC NOT NULL DEFAULT 0,
  total_kwh_negative NUMERIC NOT NULL DEFAULT 0,
  readings_count INTEGER NOT NULL DEFAULT 0,
  
  -- Column-level data (stored as JSONB)
  column_totals JSONB,
  column_max_values JSONB,
  
  -- Error tracking
  has_error BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_reconciliation_runs_site_id ON public.reconciliation_runs(site_id);
CREATE INDEX idx_reconciliation_runs_run_date ON public.reconciliation_runs(run_date DESC);
CREATE INDEX idx_reconciliation_meter_results_run_id ON public.reconciliation_meter_results(reconciliation_run_id);
CREATE INDEX idx_reconciliation_meter_results_meter_id ON public.reconciliation_meter_results(meter_id);

-- Enable Row Level Security
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_meter_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies for reconciliation_runs
CREATE POLICY "Authenticated users can view reconciliation runs"
  ON public.reconciliation_runs FOR SELECT
  USING (true);

CREATE POLICY "Admins and operators can manage reconciliation runs"
  ON public.reconciliation_runs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- RLS Policies for reconciliation_meter_results
CREATE POLICY "Authenticated users can view meter results"
  ON public.reconciliation_meter_results FOR SELECT
  USING (true);

CREATE POLICY "Admins and operators can manage meter results"
  ON public.reconciliation_meter_results FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_reconciliation_runs_updated_at
  BEFORE UPDATE ON public.reconciliation_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
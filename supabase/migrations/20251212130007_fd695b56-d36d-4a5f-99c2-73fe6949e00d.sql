-- Create bulk_reconciliation_jobs table for tracking background jobs
CREATE TABLE public.bulk_reconciliation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, complete, failed, cancelled
  total_periods INTEGER NOT NULL DEFAULT 0,
  completed_periods INTEGER NOT NULL DEFAULT 0,
  current_period TEXT,
  error_message TEXT,
  document_period_ids TEXT[] NOT NULL DEFAULT '{}',
  enable_revenue BOOLEAN NOT NULL DEFAULT true,
  meter_config JSONB,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.bulk_reconciliation_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view their jobs"
ON public.bulk_reconciliation_jobs
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create jobs"
ON public.bulk_reconciliation_jobs
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update jobs"
ON public.bulk_reconciliation_jobs
FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete jobs"
ON public.bulk_reconciliation_jobs
FOR DELETE
USING (true);

-- Enable realtime for progress tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_reconciliation_jobs;

-- Add updated_at trigger
CREATE TRIGGER update_bulk_reconciliation_jobs_updated_at
BEFORE UPDATE ON public.bulk_reconciliation_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
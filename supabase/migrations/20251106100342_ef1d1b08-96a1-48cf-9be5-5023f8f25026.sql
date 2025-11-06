-- Create table to store site reconciliation settings
CREATE TABLE IF NOT EXISTS public.site_reconciliation_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  available_columns text[] NOT NULL DEFAULT '{}',
  meter_associations jsonb NOT NULL DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(site_id)
);

-- Enable RLS
ALTER TABLE public.site_reconciliation_settings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view reconciliation settings"
  ON public.site_reconciliation_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert reconciliation settings"
  ON public.site_reconciliation_settings
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update reconciliation settings"
  ON public.site_reconciliation_settings
  FOR UPDATE
  USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_site_reconciliation_settings_updated_at
  BEFORE UPDATE ON public.site_reconciliation_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
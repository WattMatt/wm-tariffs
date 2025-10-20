-- Create table to track all meter CSV files and their status
CREATE TABLE IF NOT EXISTS public.meter_csv_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  file_size INTEGER,
  upload_status TEXT NOT NULL DEFAULT 'uploaded',
  parse_status TEXT NOT NULL DEFAULT 'pending',
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  parsed_at TIMESTAMP WITH TIME ZONE,
  uploaded_by UUID REFERENCES auth.users(id),
  readings_inserted INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  parse_errors INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add indexes for common queries
CREATE INDEX idx_meter_csv_files_site_id ON public.meter_csv_files(site_id);
CREATE INDEX idx_meter_csv_files_meter_id ON public.meter_csv_files(meter_id);
CREATE INDEX idx_meter_csv_files_content_hash ON public.meter_csv_files(content_hash);
CREATE INDEX idx_meter_csv_files_parse_status ON public.meter_csv_files(parse_status);

-- Enable RLS
ALTER TABLE public.meter_csv_files ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view csv file records"
  ON public.meter_csv_files
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and operators can manage csv file records"
  ON public.meter_csv_files
  FOR ALL
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- Trigger for updated_at
CREATE TRIGGER update_meter_csv_files_updated_at
  BEFORE UPDATE ON public.meter_csv_files
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
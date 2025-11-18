-- Create document_tariff_calculations table to store calculated costs for comparison
CREATE TABLE public.document_tariff_calculations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.site_documents(id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  tariff_structure_id UUID REFERENCES public.tariff_structures(id) ON DELETE SET NULL,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  energy_cost NUMERIC NOT NULL DEFAULT 0,
  fixed_charges NUMERIC NOT NULL DEFAULT 0,
  total_kwh NUMERIC NOT NULL DEFAULT 0,
  avg_cost_per_kwh NUMERIC DEFAULT 0,
  document_billed_amount NUMERIC,
  variance_amount NUMERIC,
  variance_percentage NUMERIC,
  tariff_name TEXT,
  calculation_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(document_id, meter_id, tariff_structure_id)
);

-- Enable Row Level Security
ALTER TABLE public.document_tariff_calculations ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view tariff calculations"
  ON public.document_tariff_calculations
  FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert tariff calculations"
  ON public.document_tariff_calculations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update tariff calculations"
  ON public.document_tariff_calculations
  FOR UPDATE
  USING (true);

CREATE POLICY "Authenticated users can delete tariff calculations"
  ON public.document_tariff_calculations
  FOR DELETE
  USING (true);

-- Create index for faster lookups
CREATE INDEX idx_document_tariff_calculations_document_id ON public.document_tariff_calculations(document_id);
CREATE INDEX idx_document_tariff_calculations_meter_id ON public.document_tariff_calculations(meter_id);

-- Create trigger for updated_at
CREATE TRIGGER update_document_tariff_calculations_updated_at
  BEFORE UPDATE ON public.document_tariff_calculations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
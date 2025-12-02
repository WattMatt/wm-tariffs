-- Create hierarchical_meter_readings table for storing copied child readings and aggregated parent readings
CREATE TABLE public.hierarchical_meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  reading_timestamp TIMESTAMPTZ NOT NULL,
  kwh_value NUMERIC NOT NULL,
  kva_value NUMERIC,
  metadata JSONB,
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique constraint to prevent duplicates per meter/timestamp
  CONSTRAINT hierarchical_meter_readings_unique UNIQUE (meter_id, reading_timestamp)
);

-- Add index for efficient querying
CREATE INDEX idx_hierarchical_readings_meter_timestamp 
  ON public.hierarchical_meter_readings(meter_id, reading_timestamp);

-- Enable RLS
ALTER TABLE public.hierarchical_meter_readings ENABLE ROW LEVEL SECURITY;

-- RLS policies matching meter_readings patterns
CREATE POLICY "Authenticated users can view hierarchical readings"
  ON public.hierarchical_meter_readings FOR SELECT TO authenticated 
  USING (true);

CREATE POLICY "Operators and admins can delete hierarchical readings"
  ON public.hierarchical_meter_readings FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Operators and admins can insert hierarchical readings"
  ON public.hierarchical_meter_readings FOR INSERT TO authenticated
  WITH CHECK (((auth.jwt() ->> 'role'::text) = 'service_role'::text) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Operators and admins can update hierarchical readings"
  ON public.hierarchical_meter_readings FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));
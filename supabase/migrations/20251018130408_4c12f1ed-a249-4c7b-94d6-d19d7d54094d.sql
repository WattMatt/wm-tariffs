-- Create meter_connections table to track meter hierarchy
CREATE TABLE IF NOT EXISTS public.meter_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  parent_meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('submeter', 'check_meter', 'bulk_supply')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(child_meter_id, parent_meter_id)
);

-- Enable RLS
ALTER TABLE public.meter_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view meter connections"
  ON public.meter_connections
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins and operators can manage meter connections"
  ON public.meter_connections
  FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- Add trigger for updated_at
CREATE TRIGGER update_meter_connections_updated_at
  BEFORE UPDATE ON public.meter_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for performance
CREATE INDEX idx_meter_connections_child ON public.meter_connections(child_meter_id);
CREATE INDEX idx_meter_connections_parent ON public.meter_connections(parent_meter_id);

-- Add schematic_lines table for drawing connection lines on schematics
CREATE TABLE IF NOT EXISTS public.schematic_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schematic_id UUID NOT NULL REFERENCES public.schematics(id) ON DELETE CASCADE,
  from_x NUMERIC NOT NULL,
  from_y NUMERIC NOT NULL,
  to_x NUMERIC NOT NULL,
  to_y NUMERIC NOT NULL,
  line_type TEXT DEFAULT 'connection',
  color TEXT DEFAULT '#000000',
  stroke_width NUMERIC DEFAULT 2,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.schematic_lines ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view schematic lines"
  ON public.schematic_lines
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins and operators can manage schematic lines"
  ON public.schematic_lines
  FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'operator'::app_role)
  );

-- Add trigger for updated_at
CREATE TRIGGER update_schematic_lines_updated_at
  BEFORE UPDATE ON public.schematic_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- Create storage bucket for schematics
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'schematics',
  'schematics',
  true,
  52428800, -- 50MB limit
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml']
);

-- RLS policies for schematics bucket
CREATE POLICY "Authenticated users can view schematics"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'schematics' AND auth.role() = 'authenticated');

CREATE POLICY "Admins and operators can upload schematics"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'schematics' AND 
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
  );

CREATE POLICY "Admins and operators can update schematics"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'schematics' AND 
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
  );

CREATE POLICY "Admins can delete schematics"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'schematics' AND public.has_role(auth.uid(), 'admin'));

-- Create schematics table for metadata
CREATE TABLE public.schematics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES public.sites(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  page_number INTEGER DEFAULT 1,
  total_pages INTEGER DEFAULT 1,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create meter positions table for mapping meters to schematic locations
CREATE TABLE public.meter_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schematic_id UUID REFERENCES public.schematics(id) ON DELETE CASCADE NOT NULL,
  meter_id UUID REFERENCES public.meters(id) ON DELETE CASCADE NOT NULL,
  x_position DECIMAL(10, 6) NOT NULL, -- percentage position 0-100
  y_position DECIMAL(10, 6) NOT NULL, -- percentage position 0-100
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(schematic_id, meter_id)
);

-- Enable RLS
ALTER TABLE public.schematics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_positions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for schematics
CREATE POLICY "Authenticated users can view schematics"
  ON public.schematics FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins and operators can manage schematics"
  ON public.schematics FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- RLS Policies for meter_positions
CREATE POLICY "Authenticated users can view meter positions"
  ON public.meter_positions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins and operators can manage meter positions"
  ON public.meter_positions FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- Triggers for updated_at
CREATE TRIGGER update_schematics_updated_at
  BEFORE UPDATE ON public.schematics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_meter_positions_updated_at
  BEFORE UPDATE ON public.meter_positions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- Create supply authorities (municipalities) table
CREATE TABLE public.supply_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  region TEXT,
  nersa_increase_percentage DECIMAL(5, 2),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tariff structures table
CREATE TABLE public.tariff_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_authority_id UUID REFERENCES public.supply_authorities(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  tariff_type TEXT NOT NULL CHECK (tariff_type IN ('domestic', 'commercial', 'industrial', 'agricultural')),
  meter_configuration TEXT CHECK (meter_configuration IN ('prepaid', 'conventional', 'both')),
  description TEXT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(supply_authority_id, name, effective_from)
);

-- Create tariff blocks table (for tiered pricing)
CREATE TABLE public.tariff_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_structure_id UUID REFERENCES public.tariff_structures(id) ON DELETE CASCADE NOT NULL,
  block_number INTEGER NOT NULL,
  kwh_from DECIMAL(10, 2) NOT NULL,
  kwh_to DECIMAL(10, 2),
  energy_charge_cents DECIMAL(10, 4) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tariff_structure_id, block_number)
);

-- Create tariff charges table (fixed charges)
CREATE TABLE public.tariff_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_structure_id UUID REFERENCES public.tariff_structures(id) ON DELETE CASCADE NOT NULL,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('basic_monthly', 'demand_kva', 'amp_charge', 'service_charge')),
  charge_amount DECIMAL(10, 2) NOT NULL,
  unit TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tariff_structure_id, charge_type)
);

-- Add supply authority to sites
ALTER TABLE public.sites
ADD COLUMN supply_authority_id UUID REFERENCES public.supply_authorities(id),
ADD COLUMN tariff_structure_id UUID REFERENCES public.tariff_structures(id);

-- Enable RLS
ALTER TABLE public.supply_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tariff_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tariff_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tariff_charges ENABLE ROW LEVEL SECURITY;

-- RLS Policies for supply_authorities
CREATE POLICY "Authenticated users can view supply authorities"
  ON public.supply_authorities FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage supply authorities"
  ON public.supply_authorities FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for tariff_structures
CREATE POLICY "Authenticated users can view tariff structures"
  ON public.tariff_structures FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage tariff structures"
  ON public.tariff_structures FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for tariff_blocks
CREATE POLICY "Authenticated users can view tariff blocks"
  ON public.tariff_blocks FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage tariff blocks"
  ON public.tariff_blocks FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for tariff_charges
CREATE POLICY "Authenticated users can view tariff charges"
  ON public.tariff_charges FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage tariff charges"
  ON public.tariff_charges FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Triggers for updated_at
CREATE TRIGGER update_supply_authorities_updated_at
  BEFORE UPDATE ON public.supply_authorities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tariff_structures_updated_at
  BEFORE UPDATE ON public.tariff_structures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
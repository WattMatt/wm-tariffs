-- Add TOU support to tariff structures
ALTER TABLE tariff_structures
ADD COLUMN uses_tou BOOLEAN DEFAULT false,
ADD COLUMN tou_type TEXT; -- 'nightsave' or 'megaflex'

-- Create time-of-use periods table
CREATE TABLE tariff_time_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_structure_id UUID NOT NULL REFERENCES tariff_structures(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL, -- 'peak', 'standard', 'off_peak'
  season TEXT NOT NULL, -- 'high_demand', 'low_demand', 'all_year'
  day_type TEXT NOT NULL, -- 'weekday', 'saturday', 'sunday', 'weekend', 'all_days'
  start_hour INTEGER NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
  end_hour INTEGER NOT NULL CHECK (end_hour >= 0 AND end_hour <= 23),
  energy_charge_cents NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on tariff_time_periods
ALTER TABLE tariff_time_periods ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tariff_time_periods
CREATE POLICY "Authenticated users can view TOU periods"
  ON tariff_time_periods FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage TOU periods"
  ON tariff_time_periods FOR ALL
  USING (has_role(auth.uid(), 'admin'));
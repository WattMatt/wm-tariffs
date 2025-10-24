-- Update the tariff_charges table check constraint to include the charge types used in extraction
ALTER TABLE public.tariff_charges DROP CONSTRAINT IF EXISTS tariff_charges_charge_type_check;

ALTER TABLE public.tariff_charges 
ADD CONSTRAINT tariff_charges_charge_type_check 
CHECK (charge_type = ANY (ARRAY[
  'basic_monthly'::text,
  'basic_charge'::text,
  'demand_kva'::text,
  'demand_charge'::text,
  'access_charge'::text,
  'capacity_charge'::text,
  'amp_charge'::text,
  'service_charge'::text,
  'network_charge'::text,
  'fixed_charge'::text,
  'seasonal_energy'::text,
  'energy_charge'::text
]));
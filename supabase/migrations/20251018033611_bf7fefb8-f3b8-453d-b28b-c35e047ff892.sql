-- Add more charge types to the tariff_charges constraint
ALTER TABLE public.tariff_charges 
DROP CONSTRAINT IF EXISTS tariff_charges_charge_type_check;

ALTER TABLE public.tariff_charges 
ADD CONSTRAINT tariff_charges_charge_type_check 
CHECK (charge_type IN (
  'basic_monthly',
  'demand_kva',
  'access_charge',
  'capacity_charge',
  'amp_charge',
  'service_charge',
  'network_charge',
  'fixed_charge'
));
-- Update constraint to match ONLY the charge types used by MunicipalityExtractionDialog
-- The dialog creates: basic_monthly, energy_* and demand_* with season suffixes
ALTER TABLE public.tariff_charges DROP CONSTRAINT IF EXISTS tariff_charges_charge_type_check;

-- Remove the constraint entirely to allow any charge_type value
-- This supports dynamic season names like energy_low_season, energy_high_season, etc.
-- The application logic controls what gets inserted
-- Add demand_charges column to document_tariff_calculations table
ALTER TABLE document_tariff_calculations 
ADD COLUMN demand_charges numeric DEFAULT 0;
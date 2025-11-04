-- Add generation_parameters column to site_documents for storing report generation settings
ALTER TABLE public.site_documents 
ADD COLUMN IF NOT EXISTS generation_parameters JSONB;

COMMENT ON COLUMN public.site_documents.generation_parameters IS 'Stores report generation parameters for regeneration: selected meters, schematic, folder, reconciliation, CSV columns, etc.';
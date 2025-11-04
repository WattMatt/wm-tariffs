-- Add meter_id column to site_documents table for document-meter assignments
ALTER TABLE public.site_documents 
ADD COLUMN meter_id uuid REFERENCES public.meters(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX idx_site_documents_meter_id ON public.site_documents(meter_id);

-- Add comment for documentation
COMMENT ON COLUMN public.site_documents.meter_id IS 'Optional reference to the meter this document is associated with';
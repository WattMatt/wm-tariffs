-- Add converted_image_path column to site_documents table
ALTER TABLE public.site_documents 
ADD COLUMN IF NOT EXISTS converted_image_path text;

COMMENT ON COLUMN public.site_documents.converted_image_path IS 'Path to the converted image (for PDFs converted to PNG for AI extraction)';
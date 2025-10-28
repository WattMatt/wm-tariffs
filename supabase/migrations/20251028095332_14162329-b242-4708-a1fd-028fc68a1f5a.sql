-- Add scanned_snippet_url column to meters table to store cropped meter images
ALTER TABLE public.meters 
ADD COLUMN scanned_snippet_url text;

COMMENT ON COLUMN public.meters.scanned_snippet_url IS 'URL to the cropped/scanned snippet image used during meter extraction';
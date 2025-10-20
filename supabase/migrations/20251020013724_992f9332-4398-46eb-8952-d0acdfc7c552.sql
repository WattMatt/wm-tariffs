-- Add column to track converted image path for PDFs
ALTER TABLE public.schematics
ADD COLUMN converted_image_path text;

-- Add comment explaining the column
COMMENT ON COLUMN public.schematics.converted_image_path IS 'Path to the converted PNG image for PDF schematics';
-- Add zone column to meters table
ALTER TABLE public.meters 
ADD COLUMN zone text;

-- Add a comment to describe the column
COMMENT ON COLUMN public.meters.zone IS 'Physical zone or area where the meter is located (e.g., Main Board, Mini Sub)';
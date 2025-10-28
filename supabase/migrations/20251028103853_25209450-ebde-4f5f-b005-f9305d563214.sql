-- Add confirmation_status column to meters table
ALTER TABLE public.meters 
ADD COLUMN IF NOT EXISTS confirmation_status text 
DEFAULT 'unconfirmed' 
CHECK (confirmation_status IN ('unconfirmed', 'needs_review', 'confirmed'));
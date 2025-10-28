-- Update all meters with 'needs_review' status to 'unconfirmed'
UPDATE public.meters 
SET confirmation_status = 'unconfirmed' 
WHERE confirmation_status = 'needs_review';

-- Drop the old constraint
ALTER TABLE public.meters 
DROP CONSTRAINT IF EXISTS meters_confirmation_status_check;

-- Add new constraint without 'needs_review'
ALTER TABLE public.meters 
ADD CONSTRAINT meters_confirmation_status_check 
CHECK (confirmation_status IN ('unconfirmed', 'confirmed'));
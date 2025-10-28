-- Backfill existing meters with default confirmation_status
UPDATE public.meters 
SET confirmation_status = 'unconfirmed' 
WHERE confirmation_status IS NULL;
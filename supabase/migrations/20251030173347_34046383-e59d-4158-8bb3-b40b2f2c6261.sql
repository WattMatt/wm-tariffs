-- Create function to delete meter readings by meter IDs with extended timeouts
CREATE OR REPLACE FUNCTION public.delete_meter_readings_by_ids(p_meter_ids uuid[])
RETURNS TABLE(total_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10min'
SET lock_timeout TO '5min'
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  -- Delete all readings for the given meter IDs in one operation
  DELETE FROM public.meter_readings
  WHERE meter_id = ANY(p_meter_ids);
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RETURN QUERY SELECT v_deleted;
END;
$$;
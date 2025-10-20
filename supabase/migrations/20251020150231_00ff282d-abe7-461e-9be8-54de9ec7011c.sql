-- Fix deletion function - can't use COMMIT in functions
CREATE OR REPLACE FUNCTION delete_site_readings(p_site_id uuid)
RETURNS TABLE (total_deleted bigint) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
SET lock_timeout = '5min'
AS $$
DECLARE
  v_deleted bigint;
  v_meter_ids uuid[];
BEGIN
  -- Get all meter IDs for this site
  SELECT array_agg(id) INTO v_meter_ids
  FROM public.meters 
  WHERE site_id = p_site_id;
  
  IF v_meter_ids IS NULL OR array_length(v_meter_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0::bigint;
    RETURN;
  END IF;
  
  -- Delete all readings in one go with extended timeouts
  DELETE FROM public.meter_readings
  WHERE meter_id = ANY(v_meter_ids);
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RETURN QUERY SELECT v_deleted;
END;
$$;
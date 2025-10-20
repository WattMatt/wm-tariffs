-- Create improved deletion function that handles locks better
CREATE OR REPLACE FUNCTION delete_site_readings(p_site_id uuid)
RETURNS TABLE (total_deleted bigint) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10min'
SET lock_timeout = '5min'
AS $$
DECLARE
  v_deleted bigint := 0;
  v_batch_size integer := 10000;
  v_batch_deleted integer;
  v_meter_ids uuid[];
BEGIN
  -- Get all meter IDs for this site
  SELECT array_agg(id) INTO v_meter_ids
  FROM public.meters 
  WHERE site_id = p_site_id;
  
  IF v_meter_ids IS NULL THEN
    RETURN QUERY SELECT 0::bigint;
    RETURN;
  END IF;
  
  -- Delete in batches to avoid long locks
  LOOP
    DELETE FROM public.meter_readings
    WHERE ctid IN (
      SELECT ctid 
      FROM public.meter_readings
      WHERE meter_id = ANY(v_meter_ids)
      LIMIT v_batch_size
    );
    
    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    v_deleted := v_deleted + v_batch_deleted;
    
    -- Exit when no more rows to delete
    EXIT WHEN v_batch_deleted = 0;
    
    -- Small commit point to release locks
    COMMIT;
  END LOOP;
  
  RETURN QUERY SELECT v_deleted;
END;
$$;
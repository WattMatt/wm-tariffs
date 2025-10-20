-- Create function to efficiently delete all readings for a site
CREATE OR REPLACE FUNCTION delete_site_readings(p_site_id uuid)
RETURNS TABLE (total_deleted bigint) 
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5min'
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  -- Delete all readings for meters in this site
  DELETE FROM meter_readings
  WHERE meter_id IN (
    SELECT id FROM meters WHERE site_id = p_site_id
  );
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RETURN QUERY SELECT v_deleted;
END;
$$;
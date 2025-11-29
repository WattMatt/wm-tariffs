-- Create a function to update readings source in batches
CREATE OR REPLACE FUNCTION public.migrate_readings_source_batch(batch_limit integer DEFAULT 10000)
RETURNS TABLE(updated_count bigint, remaining_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5min'
AS $$
DECLARE
  v_updated bigint;
  v_remaining bigint;
BEGIN
  -- Update batch of readings using a single UPDATE statement
  WITH to_update AS (
    SELECT id, metadata
    FROM meter_readings
    WHERE metadata->>'source' IS NULL
      AND metadata->>'source_file' IS NOT NULL
    LIMIT batch_limit
  )
  UPDATE meter_readings mr
  SET metadata = jsonb_set(
    COALESCE(mr.metadata, '{}'::jsonb),
    '{source}',
    '"Parsed"'
  )
  FROM to_update
  WHERE mr.id = to_update.id;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  -- Get remaining count
  SELECT COUNT(*) INTO v_remaining
  FROM meter_readings
  WHERE metadata->>'source' IS NULL
    AND metadata->>'source_file' IS NOT NULL;
  
  RETURN QUERY SELECT v_updated, v_remaining;
END;
$$;
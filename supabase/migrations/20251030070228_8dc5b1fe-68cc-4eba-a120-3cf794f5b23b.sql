-- Update delete_schematic_meters to also remove schematic lines
DROP FUNCTION IF EXISTS public.delete_schematic_meters(uuid);

CREATE OR REPLACE FUNCTION public.delete_schematic_meters(schematic_uuid uuid)
RETURNS TABLE(deleted_lines bigint, deleted_connections bigint, deleted_positions bigint, deleted_meters bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted_lines BIGINT;
  v_deleted_connections BIGINT;
  v_deleted_positions BIGINT;
  v_deleted_meters BIGINT;
BEGIN
  -- Delete schematic lines for this schematic
  DELETE FROM schematic_lines
  WHERE schematic_id = schematic_uuid;
  
  GET DIAGNOSTICS v_deleted_lines = ROW_COUNT;

  -- Delete meter connections where either parent or child is in this schematic
  WITH meter_ids AS (
    SELECT m.id
    FROM meters m
    JOIN meter_positions mp ON m.id = mp.meter_id
    WHERE mp.schematic_id = schematic_uuid
  )
  DELETE FROM meter_connections
  WHERE parent_meter_id IN (SELECT id FROM meter_ids)
     OR child_meter_id IN (SELECT id FROM meter_ids);
  
  GET DIAGNOSTICS v_deleted_connections = ROW_COUNT;

  -- Delete meter positions for this schematic
  DELETE FROM meter_positions
  WHERE schematic_id = schematic_uuid;
  
  GET DIAGNOSTICS v_deleted_positions = ROW_COUNT;

  -- Delete meters that were in this schematic ONLY if they have no other positions
  WITH meter_ids AS (
    SELECT m.id
    FROM meters m
    WHERE m.id IN (
      SELECT meter_id FROM meter_positions WHERE schematic_id = schematic_uuid
    )
    AND NOT EXISTS (
      SELECT 1 FROM meter_positions mp2 
      WHERE mp2.meter_id = m.id 
      AND mp2.schematic_id != schematic_uuid
    )
  )
  DELETE FROM meters
  WHERE id IN (SELECT id FROM meter_ids);
  
  GET DIAGNOSTICS v_deleted_meters = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_lines, v_deleted_connections, v_deleted_positions, v_deleted_meters;
END;
$$;
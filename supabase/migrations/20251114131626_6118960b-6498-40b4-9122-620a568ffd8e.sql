-- Create client-files bucket (all client/site data)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('client-files', 'client-files', true);

-- Create app-assets bucket (global app assets)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('app-assets', 'app-assets', true);

-- Add RLS policies for client-files
CREATE POLICY "Authenticated users can upload to client-files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'client-files');

CREATE POLICY "Authenticated users can update client-files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'client-files');

CREATE POLICY "Authenticated users can delete from client-files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'client-files');

CREATE POLICY "Everyone can read client-files"
ON storage.objects FOR SELECT
USING (bucket_id = 'client-files');

-- Add RLS policies for app-assets
CREATE POLICY "Admins can manage app-assets"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'app-assets' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Everyone can read app-assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'app-assets');

-- Update delete_schematic_meters function to use client-files bucket
CREATE OR REPLACE FUNCTION public.delete_schematic_meters(schematic_uuid uuid)
RETURNS TABLE(deleted_snippets bigint, deleted_lines bigint, deleted_connections bigint, deleted_positions bigint, deleted_meters bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'storage'
AS $function$
DECLARE
  v_deleted_snippets BIGINT := 0;
  v_deleted_lines BIGINT;
  v_deleted_connections BIGINT;
  v_deleted_positions BIGINT;
  v_deleted_meters BIGINT;
  v_snippet_url TEXT;
  v_snippet_path TEXT;
BEGIN
  -- Delete meter snippet images from storage (now in client-files bucket)
  FOR v_snippet_url IN 
    SELECT m.scanned_snippet_url
    FROM meters m
    JOIN meter_positions mp ON m.id = mp.meter_id
    WHERE mp.schematic_id = schematic_uuid
      AND m.scanned_snippet_url IS NOT NULL
      AND m.scanned_snippet_url != ''
  LOOP
    -- Extract the path from the full URL
    -- URL format: https://.../storage/v1/object/public/client-files/{path}
    v_snippet_path := regexp_replace(v_snippet_url, '^.*/client-files/', '');
    
    -- Delete from storage (updated to client-files bucket)
    DELETE FROM storage.objects
    WHERE bucket_id = 'client-files'
      AND name = v_snippet_path;
    
    IF FOUND THEN
      v_deleted_snippets := v_deleted_snippets + 1;
    END IF;
  END LOOP;

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

  RETURN QUERY SELECT v_deleted_snippets, v_deleted_lines, v_deleted_connections, v_deleted_positions, v_deleted_meters;
END;
$function$;
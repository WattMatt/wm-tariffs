-- Create function to delete storage folder contents directly
CREATE OR REPLACE FUNCTION public.delete_storage_folder(
  p_bucket_id TEXT,
  p_folder_path TEXT
)
RETURNS TABLE(deleted_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  -- Delete all objects in the specified folder path
  DELETE FROM storage.objects
  WHERE bucket_id = p_bucket_id
    AND name LIKE p_folder_path || '%';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  
  RETURN QUERY SELECT v_deleted;
END;
$$;
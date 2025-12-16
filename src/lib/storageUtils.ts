/**
 * Shared Supabase storage utilities for file operations
 * Used across schematic, document, and other components
 */

import { supabase } from '@/integrations/supabase/client';

// Default bucket for client files
export const DEFAULT_BUCKET = 'client-files';

export interface UploadOptions {
  bucket?: string;
  contentType?: string;
  upsert?: boolean;
}

export interface UploadResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  data?: Blob;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

/**
 * Upload a file to Supabase storage
 */
export async function uploadFile(
  path: string,
  file: File | Blob,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const { bucket = DEFAULT_BUCKET, contentType, upsert = false } = options;
  
  try {
    const uploadOptions: { contentType?: string; upsert?: boolean } = { upsert };
    if (contentType) {
      uploadOptions.contentType = contentType;
    }

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, uploadOptions);

    if (error) {
      console.error(`Failed to upload file to ${path}:`, error);
      return { success: false, error: error.message };
    }

    return { success: true, path: data.path };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error uploading file to ${path}:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Download a file from Supabase storage
 */
export async function downloadFile(
  path: string,
  bucket: string = DEFAULT_BUCKET
): Promise<DownloadResult> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error) {
      console.error(`Failed to download file from ${path}:`, error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error downloading file from ${path}:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Download a file and trigger browser download
 */
export async function downloadAndSaveFile(
  path: string,
  fileName: string,
  bucket: string = DEFAULT_BUCKET
): Promise<boolean> {
  const result = await downloadFile(path, bucket);
  
  if (!result.success || !result.data) {
    return false;
  }

  const url = URL.createObjectURL(result.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  
  return true;
}

/**
 * Delete one or more files from Supabase storage
 */
export async function deleteFiles(
  paths: string[],
  bucket: string = DEFAULT_BUCKET
): Promise<DeleteResult> {
  if (paths.length === 0) {
    return { success: true };
  }

  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove(paths);

    if (error) {
      console.error(`Failed to delete files:`, error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error deleting files:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Delete a single file from Supabase storage
 */
export async function deleteFile(
  path: string,
  bucket: string = DEFAULT_BUCKET
): Promise<DeleteResult> {
  return deleteFiles([path], bucket);
}

/**
 * Get public URL for a file
 */
export function getPublicUrl(
  path: string,
  bucket: string = DEFAULT_BUCKET
): string {
  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
}

/**
 * Get signed URL for temporary access to a file
 */
export async function getSignedUrl(
  path: string,
  expiresIn: number = 3600,
  bucket: string = DEFAULT_BUCKET
): Promise<{ url: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      console.error(`Failed to create signed URL for ${path}:`, error);
      return { url: null, error: error.message };
    }

    return { url: data.signedUrl, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error creating signed URL for ${path}:`, error);
    return { url: null, error: errorMessage };
  }
}

/**
 * Move a file from one path to another (copy + delete)
 */
export async function moveFile(
  sourcePath: string,
  destinationPath: string,
  bucket: string = DEFAULT_BUCKET
): Promise<UploadResult> {
  // Download from source
  const downloadResult = await downloadFile(sourcePath, bucket);
  if (!downloadResult.success || !downloadResult.data) {
    return { success: false, error: downloadResult.error || 'Failed to download source file' };
  }

  // Upload to destination
  const uploadResult = await uploadFile(destinationPath, downloadResult.data, { bucket });
  if (!uploadResult.success) {
    return uploadResult;
  }

  // Delete source
  const deleteResult = await deleteFile(sourcePath, bucket);
  if (!deleteResult.success) {
    console.warn(`File moved but failed to delete source: ${deleteResult.error}`);
  }

  return { success: true, path: destinationPath };
}

/**
 * Copy a file from one path to another
 */
export async function copyFile(
  sourcePath: string,
  destinationPath: string,
  bucket: string = DEFAULT_BUCKET
): Promise<UploadResult> {
  // Download from source
  const downloadResult = await downloadFile(sourcePath, bucket);
  if (!downloadResult.success || !downloadResult.data) {
    return { success: false, error: downloadResult.error || 'Failed to download source file' };
  }

  // Upload to destination
  return uploadFile(destinationPath, downloadResult.data, { bucket });
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(
  path: string,
  bucket: string = DEFAULT_BUCKET
): Promise<boolean> {
  try {
    // Try to get file metadata by listing with exact path
    const folderPath = path.substring(0, path.lastIndexOf('/'));
    const fileName = path.substring(path.lastIndexOf('/') + 1);
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folderPath, { search: fileName });

    if (error) {
      return false;
    }

    return data?.some(file => file.name === fileName) ?? false;
  } catch {
    return false;
  }
}

/**
 * Convert a data URL to a Blob
 */
export function dataURLtoBlob(dataURL: string): Blob {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

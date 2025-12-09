/**
 * Chart storage utilities for uploading chart images
 */

import { supabase } from '@/integrations/supabase/client';
import { dataURLtoBlob } from './canvasRenderer';
import type { StoragePath } from './types';

export interface UploadResult {
  success: boolean;
  error?: string;
  path?: string;
}

export interface BatchUploadResult {
  totalAttempted: number;
  successful: number;
  failed: number;
  results: UploadResult[];
}

/**
 * Upload a single chart image to Supabase storage
 */
export async function uploadChartImage(
  storagePath: StoragePath,
  dataUrl: string
): Promise<UploadResult> {
  try {
    const blob = dataURLtoBlob(dataUrl);

    const { error } = await supabase.storage
      .from(storagePath.bucket)
      .upload(storagePath.path, blob, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) {
      console.error(`Failed to upload chart to ${storagePath.path}:`, error);
      return { success: false, error: error.message };
    }

    return { success: true, path: storagePath.path };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error uploading chart to ${storagePath.path}:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Upload multiple chart images in parallel
 */
export async function uploadChartBatch(
  charts: Array<{ storagePath: StoragePath; dataUrl: string }>
): Promise<BatchUploadResult> {
  const results = await Promise.all(
    charts.map(({ storagePath, dataUrl }) => uploadChartImage(storagePath, dataUrl))
  );

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    totalAttempted: charts.length,
    successful,
    failed,
    results,
  };
}

/**
 * Delete a chart image from storage
 */
export async function deleteChartImage(storagePath: StoragePath): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(storagePath.bucket)
      .remove([storagePath.path]);

    if (error) {
      console.error(`Failed to delete chart at ${storagePath.path}:`, error);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error deleting chart at ${storagePath.path}:`, error);
    return false;
  }
}

/**
 * Get public URL for a chart image
 */
export function getChartPublicUrl(storagePath: StoragePath): string {
  const { data } = supabase.storage
    .from(storagePath.bucket)
    .getPublicUrl(storagePath.path);

  return data.publicUrl;
}

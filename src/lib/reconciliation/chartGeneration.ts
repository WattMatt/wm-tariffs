import { supabase } from '@/integrations/supabase/client';
import { generateStoragePath } from '@/lib/storagePaths';

// Chart metrics configuration
export const CHART_METRICS = [
  { key: 'total', title: 'Total Amount', unit: 'R', filename: 'total' },
  { key: 'basic', title: 'Basic Charge', unit: 'R', filename: 'basic' },
  { key: 'kva-charge', title: 'kVA Charge', unit: 'R', filename: 'kva-charge' },
  { key: 'kwh-charge', title: 'kWh Charge', unit: 'R', filename: 'kwh-charge' },
  { key: 'kva-consumption', title: 'kVA Consumption', unit: 'kVA', filename: 'kva-consumption' },
  { key: 'kwh-consumption', title: 'kWh Consumption', unit: 'kWh', filename: 'kwh-consumption' },
] as const;

export type ChartMetricKey = typeof CHART_METRICS[number]['key'];

/**
 * Convert base64 data URL to Blob
 */
export function dataURLtoBlob(dataURL: string): Blob {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Save a single chart image to storage
 */
export async function saveChartToStorage(
  siteId: string,
  meterNumber: string,
  metricFilename: string,
  chartDataUrl: string
): Promise<boolean> {
  try {
    const fileName = `${meterNumber}-${metricFilename}.png`;
    const { bucket, path } = await generateStoragePath(
      siteId,
      'Metering',
      'Reconciliations/Graphs',
      fileName
    );

    const blob = dataURLtoBlob(chartDataUrl);

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, blob, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) {
      console.error(`Failed to save chart ${fileName}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error saving chart for ${meterNumber}-${metricFilename}:`, error);
    return false;
  }
}

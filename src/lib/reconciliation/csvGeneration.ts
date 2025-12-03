import { supabase } from '@/integrations/supabase/client';
import type { HierarchicalCsvResult } from './types';

/**
 * Generate hierarchical CSV for a parent meter via edge function
 */
export async function generateHierarchicalCsvForMeter(
  parentMeter: { id: string; meter_number: string },
  siteId: string,
  dateFrom: string,
  dateTo: string,
  childMeterIds: string[],
  availableColumns: string[],
  meterAssociations: Record<string, string>
): Promise<HierarchicalCsvResult | null> {
  if (childMeterIds.length === 0) return null;

  try {
    // Filter out datetime column(s) - the edge function generates its own 'Time' column
    const dataColumns = availableColumns.filter((col: string) => {
      const colLower = col.toLowerCase();
      return colLower !== 'time' && colLower !== 'timestamp' && colLower !== 'date' && colLower !== 'datetime';
    });
    
    const { data, error } = await supabase.functions.invoke('generate-hierarchical-csv', {
      body: {
        parentMeterId: parentMeter.id,
        parentMeterNumber: parentMeter.meter_number,
        siteId,
        dateFrom,
        dateTo,
        childMeterIds,
        columns: dataColumns,
        meterAssociations
      }
    });

    if (error) {
      console.error(`Failed to generate CSV for ${parentMeter.meter_number}:`, error);
      return null;
    }

    if (data) {
      const corrections = data.corrections || [];
      console.log(`✓ Generated hierarchical CSV for ${parentMeter.meter_number}`, {
        totalKwh: data.totalKwh,
        columns: data.columns,
        rowCount: data.rowCount,
        correctionsCount: corrections.length
      });
      return { 
        totalKwh: data.totalKwh, 
        columnTotals: data.columnTotals || {},
        columnMaxValues: data.columnMaxValues || {},
        rowCount: data.rowCount || 0,
        corrections,
        requiresParsing: data.requiresParsing,
        csvFileId: data.csvFileId,
        columnMapping: data.columnMapping
      };
    }
    return null;
  } catch (error) {
    console.error(`Error generating CSV for ${parentMeter.meter_number}:`, error);
    return null;
  }
}

/**
 * Download a CSV file from storage
 */
export async function downloadCsvFromStorage(
  filePath: string,
  fileName: string
): Promise<void> {
  const { data, error } = await supabase.storage
    .from('client-files')
    .download(filePath);

  if (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }

  // Create download link
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get the storage URL for a CSV file
 */
export function getCsvStorageUrl(filePath: string): string {
  const { data } = supabase.storage.from('client-files').getPublicUrl(filePath);
  return data.publicUrl;
}

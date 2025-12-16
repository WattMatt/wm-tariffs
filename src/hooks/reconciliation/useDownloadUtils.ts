import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { getFullDateTime } from '@/lib/reconciliation';

export interface UseDownloadUtilsOptions {
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  timeFrom: string;
  timeTo: string;
}

export function useDownloadUtils(options: UseDownloadUtilsOptions) {
  const { dateFrom, dateTo, timeFrom, timeTo } = options;

  /**
   * Download meter readings as CSV for a specific date range
   */
  const downloadMeterCSV = useCallback(async (meter: { id: string; meter_number: string }) => {
    try {
      if (!dateFrom || !dateTo) {
        toast.error("Date range not available");
        return;
      }

      toast.loading(`Fetching readings for ${meter.meter_number}...`);

      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch ALL readings for this meter using pagination
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error } = await supabase
          .from("meter_readings")
          .select("reading_timestamp, metadata")
          .eq("meter_id", meter.id)
          .gte("reading_timestamp", fullDateTimeFrom)
          .lte("reading_timestamp", fullDateTimeTo)
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) {
          toast.dismiss();
          toast.error(`Failed to fetch readings: ${error.message}`);
          return;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      if (allReadings.length === 0) {
        toast.dismiss();
        toast.error("No readings found for this meter");
        return;
      }

      // Transform readings to CSV format - all values come from metadata.imported_fields
      const csvData = allReadings.map(reading => {
        const row: any = {
          timestamp: format(new Date(reading.reading_timestamp), "yyyy-MM-dd HH:mm:ss"),
        };

        // Add all metadata fields
        if (reading.metadata && (reading.metadata as any).imported_fields) {
          const importedFields = (reading.metadata as any).imported_fields;
          Object.entries(importedFields).forEach(([key, value]) => {
            row[key] = value;
          });
        }

        return row;
      });

      // Generate CSV
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${meter.meter_number}_${format(dateFrom, "yyyy-MM-dd")}_to_${format(dateTo, "yyyy-MM-dd")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.dismiss();
      toast.success(`Downloaded ${allReadings.length} readings for ${meter.meter_number}`);
    } catch (error) {
      console.error("CSV download error:", error);
      toast.dismiss();
      toast.error("Failed to download CSV");
    }
  }, [dateFrom, dateTo, timeFrom, timeTo]);

  /**
   * Download CSV file from storage (parsed or generated)
   */
  const downloadMeterCsvFile = useCallback(async (meterId: string, fileType: 'parsed' | 'generated') => {
    try {
      toast.loading(`Downloading ${fileType} CSV...`);
      
      // Query meter_csv_files for the matching file
      const { data: csvFile, error } = await supabase
        .from('meter_csv_files')
        .select('file_path, file_name, parsed_file_path')
        .eq('meter_id', meterId)
        .eq('parse_status', fileType === 'parsed' ? 'parsed' : 'generated')
        .maybeSingle();
      
      if (error || !csvFile) {
        toast.dismiss();
        toast.error(`No ${fileType} CSV file found`);
        return;
      }
      
      // Use parsed_file_path for parsed files, file_path for generated
      const storagePath = fileType === 'parsed' && csvFile.parsed_file_path 
        ? csvFile.parsed_file_path 
        : csvFile.file_path;
      
      // Get signed URL from storage
      const { data: urlData, error: urlError } = await supabase.storage
        .from('client-files')
        .createSignedUrl(storagePath, 3600);
      
      if (urlError || !urlData?.signedUrl) {
        toast.dismiss();
        toast.error('Failed to get download URL');
        return;
      }
      
      // Trigger download
      const link = document.createElement('a');
      link.href = urlData.signedUrl;
      link.download = csvFile.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.dismiss();
      toast.success(`Downloaded ${fileType} CSV`);
    } catch (error) {
      console.error('CSV download from storage error:', error);
      toast.dismiss();
      toast.error('Failed to download CSV');
    }
  }, []);

  /**
   * Download all meters CSV files sequentially
   */
  const downloadAllMetersCSV = useCallback(async (meters: Array<{ id: string; meter_number: string }>) => {
    for (const meter of meters) {
      await downloadMeterCSV(meter);
      // Small delay between downloads to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }, [downloadMeterCSV]);

  return {
    downloadMeterCSV,
    downloadMeterCsvFile,
    downloadAllMetersCSV,
  };
}

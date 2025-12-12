import { useRef, useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ParseQueueItem {
  meterId: string;
  meterNumber: string;
  filePath: string;
  separator: string;
  dateFormat: string;
  timeInterval: number;
  headerRowNumber: number;
  columnMapping: any;
}

interface QueueProgress {
  completed: number;
  total: number;
  currentFile: string;
  isActive: boolean;
}

export function useCsvParseQueue(siteId: string, onDataChange?: () => void) {
  const queueRef = useRef<ParseQueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const cancelledRef = useRef(false);
  const [progress, setProgress] = useState<QueueProgress>({
    completed: 0,
    total: 0,
    currentFile: "",
    isActive: false,
  });

  // Process queue items one by one
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    cancelledRef.current = false;
    
    const totalItems = queueRef.current.length;
    let completedItems = 0;
    
    setProgress({
      completed: 0,
      total: totalItems,
      currentFile: queueRef.current[0]?.meterNumber || "",
      isActive: true,
    });

    while (queueRef.current.length > 0 && !cancelledRef.current) {
      const item = queueRef.current[0];
      
      setProgress(prev => ({
        ...prev,
        currentFile: item.meterNumber,
        completed: completedItems,
      }));

      try {
        // Update database status to 'parsing' before processing
        await supabase
          .from('meter_csv_files')
          .update({ parse_status: 'parsing', error_message: null })
          .eq('file_path', item.filePath);

        // Trigger UI refresh to show "Parsing..." status
        onDataChange?.();

        const { data, error } = await supabase.functions.invoke('process-meter-csv', {
          body: {
            meterId: item.meterId,
            filePath: item.filePath,
            separator: item.separator,
            dateFormat: item.dateFormat,
            timeInterval: item.timeInterval,
            headerRowNumber: item.headerRowNumber,
            columnMapping: item.columnMapping
          }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error);

        const totalProcessed = data.readingsInserted + data.duplicatesSkipped;
        const hasValidData = totalProcessed > 0;

        if (!hasValidData) {
          toast.error(
            `${item.meterNumber}: ⚠️ No data extracted. Check column mappings.`,
            { duration: 8000 }
          );
        } else {
          const newPercent = ((data.readingsInserted / totalProcessed) * 100).toFixed(1);
          toast.success(
            `${item.meterNumber}: ✓ ${data.readingsInserted} new (${newPercent}%)`,
            { duration: 4000 }
          );
        }
      } catch (err: any) {
        toast.error(`${item.meterNumber}: Parse failed - ${err.message}`);
      }

      // Remove processed item from queue
      queueRef.current.shift();
      completedItems++;
      
      setProgress(prev => ({
        ...prev,
        completed: completedItems,
      }));

      // Trigger UI refresh after each file completes
      onDataChange?.();
    }

    isProcessingRef.current = false;
    
    if (cancelledRef.current) {
      toast.info(`Parsing cancelled. ${completedItems}/${totalItems} completed.`);
    } else {
      toast.success(`Parsing complete! ${completedItems} file(s) processed.`);
    }
    
    setProgress(prev => ({
      ...prev,
      isActive: false,
      currentFile: "",
    }));
    
    onDataChange?.();
  }, [onDataChange]);

  const startQueue = useCallback((items: ParseQueueItem[]) => {
    if (items.length === 0) {
      toast.error("No files to parse");
      return;
    }
    
    queueRef.current = [...items];
    cancelledRef.current = false;
    
    toast.info(`Starting background parse of ${items.length} file(s)...`);
    processQueue();
  }, [processQueue]);

  const cancelQueue = useCallback(() => {
    cancelledRef.current = true;
    queueRef.current = [];
  }, []);

  const getProgress = useCallback(() => progress, [progress]);
  
  const isProcessing = progress.isActive;

  return {
    startQueue,
    cancelQueue,
    getProgress,
    isProcessing,
    progress,
  };
}

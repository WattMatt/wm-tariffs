/**
 * Reusable hook for background chart capture with pause/resume/cancel support
 */

import { useState, useRef, useCallback } from 'react';
import { uploadChartImage } from '@/lib/charts/storage';
import type {
  ChartCaptureConfig,
  ChartMetric,
  CaptureLogEntry,
  ItemCaptureResult,
  ChartCaptureProgress,
  StoragePath,
} from '@/lib/charts/types';

export interface CaptureItem<TItem = unknown> {
  item: TItem;
  itemId: string;
  itemLabel: string;
  docs?: unknown[];
}

export interface UseBackgroundChartCaptureOptions<TItem = unknown> {
  siteId: string;
  config: ChartCaptureConfig<TItem>;
  renderChart: (item: TItem, metric: ChartMetric, docs: unknown[]) => Promise<string> | string;
  onProgress?: (progress: ChartCaptureProgress) => void;
  onItemComplete?: (result: ItemCaptureResult) => void;
  onLogUpdate?: (log: CaptureLogEntry[]) => void;
}

export interface UseBackgroundChartCaptureResult<TItem = unknown> {
  isCapturing: boolean;
  isPaused: boolean;
  progress: ChartCaptureProgress | null;
  log: CaptureLogEntry[];
  results: ItemCaptureResult[];
  startCapture: (items: CaptureItem<TItem>[]) => Promise<{ success: number; failed: number; cancelled: boolean }>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

const DEFAULT_PARALLEL_BATCH_SIZE = 3;
const DEFAULT_PAUSE_CHECK_INTERVAL = 100;

export function useBackgroundChartCapture<TItem = unknown>(
  options: UseBackgroundChartCaptureOptions<TItem>
): UseBackgroundChartCaptureResult<TItem> {
  const { siteId, config, renderChart, onProgress, onItemComplete, onLogUpdate } = options;

  const [isCapturing, setIsCapturing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState<ChartCaptureProgress | null>(null);
  const [log, setLog] = useState<CaptureLogEntry[]>([]);
  const [results, setResults] = useState<ItemCaptureResult[]>([]);

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);

  const addLogEntry = useCallback((entry: Omit<CaptureLogEntry, 'timestamp'>) => {
    const fullEntry: CaptureLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    setLog(prev => {
      const updated = [...prev, fullEntry];
      onLogUpdate?.(updated);
      return updated;
    });
    console.log(`[ChartCapture] ${entry.status.toUpperCase()}: ${entry.itemLabel} - ${entry.metricLabel} (Attempt ${entry.attempt})${entry.error ? ` - ${entry.error}` : ''}`);
  }, [onLogUpdate]);

  const processItemCharts = useCallback(async (
    captureItem: CaptureItem<TItem>,
    itemIndex: number,
    totalItems: number
  ): Promise<ItemCaptureResult> => {
    const startTime = Date.now();
    const { item, itemId, itemLabel, docs = [] } = captureItem;
    let successCount = 0;
    const failedMetrics: string[] = [];

    console.log(`[ChartCapture] Processing item ${itemIndex + 1}/${totalItems}: ${itemLabel} (${config.metrics.length} charts)`);

    for (let chartIndex = 0; chartIndex < config.metrics.length; chartIndex++) {
      const metric = config.metrics[chartIndex];
      
      // Check for cancel
      if (cancelRef.current) break;

      // Check for pause
      while (pauseRef.current && !cancelRef.current) {
        setIsPaused(true);
        await new Promise(resolve => setTimeout(resolve, config.pauseCheckInterval || DEFAULT_PAUSE_CHECK_INTERVAL));
      }
      setIsPaused(false);

      if (cancelRef.current) break;

      // Update progress
      const currentChart = itemIndex * config.metrics.length + chartIndex + 1;
      const totalCharts = totalItems * config.metrics.length;
      const batchSize = config.parallelBatchSize || DEFAULT_PARALLEL_BATCH_SIZE;
      const currentBatch = Math.ceil((itemIndex + 1) / batchSize);
      const totalBatches = Math.ceil(totalItems / batchSize);

      const progressUpdate: ChartCaptureProgress = {
        currentItem: itemIndex + 1,
        totalItems,
        currentChart,
        totalCharts,
        currentBatch,
        totalBatches,
        percentComplete: Math.round((currentChart / totalCharts) * 100),
        isPaused: pauseRef.current,
        currentItemLabel: itemLabel,
        currentMetricLabel: metric.title,
      };
      setProgress(progressUpdate);
      onProgress?.(progressUpdate);

      const chartStartTime = Date.now();

      try {
        addLogEntry({
          itemId,
          itemLabel,
          metricKey: metric.key,
          metricLabel: metric.title,
          status: 'rendering',
          attempt: 1,
          itemIndex,
          totalItems,
        });

        // Render chart
        const dataUrl = await renderChart(item, metric, docs);

        if (!dataUrl) {
          throw new Error('Failed to generate chart image');
        }

        addLogEntry({
          itemId,
          itemLabel,
          metricKey: metric.key,
          metricLabel: metric.title,
          status: 'capturing',
          attempt: 1,
          itemIndex,
          totalItems,
        });

        // Get storage path and upload
        const storagePath = await config.storagePathGenerator(siteId, itemId, metric.filename);
        const result = await uploadChartImage(storagePath as StoragePath, dataUrl);

        if (!result.success) {
          throw new Error(result.error || 'Failed to save chart to storage');
        }

        const duration = Date.now() - chartStartTime;
        addLogEntry({
          itemId,
          itemLabel,
          metricKey: metric.key,
          metricLabel: metric.title,
          status: 'success',
          attempt: 1,
          duration,
          itemIndex,
          totalItems,
        });

        successCount++;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const duration = Date.now() - chartStartTime;
        
        addLogEntry({
          itemId,
          itemLabel,
          metricKey: metric.key,
          metricLabel: metric.title,
          status: 'failed',
          attempt: 1,
          error: errorMessage,
          duration,
          itemIndex,
          totalItems,
        });

        failedMetrics.push(metric.title);
      }
    }

    const duration = Date.now() - startTime;
    const result: ItemCaptureResult = {
      itemId,
      itemLabel,
      chartsAttempted: config.metrics.length,
      chartsSuccessful: successCount,
      chartsFailed: failedMetrics.length,
      failedMetrics,
      duration,
    };

    // Log item completion
    addLogEntry({
      itemId,
      itemLabel,
      metricKey: 'all',
      metricLabel: `All charts (${successCount}/${config.metrics.length} successful)`,
      status: 'item_complete',
      attempt: 1,
      duration,
      itemIndex,
      totalItems,
    });

    console.log(`[ChartCapture] Item ${itemLabel} complete: ${successCount}/${config.metrics.length} charts in ${(duration / 1000).toFixed(1)}s`);

    return result;
  }, [config, siteId, renderChart, addLogEntry, onProgress]);

  const startCapture = useCallback(async (
    items: CaptureItem<TItem>[]
  ): Promise<{ success: number; failed: number; cancelled: boolean }> => {
    if (isCapturing) {
      console.warn('[ChartCapture] Already capturing');
      return { success: 0, failed: 0, cancelled: true };
    }

    setIsCapturing(true);
    setIsPaused(false);
    setLog([]);
    setResults([]);
    cancelRef.current = false;
    pauseRef.current = false;

    const batchSize = config.parallelBatchSize || DEFAULT_PARALLEL_BATCH_SIZE;
    const totalItems = items.length;
    let totalSuccess = 0;
    let totalFailed = 0;
    const allResults: ItemCaptureResult[] = [];

    console.log(`[ChartCapture] Starting capture: ${totalItems} items, ${config.metrics.length} charts each (${batchSize} items at a time)`);

    try {
      // Process items in parallel batches
      for (let batchStart = 0; batchStart < items.length; batchStart += batchSize) {
        if (cancelRef.current) {
          console.log('[ChartCapture] Capture cancelled by user');
          break;
        }

        const batchEnd = Math.min(batchStart + batchSize, items.length);
        const batch = items.slice(batchStart, batchEnd);

        console.log(`[ChartCapture] Processing batch: items ${batchStart + 1}-${batchEnd} of ${totalItems}`);

        // Process all items in this batch simultaneously
        const batchPromises = batch.map((captureItem, batchIndex) =>
          processItemCharts(captureItem, batchStart + batchIndex, totalItems)
        );

        const batchResults = await Promise.all(batchPromises);

        // Process results from this batch
        for (const itemResult of batchResults) {
          allResults.push(itemResult);
          totalSuccess += itemResult.chartsSuccessful;
          totalFailed += itemResult.chartsFailed;
          onItemComplete?.(itemResult);
        }

        setResults([...allResults]);
        console.log(`[ChartCapture] Batch complete: ${allResults.length}/${totalItems} items processed`);
      }

      console.log(`[ChartCapture] All items complete: ${totalSuccess} success, ${totalFailed} failed`);
      return { success: totalSuccess, failed: totalFailed, cancelled: cancelRef.current };

    } finally {
      setIsCapturing(false);
      setIsPaused(false);
    }
  }, [isCapturing, config, processItemCharts, onItemComplete]);

  const pause = useCallback(() => {
    pauseRef.current = true;
    setIsPaused(true);
    console.log('[ChartCapture] Pausing capture');
  }, []);

  const resume = useCallback(() => {
    pauseRef.current = false;
    setIsPaused(false);
    console.log('[ChartCapture] Resuming capture');
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    pauseRef.current = false;
    setIsPaused(false);
    console.log('[ChartCapture] Cancelling capture');
  }, []);

  return {
    isCapturing,
    isPaused,
    progress,
    log,
    results,
    startCapture,
    pause,
    resume,
    cancel,
  };
}

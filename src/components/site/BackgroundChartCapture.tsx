import React, { useEffect, useRef, useCallback } from "react";
import { saveChartToStorage, CHART_METRICS, ChartMetricKey } from "@/lib/reconciliation/chartGeneration";
import { generateReconciliationMeterChart, ReconciliationChartDataPoint } from "./ChartGenerator";
import { supabase } from "@/integrations/supabase/client";

interface DocumentShopNumber {
  documentId: string;
  fileName: string;
  shopNumber: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  totalAmountExcludingEmergency?: number;
  currency: string;
  tenantName?: string;
  accountReference?: string;
  meterId?: string;
  reconciliationDateFrom?: string;
  reconciliationDateTo?: string;
  lineItems?: Array<{
    description: string;
    meter_number?: string;
    unit?: 'kWh' | 'kVA' | 'Monthly';
    supply?: 'Normal' | 'Emergency';
    previous_reading?: number;
    current_reading?: number;
    consumption?: number;
    rate?: number;
    amount: number;
  }>;
}

interface Meter {
  id: string;
  meter_number: string;
  name: string;
  tariff: string | null;
  tariff_structure_id: string | null;
  assigned_tariff_name: string | null;
  meter_type: string;
  mccb_size: number | null;
  rating: string | null;
}

interface CaptureQueueItem {
  meter: Meter;
  docs: DocumentShopNumber[];
  metric: ChartMetricKey;
  metricInfo: typeof CHART_METRICS[number];
}

export interface CaptureLogEntry {
  timestamp: string;
  meterNumber: string;
  metricKey: string;
  metricLabel: string;
  status: 'pending' | 'rendering' | 'capturing' | 'success' | 'failed' | 'retrying' | 'meter_complete';
  attempt: number;
  error?: string;
  duration?: number;
  meterIndex?: number;
  totalMeters?: number;
}

export interface MeterCaptureResult {
  meterNumber: string;
  meterId: string;
  chartsAttempted: number;
  chartsSuccessful: number;
  chartsFailed: number;
  failedMetrics: string[];
  duration: number;
}

interface BackgroundChartCaptureProps {
  siteId: string;
  queue: CaptureQueueItem[];
  onProgress: (current: number, total: number, meterNumber: string, metric: string, batchInfo?: string) => void;
  onComplete: (success: number, failed: number, cancelled: boolean, log: CaptureLogEntry[], meterResults: MeterCaptureResult[]) => void;
  onPauseStateChange?: (isPaused: boolean) => void;
  onLogUpdate?: (log: CaptureLogEntry[]) => void;
  onMeterComplete?: (result: MeterCaptureResult) => void;
  cancelRef: React.MutableRefObject<boolean>;
  pauseRef: React.MutableRefObject<boolean>;
  isActive: boolean;
}

// Configuration - much faster now with Canvas generation
const PAUSE_CHECK_INTERVAL_MS = 100;
const PARALLEL_METER_COUNT = 3; // Process 3 meters simultaneously

// Helper to extract metric value from document
const extractMetricValue = (doc: DocumentShopNumber | undefined, metric: string): number | null => {
  if (!doc) return null;
  if (metric === 'total') {
    const lineItems = doc.lineItems || [];
    const normalTotal = lineItems
      .filter(item => item.supply !== 'Emergency')
      .reduce((sum, item) => sum + (item.amount || 0), 0);
    return normalTotal;
  }
  
  const lineItems = doc.lineItems || [];
  
  switch(metric) {
    case 'basic':
      const basicItem = lineItems.find(item => item.unit === 'Monthly');
      return basicItem?.amount || null;
    case 'kva-charge':
      const kvaItem = lineItems.find(item => item.unit === 'kVA');
      return kvaItem?.amount || null;
    case 'kwh-charge':
      const kwhItem = lineItems.find(item => item.unit === 'kWh' && item.supply === 'Normal');
      return kwhItem?.amount || null;
    case 'kva-consumption':
      const kvaConsumption = lineItems.find(item => item.unit === 'kVA');
      return kvaConsumption?.consumption || null;
    case 'kwh-consumption':
      const kwhConsumption = lineItems.find(item => item.unit === 'kWh' && item.supply === 'Normal');
      return kwhConsumption?.consumption || null;
    default:
      return doc.totalAmount;
  }
};

// Helper to extract meter readings from document line items
const extractMeterReadings = (doc: DocumentShopNumber | undefined, metric: string): { previous: number | null, current: number | null } => {
  if (!doc) return { previous: null, current: null };
  
  const lineItems = doc.lineItems || [];
  let item = null;
  
  switch(metric) {
    case 'basic':
      item = lineItems.find(i => i.unit === 'Monthly');
      break;
    case 'kva-charge':
    case 'kva-consumption':
      item = lineItems.find(i => i.unit === 'kVA');
      break;
    case 'kwh-charge':
    case 'kwh-consumption':
    case 'total':
      item = lineItems.find(i => i.unit === 'kWh' && i.supply === 'Normal');
      break;
  }
  
  return {
    previous: item?.previous_reading ?? null,
    current: item?.current_reading ?? null
  };
};

// Prepare chart data for a meter and metric
const prepareChartData = async (
  meterId: string,
  docs: DocumentShopNumber[], 
  metric: string
): Promise<ReconciliationChartDataPoint[]> => {
  const { data: reconciliationData } = await supabase
    .from('reconciliation_meter_results')
    .select(`
      meter_id,
      total_cost,
      energy_cost,
      fixed_charges,
      demand_charges,
      total_kwh,
      column_max_values,
      reconciliation_runs!inner(date_from, date_to)
    `)
    .eq('meter_id', meterId);

  const reconCostsMap: Record<string, number> = {};
  
  if (reconciliationData) {
    reconciliationData.forEach((result: any) => {
      const run = result.reconciliation_runs;
      if (!run) return;
      
      docs.forEach(doc => {
        const docEnd = doc.periodEnd.substring(0, 7);
        const reconEnd = run.date_to.substring(0, 7);
        
        if (docEnd === reconEnd) {
          let value: number | null = null;
          
          switch(metric) {
            case 'total':
              value = result.total_cost;
              break;
            case 'basic':
              value = result.fixed_charges;
              break;
            case 'kva-charge':
              value = result.demand_charges;
              break;
            case 'kwh-charge':
              value = result.energy_cost;
              break;
            case 'kva-consumption':
              const maxValues = result.column_max_values as Record<string, number> | null;
              value = maxValues?.['S'] || maxValues?.['kVA'] || null;
              break;
            case 'kwh-consumption':
              value = result.total_kwh;
              break;
          }
          
          if (value !== null) {
            reconCostsMap[doc.documentId] = value;
          }
        }
      });
    });
  }

  const sortedDocs = [...docs].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  
  return sortedDocs.map(doc => {
    const documentValue = extractMetricValue(doc, metric);
    const reconValue = reconCostsMap[doc.documentId];
    const readings = extractMeterReadings(doc, metric);
    const periodDate = new Date(doc.periodEnd);
    const period = periodDate.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
    
    return {
      period,
      documentAmount: documentValue,
      amount: reconValue ?? null,
      meterReading: readings.current,
    };
  });
};

// Group queue items by meter
interface MeterGroup {
  meter: Meter;
  items: CaptureQueueItem[];
}

const groupByMeter = (queue: CaptureQueueItem[]): MeterGroup[] => {
  const meterMap = new Map<string, MeterGroup>();
  
  queue.forEach(item => {
    const existing = meterMap.get(item.meter.id);
    if (existing) {
      existing.items.push(item);
    } else {
      meterMap.set(item.meter.id, {
        meter: item.meter,
        items: [item],
      });
    }
  });
  
  return Array.from(meterMap.values());
};

export default function BackgroundChartCapture({
  siteId,
  queue,
  onProgress,
  onComplete,
  onPauseStateChange,
  onLogUpdate,
  onMeterComplete,
  cancelRef,
  pauseRef,
  isActive,
}: BackgroundChartCaptureProps) {
  const processingRef = useRef(false);
  const captureLogRef = useRef<CaptureLogEntry[]>([]);
  const meterResultsRef = useRef<MeterCaptureResult[]>([]);

  // Add log entry
  const addLogEntry = useCallback((entry: Omit<CaptureLogEntry, 'timestamp'>) => {
    const fullEntry: CaptureLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    captureLogRef.current = [...captureLogRef.current, fullEntry];
    onLogUpdate?.(captureLogRef.current);
    console.log(`[ChartCapture] ${entry.status.toUpperCase()}: ${entry.meterNumber} - ${entry.metricLabel} (Attempt ${entry.attempt})${entry.error ? ` - ${entry.error}` : ''}`);
  }, [onLogUpdate]);

  // Generate and save a single chart using Canvas (fast, no DOM)
  const generateAndSaveChart = useCallback(async (
    item: CaptureQueueItem,
    meterIndex: number,
    totalMeters: number
  ): Promise<{ success: boolean; error?: string }> => {
    const startTime = Date.now();
    
    try {
      addLogEntry({
        meterNumber: item.meter.meter_number,
        metricKey: item.metric,
        metricLabel: item.metricInfo.title,
        status: 'rendering',
        attempt: 1,
        meterIndex,
        totalMeters,
      });

      // Prepare chart data
      const data = await prepareChartData(item.meter.id, item.docs, item.metric);
      
      if (!data || data.length === 0) {
        throw new Error('No chart data available');
      }

      addLogEntry({
        meterNumber: item.meter.meter_number,
        metricKey: item.metric,
        metricLabel: item.metricInfo.title,
        status: 'capturing',
        attempt: 1,
        meterIndex,
        totalMeters,
      });

      // Generate chart using Canvas API (fast, synchronous)
      const dataUrl = generateReconciliationMeterChart(
        `${item.meter.meter_number} - ${item.metricInfo.title}`,
        item.metricInfo.unit,
        data
      );
      
      if (!dataUrl) {
        throw new Error('Failed to generate chart image');
      }

      // Save to storage
      const saved = await saveChartToStorage(
        siteId, 
        item.meter.meter_number, 
        item.metricInfo.filename, 
        dataUrl
      );
      
      if (!saved) {
        throw new Error('Failed to save chart to storage');
      }

      const duration = Date.now() - startTime;
      addLogEntry({
        meterNumber: item.meter.meter_number,
        metricKey: item.metric,
        metricLabel: item.metricInfo.title,
        status: 'success',
        attempt: 1,
        duration,
        meterIndex,
        totalMeters,
      });

      return { success: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const duration = Date.now() - startTime;
      
      addLogEntry({
        meterNumber: item.meter.meter_number,
        metricKey: item.metric,
        metricLabel: item.metricInfo.title,
        status: 'failed',
        attempt: 1,
        error: errorMessage,
        duration,
        meterIndex,
        totalMeters,
      });

      return { success: false, error: errorMessage };
    }
  }, [siteId, addLogEntry]);

  // Process all charts for a single meter
  const processMeterCharts = useCallback(async (
    meterGroup: MeterGroup,
    meterIndex: number,
    totalMeters: number
  ): Promise<MeterCaptureResult> => {
    const startTime = Date.now();
    const { meter, items } = meterGroup;
    let successCount = 0;
    const failedMetrics: string[] = [];

    console.log(`[ChartCapture] Processing meter ${meterIndex + 1}/${totalMeters}: ${meter.meter_number} (${items.length} charts)`);

    for (let chartIndex = 0; chartIndex < items.length; chartIndex++) {
      const item = items[chartIndex];
      
      // Check for cancel
      if (cancelRef.current) {
        break;
      }

      // Check for pause
      while (pauseRef.current && !cancelRef.current) {
        onPauseStateChange?.(true);
        await new Promise(resolve => setTimeout(resolve, PAUSE_CHECK_INTERVAL_MS));
      }
      onPauseStateChange?.(false);

      if (cancelRef.current) {
        break;
      }

      // Update progress
      const overallProgress = (meterIndex * 6) + chartIndex + 1;
      const totalCharts = totalMeters * 6;
      onProgress(
        overallProgress, 
        totalCharts, 
        meter.meter_number, 
        item.metricInfo.title,
        `Meter ${meterIndex + 1}/${totalMeters} - Chart ${chartIndex + 1}/6`
      );

      // Generate and save chart (Canvas-based, very fast)
      const result = await generateAndSaveChart(item, meterIndex, totalMeters);
      
      if (result.success) {
        successCount++;
      } else {
        failedMetrics.push(item.metricInfo.title);
      }
    }

    const duration = Date.now() - startTime;
    const result: MeterCaptureResult = {
      meterNumber: meter.meter_number,
      meterId: meter.id,
      chartsAttempted: items.length,
      chartsSuccessful: successCount,
      chartsFailed: failedMetrics.length,
      failedMetrics,
      duration,
    };

    // Log meter completion
    addLogEntry({
      meterNumber: meter.meter_number,
      metricKey: 'all',
      metricLabel: `All charts (${successCount}/${items.length} successful)`,
      status: 'meter_complete',
      attempt: 1,
      duration,
      meterIndex,
      totalMeters,
    });

    console.log(`[ChartCapture] Meter ${meter.meter_number} complete: ${successCount}/${items.length} charts in ${(duration / 1000).toFixed(1)}s`);

    return result;
  }, [generateAndSaveChart, addLogEntry, onProgress, onPauseStateChange, cancelRef, pauseRef]);

  // Process queue with parallel meter processing
  useEffect(() => {
    if (!isActive || queue.length === 0 || processingRef.current) return;

    const processAllMeters = async () => {
      processingRef.current = true;
      captureLogRef.current = [];
      meterResultsRef.current = [];
      
      // Group queue by meter
      const meterGroups = groupByMeter(queue);
      const totalMeters = meterGroups.length;
      
      console.log(`[ChartCapture] Starting parallel Canvas capture: ${totalMeters} meters, ${queue.length} total charts (${PARALLEL_METER_COUNT} meters at a time)`);

      let totalSuccess = 0;
      let totalFailed = 0;
      let processedCount = 0;

      // Process meters in parallel batches
      for (let batchStart = 0; batchStart < meterGroups.length; batchStart += PARALLEL_METER_COUNT) {
        if (cancelRef.current) {
          console.log('[ChartCapture] Capture cancelled by user');
          break;
        }

        // Get batch of meters to process in parallel
        const batchEnd = Math.min(batchStart + PARALLEL_METER_COUNT, meterGroups.length);
        const batch = meterGroups.slice(batchStart, batchEnd);
        
        console.log(`[ChartCapture] Processing batch: meters ${batchStart + 1}-${batchEnd} of ${totalMeters}`);

        // Process all meters in this batch simultaneously
        const batchPromises = batch.map((meterGroup, batchIndex) => 
          processMeterCharts(meterGroup, batchStart + batchIndex, totalMeters)
        );

        const batchResults = await Promise.all(batchPromises);

        // Process results from this batch
        for (const meterResult of batchResults) {
          meterResultsRef.current = [...meterResultsRef.current, meterResult];
          totalSuccess += meterResult.chartsSuccessful;
          totalFailed += meterResult.chartsFailed;
          processedCount++;

          // Notify about meter completion
          onMeterComplete?.(meterResult);
        }

        console.log(`[ChartCapture] Batch complete: ${processedCount}/${totalMeters} meters processed`);
      }

      console.log(`[ChartCapture] All meters complete: ${totalSuccess} success, ${totalFailed} failed`);
      onComplete(totalSuccess, totalFailed, cancelRef.current, captureLogRef.current, meterResultsRef.current);
      processingRef.current = false;
    };

    processAllMeters();
  }, [isActive, queue, processMeterCharts, onComplete, onMeterComplete, cancelRef]);

  // No DOM rendering needed - Canvas generation is entirely off-screen
  return null;
}
import React, { useEffect, useCallback, useRef } from "react";
import { CHART_METRICS, ChartMetricKey, generateChartPath, ChartType } from "@/lib/reconciliation/chartGeneration";
import { generateReconciliationMeterChart, generateAnalysisMeterChart, ReconciliationChartDataPoint, AnalysisChartDataPoint } from "./ChartGenerator";
import { supabase } from "@/integrations/supabase/client";
import { useBackgroundChartCapture, type CaptureItem } from "@/hooks/useBackgroundChartCapture";
import type { ChartMetric, CaptureLogEntry as GenericLogEntry, ItemCaptureResult } from "@/lib/charts/types";

// Document interface for reconciliation charts
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

// Meter interface
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

// Queue item from parent component
interface CaptureQueueItem {
  meter: Meter;
  docs: DocumentShopNumber[];
  metric: ChartMetricKey;
  metricInfo: typeof CHART_METRICS[number];
}

// Legacy log entry format for backwards compatibility
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

// Legacy result format for backwards compatibility
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
  chartType?: ChartType;
  onProgress?: (current: number, total: number, meterNumber: string, metric: string, batchInfo?: string) => void;
  onBatchProgress?: (metersComplete: number, totalMeters: number, chartsComplete: number, totalCharts: number) => void;
  onComplete: (success: number, failed: number, cancelled: boolean, log: CaptureLogEntry[], meterResults: MeterCaptureResult[]) => void;
  onPauseStateChange?: (isPaused: boolean) => void;
  onLogUpdate?: (log: CaptureLogEntry[]) => void;
  onMeterComplete?: (result: MeterCaptureResult) => void;
  cancelRef: React.MutableRefObject<boolean>;
  pauseRef: React.MutableRefObject<boolean>;
  isActive: boolean;
}

// ============ Reconciliation-specific data preparation ============

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

// Helper: Extract month from date string without timezone conversion
const getMonthFromDateString = (dateString: string): number => {
  const [, month] = dateString.split('-');
  return parseInt(month);
};

// Prepare analysis chart data (with segment-based winter/summer averages)
const prepareAnalysisChartData = async (
  meterId: string,
  docs: DocumentShopNumber[], 
  metric: string
): Promise<AnalysisChartDataPoint[]> => {
  // South African electricity seasons - matches TariffAssignmentTab.tsx exactly
  const winterMonths = [6, 7, 8];  // June, July, August
  const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];  // All other months
  
  const sortedDocs = [...docs].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  
  // Build segments for consecutive months of same season
  interface Segment {
    season: 'winter' | 'summer';
    segmentIndex: number;
    docIds: string[];
    average: number;
  }
  
  const segments: Segment[] = [];
  let winterSegment = -1;
  let summerSegment = -1;
  let lastSeason: 'winter' | 'summer' | null = null;
  let currentSegmentDocs: DocumentShopNumber[] = [];
  
  sortedDocs.forEach((doc, index) => {
    const month = getMonthFromDateString(doc.periodEnd);
    const isWinter = winterMonths.includes(month);
    const isSummer = summerMonths.includes(month);
    const currentSeason = isWinter ? 'winter' : isSummer ? 'summer' : null;
    
    if (!currentSeason) return;
    
    // Season changed - finalize previous segment
    if (lastSeason !== currentSeason) {
      if (lastSeason && currentSegmentDocs.length > 0) {
        const segmentIndex = lastSeason === 'winter' ? winterSegment : summerSegment;
        const values = currentSegmentDocs
          .map(d => extractMetricValue(d, metric))
          .filter(v => v !== null && v > 0) as number[];
        
        if (values.length > 0) {
          const average = values.reduce((sum, val) => sum + val, 0) / values.length;
          segments.push({
            season: lastSeason,
            segmentIndex,
            docIds: currentSegmentDocs.map(d => d.documentId),
            average
          });
        }
      }
      
      currentSegmentDocs = [];
      if (currentSeason === 'winter') winterSegment++;
      if (currentSeason === 'summer') summerSegment++;
    }
    
    currentSegmentDocs.push(doc);
    lastSeason = currentSeason;
    
    // Handle last document
    if (index === sortedDocs.length - 1 && currentSegmentDocs.length > 0) {
      const segmentIndex = currentSeason === 'winter' ? winterSegment : summerSegment;
      const values = currentSegmentDocs
        .map(d => extractMetricValue(d, metric))
        .filter(v => v !== null && v > 0) as number[];
      
      if (values.length > 0) {
        const average = values.reduce((sum, val) => sum + val, 0) / values.length;
        segments.push({
          season: currentSeason,
          segmentIndex,
          docIds: currentSegmentDocs.map(d => d.documentId),
          average
        });
      }
    }
  });
  
  // Build chart data with segment-specific averages
  return sortedDocs.map(doc => {
    const periodDate = new Date(doc.periodEnd);
    const month = getMonthFromDateString(doc.periodEnd);
    const isWinter = winterMonths.includes(month);
    const isSummer = summerMonths.includes(month);
    
    // Find matching segment for this document
    const matchingSegment = segments.find(seg => seg.docIds.includes(doc.documentId));
    
    // Build dynamic segment keys
    const segmentData: Record<string, number> = {};
    if (matchingSegment) {
      if (matchingSegment.season === 'winter') {
        segmentData[`winterAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
      } else {
        segmentData[`summerAvg_${matchingSegment.segmentIndex}`] = matchingSegment.average;
      }
    }
    
    return {
      period: periodDate.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }),
      documentAmount: extractMetricValue(doc, metric),
      isWinter,
      isSummer,
      ...segmentData,
    };
  });
};

// ============ Component ============

// Transform queue to capture items format
function transformQueueToCaptureItems(queue: CaptureQueueItem[]): CaptureItem<Meter>[] {
  // Group by meter
  const meterMap = new Map<string, { meter: Meter; docs: DocumentShopNumber[] }>();
  
  queue.forEach(item => {
    if (!meterMap.has(item.meter.id)) {
      meterMap.set(item.meter.id, { meter: item.meter, docs: item.docs });
    }
  });
  
  return Array.from(meterMap.values()).map(({ meter, docs }) => ({
    item: meter,
    itemId: meter.id,
    itemLabel: meter.meter_number,
    docs,
  }));
}

// Convert generic log entries to legacy format
function convertLogEntry(entry: GenericLogEntry): CaptureLogEntry {
  return {
    timestamp: entry.timestamp,
    meterNumber: entry.itemLabel,
    metricKey: entry.metricKey,
    metricLabel: entry.metricLabel,
    status: entry.status === 'item_complete' ? 'meter_complete' : entry.status,
    attempt: entry.attempt,
    error: entry.error,
    duration: entry.duration,
    meterIndex: entry.itemIndex,
    totalMeters: entry.totalItems,
  };
}

// Convert generic result to legacy format
function convertItemResult(result: ItemCaptureResult): MeterCaptureResult {
  return {
    meterNumber: result.itemLabel,
    meterId: result.itemId,
    chartsAttempted: result.chartsAttempted,
    chartsSuccessful: result.chartsSuccessful,
    chartsFailed: result.chartsFailed,
    failedMetrics: result.failedMetrics,
    duration: result.duration,
  };
}

export default function BackgroundChartCapture({
  siteId,
  queue,
  chartType = 'comparison',
  onProgress,
  onBatchProgress,
  onComplete,
  onPauseStateChange,
  onLogUpdate,
  onMeterComplete,
  cancelRef,
  pauseRef,
  isActive,
}: BackgroundChartCaptureProps) {
  const hasStartedRef = useRef(false);
  const docsMapRef = useRef<Map<string, DocumentShopNumber[]>>(new Map());
  
  // Build docs map from queue
  useEffect(() => {
    const map = new Map<string, DocumentShopNumber[]>();
    queue.forEach(item => {
      if (!map.has(item.meter.id)) {
        map.set(item.meter.id, item.docs);
      }
    });
    docsMapRef.current = map;
  }, [queue]);

  // Render function for charts - handles both analysis and comparison types
  const renderChart = useCallback(async (
    meter: Meter,
    metric: ChartMetric,
    docs: unknown[]
  ): Promise<string> => {
    const typedDocs = docs as DocumentShopNumber[];
    
    let dataUrl: string;
    
    if (chartType === 'analysis') {
      // Analysis chart: Document Amount bars with Winter/Summer average lines
      const data = await prepareAnalysisChartData(meter.id, typedDocs, metric.key);
      
      if (!data || data.length === 0) {
        throw new Error('No analysis chart data available');
      }
      
      dataUrl = generateAnalysisMeterChart(
        `${meter.meter_number} - ${metric.title}`,
        metric.unit,
        data
      );
    } else {
      // Comparison chart: Reconciliation Cost + Document Billed bars + Meter Reading line
      const data = await prepareChartData(meter.id, typedDocs, metric.key);
      
      if (!data || data.length === 0) {
        throw new Error('No chart data available');
      }
      
      dataUrl = generateReconciliationMeterChart(
        `${meter.meter_number} - ${metric.title}`,
        metric.unit,
        data
      );
    }
    
    if (!dataUrl) {
      throw new Error('Failed to generate chart image');
    }

    return dataUrl;
  }, [chartType]);

  // Use the generic hook
  const {
    isCapturing,
    isPaused,
    progress,
    log,
    results,
    startCapture,
    pause,
    resume,
    cancel,
  } = useBackgroundChartCapture<Meter>({
    siteId,
    config: {
      metrics: CHART_METRICS.map(m => ({ ...m })),
      storagePathGenerator: async (siteId, itemId, metricFilename) => {
        // Find meter number from results or queue
        const meter = queue.find(q => q.meter.id === itemId)?.meter;
        const meterNumber = meter?.meter_number || itemId;
        return generateChartPath(siteId, meterNumber, metricFilename, chartType);
      },
      parallelBatchSize: 3,
      pauseCheckInterval: 100,
    },
    renderChart,
    onProgress: (prog) => {
      onProgress?.(
        prog.currentChart,
        prog.totalCharts,
        prog.currentItemLabel,
        prog.currentMetricLabel,
        `Meter ${prog.currentItem}/${prog.totalItems} - Chart ${(prog.currentChart - 1) % 6 + 1}/6`
      );
      onBatchProgress?.(prog.currentItem, prog.totalItems, prog.currentChart, prog.totalCharts);
    },
    onItemComplete: (result) => {
      onMeterComplete?.(convertItemResult(result));
    },
    onLogUpdate: (genericLog) => {
      onLogUpdate?.(genericLog.map(convertLogEntry));
    },
  });

  // Sync pause state with refs
  useEffect(() => {
    if (pauseRef.current && !isPaused) {
      pause();
    } else if (!pauseRef.current && isPaused) {
      resume();
    }
  }, [pauseRef.current, isPaused, pause, resume]);

  // Handle cancel from ref
  useEffect(() => {
    if (cancelRef.current && isCapturing) {
      cancel();
    }
  }, [cancelRef.current, isCapturing, cancel]);

  // Notify pause state changes
  useEffect(() => {
    onPauseStateChange?.(isPaused);
  }, [isPaused, onPauseStateChange]);

  // Start capture when active
  useEffect(() => {
    if (!isActive || queue.length === 0 || hasStartedRef.current || isCapturing) return;

    const runCapture = async () => {
      hasStartedRef.current = true;
      
      const captureItems = transformQueueToCaptureItems(queue);
      const result = await startCapture(captureItems);
      
      // Call onComplete with legacy format
      onComplete(
        result.success,
        result.failed,
        result.cancelled,
        log.map(convertLogEntry),
        results.map(convertItemResult)
      );
      
      hasStartedRef.current = false;
    };

    runCapture();
  }, [isActive, queue, isCapturing, startCapture, onComplete, log, results]);

  // No DOM rendering needed - Canvas generation is entirely off-screen
  return null;
}

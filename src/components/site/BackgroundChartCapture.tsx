import React, { useEffect, useRef, useState, useCallback } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import html2canvas from "html2canvas";
import { saveChartToStorage, CHART_METRICS, ChartMetricKey } from "@/lib/reconciliation/chartGeneration";
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
  status: 'pending' | 'rendering' | 'capturing' | 'success' | 'failed' | 'retrying';
  attempt: number;
  error?: string;
  duration?: number;
}

interface BackgroundChartCaptureProps {
  siteId: string;
  queue: CaptureQueueItem[];
  onProgress: (current: number, total: number, meterNumber: string, metric: string, batchInfo?: string) => void;
  onComplete: (success: number, failed: number, cancelled: boolean, log: CaptureLogEntry[]) => void;
  onPauseStateChange?: (isPaused: boolean) => void;
  onLogUpdate?: (log: CaptureLogEntry[]) => void;
  cancelRef: React.MutableRefObject<boolean>;
  pauseRef: React.MutableRefObject<boolean>;
  isActive: boolean;
}

// Configuration
const BATCH_SIZE = 5; // Smaller batches for more stability
const BATCH_DELAY_MS = 1500;
const PAUSE_CHECK_INTERVAL_MS = 500;
const RENDER_SETUP_DELAY_MS = 800; // Time to set up chart
const RENDER_VERIFY_DELAY_MS = 400; // Time to verify render
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

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

// Prepare chart data for a meter and metric
const prepareChartData = async (
  meterId: string,
  docs: DocumentShopNumber[], 
  metric: string
) => {
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
    const periodDate = new Date(doc.periodEnd);
    const period = periodDate.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
    
    return {
      period,
      documentAmount: documentValue,
      amount: reconValue ?? null,
    };
  });
};

export default function BackgroundChartCapture({
  siteId,
  queue,
  onProgress,
  onComplete,
  onPauseStateChange,
  onLogUpdate,
  cancelRef,
  pauseRef,
  isActive,
}: BackgroundChartCaptureProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [currentItem, setCurrentItem] = useState<CaptureQueueItem | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [renderReady, setRenderReady] = useState(false);
  const processingRef = useRef(false);
  const captureLogRef = useRef<CaptureLogEntry[]>([]);

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

  // Verify chart element is rendered and has content
  const verifyChartRendered = useCallback((): boolean => {
    const chartElement = chartRef.current?.querySelector('.recharts-responsive-container');
    if (!chartElement) {
      console.log('[ChartCapture] Chart container not found');
      return false;
    }
    
    const svg = chartElement.querySelector('svg');
    if (!svg) {
      console.log('[ChartCapture] SVG element not found');
      return false;
    }
    
    const bars = svg.querySelectorAll('.recharts-bar-rectangle');
    const lines = svg.querySelectorAll('.recharts-line-curve');
    
    if (bars.length === 0 && lines.length === 0) {
      console.log('[ChartCapture] No chart elements (bars/lines) found');
      return false;
    }
    
    console.log(`[ChartCapture] Chart verified: ${bars.length} bars, ${lines.length} lines`);
    return true;
  }, []);

  // Capture a single chart with forced setup and verification
  const captureChart = useCallback(async (
    item: CaptureQueueItem,
    attempt: number
  ): Promise<{ success: boolean; error?: string }> => {
    const startTime = Date.now();
    
    try {
      // Step 1: Prepare chart data
      addLogEntry({
        meterNumber: item.meter.meter_number,
        metricKey: item.metric,
        metricLabel: item.metricInfo.title,
        status: 'rendering',
        attempt,
      });

      const data = await prepareChartData(item.meter.id, item.docs, item.metric);
      
      if (!data || data.length === 0) {
        throw new Error('No chart data available');
      }

      // Step 2: Set chart data and force render setup
      setChartData(data);
      setCurrentItem(item);
      setRenderReady(false);
      
      // Wait for React to process state updates
      await new Promise(resolve => setTimeout(resolve, RENDER_SETUP_DELAY_MS));
      
      // Signal render is ready
      setRenderReady(true);
      
      // Wait for chart to fully render
      await new Promise(resolve => setTimeout(resolve, RENDER_VERIFY_DELAY_MS));

      // Step 3: Verify chart is actually rendered
      let verified = false;
      let verifyAttempts = 0;
      const maxVerifyAttempts = 5;
      
      while (!verified && verifyAttempts < maxVerifyAttempts) {
        verified = verifyChartRendered();
        if (!verified) {
          verifyAttempts++;
          console.log(`[ChartCapture] Render verification attempt ${verifyAttempts}/${maxVerifyAttempts}`);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      if (!verified) {
        throw new Error('Chart failed to render after multiple verification attempts');
      }

      // Step 4: Capture the chart
      addLogEntry({
        meterNumber: item.meter.meter_number,
        metricKey: item.metric,
        metricLabel: item.metricInfo.title,
        status: 'capturing',
        attempt,
      });

      const chartElement = chartRef.current?.querySelector('.recharts-responsive-container');
      if (!chartElement) {
        throw new Error('Chart container not found for capture');
      }

      const canvas = await html2canvas(chartElement as HTMLElement, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        allowTaint: true,
        removeContainer: false,
      });

      // Verify canvas has content (not just white)
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hasContent = imageData.data.some((value, index) => {
          // Check non-alpha channels for non-white values
          if (index % 4 !== 3) return value !== 255;
          return false;
        });
        
        if (!hasContent) {
          throw new Error('Captured canvas appears to be empty');
        }
      }

      // Step 5: Save to storage
      const dataUrl = canvas.toDataURL('image/png');
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
        attempt,
        duration,
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
        attempt,
        error: errorMessage,
        duration,
      });

      return { success: false, error: errorMessage };
    }
  }, [siteId, addLogEntry, verifyChartRendered]);

  // Process queue with retry logic
  useEffect(() => {
    if (!isActive || queue.length === 0 || processingRef.current) return;

    const waitWhilePaused = async () => {
      while (pauseRef.current && !cancelRef.current) {
        onPauseStateChange?.(true);
        await new Promise(resolve => setTimeout(resolve, PAUSE_CHECK_INTERVAL_MS));
      }
      onPauseStateChange?.(false);
    };

    const processQueue = async () => {
      processingRef.current = true;
      captureLogRef.current = [];
      
      let successCount = 0;
      let failCount = 0;
      const failedItems: { item: CaptureQueueItem; index: number }[] = [];
      
      const totalBatches = Math.ceil(queue.length / BATCH_SIZE);

      console.log(`[ChartCapture] Starting capture of ${queue.length} charts in ${totalBatches} batches`);

      // First pass: process all items
      for (let i = 0; i < queue.length; i++) {
        if (cancelRef.current) {
          onComplete(successCount, failCount + failedItems.length, true, captureLogRef.current);
          processingRef.current = false;
          setCurrentItem(null);
          return;
        }

        await waitWhilePaused();

        if (cancelRef.current) {
          onComplete(successCount, failCount + failedItems.length, true, captureLogRef.current);
          processingRef.current = false;
          setCurrentItem(null);
          return;
        }

        const item = queue[i];
        const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
        const batchInfo = `Batch ${currentBatch}/${totalBatches}`;
        
        onProgress(i + 1, queue.length, item.meter.meter_number, item.metricInfo.title, batchInfo);

        // Attempt capture with retry
        let success = false;
        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS && !success; attempt++) {
          if (attempt > 1) {
            addLogEntry({
              meterNumber: item.meter.meter_number,
              metricKey: item.metric,
              metricLabel: item.metricInfo.title,
              status: 'retrying',
              attempt,
            });
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          }

          const result = await captureChart(item, attempt);
          success = result.success;
        }

        if (success) {
          successCount++;
        } else {
          failedItems.push({ item, index: i });
        }

        // Batch delay
        if ((i + 1) % BATCH_SIZE === 0 && i + 1 < queue.length) {
          console.log(`[ChartCapture] Completed batch ${currentBatch}/${totalBatches}, pausing...`);
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // Retry pass: re-attempt all failed items
      if (failedItems.length > 0 && !cancelRef.current) {
        console.log(`[ChartCapture] Starting retry pass for ${failedItems.length} failed items`);
        
        for (const { item, index } of failedItems) {
          if (cancelRef.current) break;
          await waitWhilePaused();
          if (cancelRef.current) break;

          onProgress(
            queue.length, 
            queue.length, 
            item.meter.meter_number, 
            item.metricInfo.title, 
            `Retry pass (${failedItems.indexOf({ item, index }) + 1}/${failedItems.length})`
          );

          // Extra retry attempts for previously failed items
          let success = false;
          for (let attempt = MAX_RETRY_ATTEMPTS + 1; attempt <= MAX_RETRY_ATTEMPTS + 2 && !success; attempt++) {
            addLogEntry({
              meterNumber: item.meter.meter_number,
              metricKey: item.metric,
              metricLabel: item.metricInfo.title,
              status: 'retrying',
              attempt,
            });
            
            // Longer delay before final retries
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * 2));
            
            const result = await captureChart(item, attempt);
            success = result.success;
          }

          if (success) {
            successCount++;
            // Remove from fail count since we had counted it earlier
          } else {
            failCount++;
          }
        }
      } else {
        failCount = failedItems.length;
      }

      console.log(`[ChartCapture] Complete: ${successCount} success, ${failCount} failed`);
      onComplete(successCount, failCount, false, captureLogRef.current);
      processingRef.current = false;
      setCurrentItem(null);
    };

    processQueue();
  }, [isActive, queue, captureChart, addLogEntry, onProgress, onComplete, onPauseStateChange, cancelRef, pauseRef]);

  if (!isActive || !currentItem) return null;

  const isConsumptionMetric = currentItem.metric.includes('consumption');

  return (
    <div 
      style={{ 
        position: 'fixed', 
        left: '-9999px', 
        top: '-9999px',
        width: '900px',
        height: '500px',
        backgroundColor: '#ffffff',
        pointerEvents: 'none',
        visibility: renderReady ? 'visible' : 'hidden',
      }}
    >
      <div ref={chartRef} style={{ width: '900px', height: '500px' }}>
        {chartData.length > 0 && (
          <ChartContainer
            config={{
              amount: {
                label: "Reconciliation",
                color: "hsl(var(--primary))",
              },
              documentAmount: {
                label: "Document Billed",
                color: "hsl(var(--muted-foreground))",
              },
            }}
            className="h-[500px] w-[900px]"
          >
            <ResponsiveContainer width={900} height={500}>
              <ComposedChart 
                data={chartData}
                margin={{ top: 20, right: 80, left: 60, bottom: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="period" 
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => {
                    if (isConsumptionMetric) {
                      return value.toLocaleString();
                    }
                    return `R${(value / 1000).toFixed(0)}k`;
                  }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend 
                  verticalAlign="top"
                  height={36}
                />
                <Bar 
                  dataKey="documentAmount" 
                  fill="hsl(var(--muted-foreground))"
                  name="Document Billed"
                  radius={[4, 4, 0, 0]}
                />
                <Line 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--primary))", strokeWidth: 2 }}
                  name="Reconciliation"
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import html2canvas from "html2canvas";
import { saveChartToStorage, CHART_METRICS, ChartMetricKey } from "@/lib/reconciliation/chartGeneration";
import { toast } from "sonner";
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

interface BackgroundChartCaptureProps {
  siteId: string;
  queue: CaptureQueueItem[];
  onProgress: (current: number, total: number, meterNumber: string, metric: string) => void;
  onComplete: (success: number, failed: number, cancelled: boolean) => void;
  cancelRef: React.MutableRefObject<boolean>;
  isActive: boolean;
}

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

// Helper to get metric label
const getMetricLabel = (metric: string): string => {
  switch(metric) {
    case 'total': return 'Total Amount';
    case 'basic': return 'Basic Charge';
    case 'kva-charge': return 'kVA Charge';
    case 'kwh-charge': return 'kWh Charge';
    case 'kva-consumption': return 'kVA Consumption';
    case 'kwh-consumption': return 'kWh Consumption';
    default: return 'Total Amount';
  }
};

// Prepare chart data for a meter and metric
const prepareChartData = async (
  meterId: string,
  docs: DocumentShopNumber[], 
  metric: string
) => {
  // Fetch reconciliation costs for this meter
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

  // Sort docs by period
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
  cancelRef,
  isActive,
}: BackgroundChartCaptureProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [currentItem, setCurrentItem] = useState<CaptureQueueItem | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [isRendered, setIsRendered] = useState(false);
  const processingRef = useRef(false);
  const currentIndexRef = useRef(0);
  const successCountRef = useRef(0);
  const failCountRef = useRef(0);

  // Process the queue
  useEffect(() => {
    if (!isActive || queue.length === 0 || processingRef.current) return;

    const processQueue = async () => {
      processingRef.current = true;
      currentIndexRef.current = 0;
      successCountRef.current = 0;
      failCountRef.current = 0;

      for (let i = 0; i < queue.length; i++) {
        if (cancelRef.current) {
          onComplete(successCountRef.current, failCountRef.current, true);
          processingRef.current = false;
          setCurrentItem(null);
          return;
        }

        currentIndexRef.current = i;
        const item = queue[i];
        
        onProgress(i + 1, queue.length, item.meter.meter_number, item.metricInfo.title);

        // Prepare chart data
        const data = await prepareChartData(item.meter.id, item.docs, item.metric);
        setChartData(data);
        setCurrentItem(item);
        setIsRendered(false);

        // Wait for chart to render
        await new Promise(resolve => setTimeout(resolve, 600));
        setIsRendered(true);
        await new Promise(resolve => setTimeout(resolve, 400));

        // Capture
        try {
          const chartElement = chartRef.current?.querySelector('.recharts-responsive-container');
          if (chartElement) {
            const canvas = await html2canvas(chartElement as HTMLElement, {
              backgroundColor: '#ffffff',
              scale: 2,
              logging: false,
              useCORS: true,
            });
            
            const dataUrl = canvas.toDataURL('image/png');
            const saved = await saveChartToStorage(
              siteId, 
              item.meter.meter_number, 
              item.metricInfo.filename, 
              dataUrl
            );
            
            if (saved) successCountRef.current++;
            else failCountRef.current++;
          } else {
            failCountRef.current++;
          }
        } catch (error) {
          console.error(`Error capturing ${item.metric} for ${item.meter.meter_number}:`, error);
          failCountRef.current++;
        }
      }

      onComplete(successCountRef.current, failCountRef.current, false);
      processingRef.current = false;
      setCurrentItem(null);
    };

    processQueue();
  }, [isActive, queue]);

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
      }}
    >
      <div ref={chartRef}>
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
          <ResponsiveContainer width="100%" height="100%">
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
      </div>
    </div>
  );
}

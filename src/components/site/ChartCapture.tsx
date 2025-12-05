import React, { useEffect, useState, useRef } from 'react';
import html2canvas from 'html2canvas';
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { 
  getMetersOnSchematic, 
  prepareMeterChartData, 
  CHART_METRICS,
  saveChartToStorage,
  type ChartMetricKey,
  type RechartsDataPoint
} from '@/lib/reconciliation';

interface ChartCaptureContainerProps {
  siteId: string;
  onComplete?: (result: { success: boolean; totalCharts: number; errors: string[] }) => void;
  onProgress?: (current: number, total: number, meterNumber: string) => void;
  trigger?: boolean;
}

interface ChartToRender {
  meterNumber: string;
  meterId: string;
  metricKey: ChartMetricKey;
  metricFilename: string;
  title: string;
  data: RechartsDataPoint[];
}

/**
 * Hidden container that renders and captures Recharts charts
 * Use the `trigger` prop to start the capture process
 */
export function ChartCaptureContainer({ 
  siteId, 
  onComplete, 
  onProgress,
  trigger = false 
}: ChartCaptureContainerProps) {
  const [charts, setCharts] = useState<ChartToRender[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  const chartRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const savedCount = useRef(0);
  const errors = useRef<string[]>([]);

  // Load all chart data when triggered
  useEffect(() => {
    if (!trigger || isProcessing) return;

    const loadChartData = async () => {
      setIsProcessing(true);
      savedCount.current = 0;
      errors.current = [];

      try {
        const meters = await getMetersOnSchematic(siteId);
        
        if (meters.length === 0) {
          onComplete?.({ success: true, totalCharts: 0, errors: [] });
          setIsProcessing(false);
          return;
        }

        const chartsToRender: ChartToRender[] = [];

        for (const meter of meters) {
          const chartDataMap = await prepareMeterChartData(siteId, meter.id, meter.meter_number);
          
          for (const metric of CHART_METRICS) {
            const chartInfo = chartDataMap.get(metric.key);
            if (chartInfo && chartInfo.data.length > 0) {
              chartsToRender.push({
                meterNumber: meter.meter_number,
                meterId: meter.id,
                metricKey: metric.key,
                metricFilename: metric.filename,
                title: chartInfo.title,
                data: chartInfo.data,
              });
            }
          }
        }

        setCharts(chartsToRender);
        setCurrentIndex(0);
      } catch (error) {
        console.error('Failed to load chart data:', error);
        onComplete?.({ success: false, totalCharts: 0, errors: [`Failed to load chart data: ${error}`] });
        setIsProcessing(false);
      }
    };

    loadChartData();
  }, [trigger, siteId, onComplete, isProcessing]);

  // Capture charts one by one
  useEffect(() => {
    if (currentIndex < 0 || currentIndex >= charts.length || !isProcessing) return;

    const captureCurrentChart = async () => {
      const chart = charts[currentIndex];
      const key = `${chart.meterNumber}-${chart.metricKey}`;
      const element = chartRefs.current.get(key);

      onProgress?.(currentIndex + 1, charts.length, chart.meterNumber);

      if (element) {
        // Wait for chart to fully render
        await new Promise(resolve => setTimeout(resolve, 300));

        try {
          const canvas = await html2canvas(element, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true,
          });

          const dataUrl = canvas.toDataURL('image/png');
          const saved = await saveChartToStorage(
            siteId, 
            chart.meterNumber, 
            chart.metricFilename, 
            dataUrl
          );

          if (saved) {
            savedCount.current++;
          } else {
            errors.current.push(`Failed to save ${chart.meterNumber}-${chart.metricFilename}`);
          }
        } catch (error) {
          console.error(`Failed to capture chart ${key}:`, error);
          errors.current.push(`Failed to capture ${chart.meterNumber}-${chart.metricFilename}`);
        }
      }

      // Move to next chart or complete
      if (currentIndex + 1 >= charts.length) {
        onComplete?.({
          success: errors.current.length === 0,
          totalCharts: savedCount.current,
          errors: errors.current,
        });
        setIsProcessing(false);
        setCharts([]);
        setCurrentIndex(-1);
      } else {
        setCurrentIndex(prev => prev + 1);
      }
    };

    captureCurrentChart();
  }, [currentIndex, charts, siteId, onComplete, onProgress, isProcessing]);

  if (!isProcessing || charts.length === 0) {
    return null;
  }

  // Only render the current chart to save memory
  const currentChart = charts[currentIndex];
  if (!currentChart) return null;

  const key = `${currentChart.meterNumber}-${currentChart.metricKey}`;

  return (
    <div 
      style={{
        position: 'fixed',
        left: '-9999px',
        top: 0,
        width: '600px',
        zIndex: -1,
        pointerEvents: 'none',
      }}
    >
      <div 
        ref={(el) => {
          if (el) chartRefs.current.set(key, el);
        }}
        style={{
          width: '600px',
          height: '400px',
          backgroundColor: '#ffffff',
          padding: '16px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#000' }}>
          {currentChart.title}
        </div>
        <ChartContainer
          config={{
            amount: {
              label: "Reconciliation Cost",
              color: "hsl(220 13% 69%)",
            },
            documentAmount: {
              label: "Document Billed",
              color: "hsl(221.2 83.2% 53.3%)",
            },
          }}
          className="h-[340px] w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={currentChart.data} margin={{ top: 10, right: 20, left: 10, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="period" 
                angle={-45}
                textAnchor="end"
                height={70}
                tick={{ fontSize: 11, fill: '#374151' }}
              />
              <YAxis 
                tickFormatter={(value) => `R ${value.toLocaleString()}`}
                tick={{ fontSize: 11, fill: '#374151' }}
                width={80}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar 
                dataKey="amount" 
                fill="#9ca3af"
                radius={[4, 4, 0, 0]}
                name="Reconciliation Cost"
              />
              <Bar 
                dataKey="documentAmount" 
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                name="Document Billed"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </div>
  );
}

export default ChartCaptureContainer;

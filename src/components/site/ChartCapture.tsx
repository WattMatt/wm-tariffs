import React, { useEffect, useState, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';
import { MeterAnalysisChart, type MeterChartDataPoint } from './MeterAnalysisChart';
import { 
  getMetersOnSchematic, 
  prepareMeterChartData, 
  CHART_METRICS,
  saveChartToStorage,
  type ChartMetricKey,
} from '@/lib/reconciliation';
import { supabase } from '@/integrations/supabase/client';
import { buildConnectionsMap, getHierarchyDepth } from '@/lib/reconciliation/hierarchyUtils';

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
  data: MeterChartDataPoint[];
  isConsumptionMetric: boolean;
  isKvaMetric: boolean;
}

interface MeterWithOrder {
  id: string;
  meter_number: string;
  depth: number;
  order: number;
}

/**
 * Get meters sorted by hierarchy order (Council -> Bulk -> Check -> Tenant)
 */
async function getMetersInHierarchyOrder(siteId: string): Promise<MeterWithOrder[]> {
  // Get all meters on schematic
  const meters = await getMetersOnSchematic(siteId);
  if (meters.length === 0) return [];

  // Get meter connections
  const { data: connections } = await supabase
    .from('meter_connections')
    .select('parent_meter_id, child_meter_id')
    .or(`parent_meter_id.in.(${meters.map(m => m.id).join(',')}),child_meter_id.in.(${meters.map(m => m.id).join(',')})`);

  const connectionsMap = buildConnectionsMap(connections || []);

  // Calculate hierarchy depth for each meter (higher depth = deeper in hierarchy)
  const metersWithDepth = meters.map(meter => ({
    ...meter,
    depth: getHierarchyDepth(meter.id, connectionsMap),
  }));

  // Sort: shallowest first (parents before children), then by meter number
  metersWithDepth.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.meter_number.localeCompare(b.meter_number);
  });

  return metersWithDepth.map((m, idx) => ({ ...m, order: idx }));
}

/**
 * Chart capture container that renders charts using the exact same component
 * as TariffAssignmentTab and captures them as images.
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
  const chartRef = useRef<HTMLDivElement>(null);
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
        // Get meters in hierarchy order
        const meters = await getMetersInHierarchyOrder(siteId);
        
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
              const isConsumptionMetric = metric.key.includes('consumption');
              const isKvaMetric = metric.key.includes('kva');
              
              chartsToRender.push({
                meterNumber: meter.meter_number,
                meterId: meter.id,
                metricKey: metric.key,
                metricFilename: metric.filename,
                title: chartInfo.title,
                data: chartInfo.data,
                isConsumptionMetric,
                isKvaMetric,
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

      onProgress?.(currentIndex + 1, charts.length, chart.meterNumber);

      // Wait for chart to fully render (Recharts animations)
      await new Promise(resolve => setTimeout(resolve, 500));

      if (chartRef.current) {
        try {
          const canvas = await html2canvas(chartRef.current, {
            backgroundColor: '#ffffff',
            scale: 3, // Higher resolution for quality
            logging: false,
            useCORS: true,
            allowTaint: true,
            // Ensure SVG elements are captured properly
            onclone: (clonedDoc) => {
              const charts = clonedDoc.querySelectorAll('.recharts-wrapper');
              charts.forEach(chart => {
                (chart as HTMLElement).style.overflow = 'visible';
              });
            },
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
          console.error(`Failed to capture chart:`, error);
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

  if (!isProcessing || charts.length === 0 || currentIndex < 0) {
    return null;
  }

  const currentChart = charts[currentIndex];
  if (!currentChart) return null;

  // Get metric label
  const metricLabels: Record<string, string> = {
    'total': 'Total Amount',
    'basic': 'Basic Charge',
    'kva-charge': 'kVA Charge',
    'kwh-charge': 'kWh Charge',
    'kva-consumption': 'kVA Consumption',
    'kwh-consumption': 'kWh Consumption',
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '800px',
        height: '500px',
        zIndex: 9999,
        visibility: 'hidden', // Hidden but properly laid out for SVG rendering
        pointerEvents: 'none',
      }}
    >
      <div
        ref={chartRef}
        style={{
          width: '800px',
          height: '500px',
          backgroundColor: '#ffffff',
          padding: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Chart Title */}
        <div style={{ 
          fontSize: '16px', 
          fontWeight: 600, 
          marginBottom: '16px', 
          color: '#1f2937',
          textAlign: 'center',
        }}>
          {currentChart.meterNumber} - {metricLabels[currentChart.metricKey] || currentChart.metricKey}
        </div>
        
        {/* Chart Component - exact same as UI */}
        <MeterAnalysisChart
          data={currentChart.data}
          metricLabel={metricLabels[currentChart.metricKey] || currentChart.metricKey}
          meterNumber={currentChart.meterNumber}
          height={420}
          showLegend={true}
          showSeasonalAverages={false}
          isConsumptionMetric={currentChart.isConsumptionMetric}
          isKvaMetric={currentChart.isKvaMetric}
        />
      </div>
    </div>
  );
}

export default ChartCaptureContainer;

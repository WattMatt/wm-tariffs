import { useCallback, useState } from 'react';
import html2canvas from 'html2canvas';
import { 
  getMetersOnSchematic, 
  prepareMeterChartData, 
  CHART_METRICS,
  saveChartToStorage,
  type ChartMetricKey 
} from '@/lib/reconciliation';

interface ChartCaptureProgress {
  current: number;
  total: number;
  meterNumber: string;
  metric: string;
}

interface UseChartCaptureReturn {
  isCapturing: boolean;
  progress: ChartCaptureProgress | null;
  captureAndSaveCharts: (siteId: string) => Promise<{ success: boolean; totalCharts: number; errors: string[] }>;
  captureChartElement: (element: HTMLElement) => Promise<string | null>;
}

/**
 * Hook for capturing Recharts as images using html2canvas
 */
export function useChartCapture(): UseChartCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [progress, setProgress] = useState<ChartCaptureProgress | null>(null);

  /**
   * Capture a single chart element as a base64 PNG data URL
   */
  const captureChartElement = useCallback(async (element: HTMLElement): Promise<string | null> => {
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher resolution
        logging: false,
        useCORS: true,
        allowTaint: true,
      });
      
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Failed to capture chart element:', error);
      return null;
    }
  }, []);

  /**
   * Orchestrate chart capture for all meters on a site
   * Note: This requires the charts to be rendered in the DOM first
   */
  const captureAndSaveCharts = useCallback(async (
    siteId: string
  ): Promise<{ success: boolean; totalCharts: number; errors: string[] }> => {
    setIsCapturing(true);
    const errors: string[] = [];
    let totalCharts = 0;

    try {
      const meters = await getMetersOnSchematic(siteId);
      
      if (meters.length === 0) {
        setIsCapturing(false);
        return { success: true, totalCharts: 0, errors: [] };
      }

      const totalOperations = meters.length * CHART_METRICS.length;
      let currentOperation = 0;

      for (const meter of meters) {
        // Prepare chart data for this meter
        const chartDataMap = await prepareMeterChartData(siteId, meter.id, meter.meter_number);
        
        for (const metric of CHART_METRICS) {
          currentOperation++;
          setProgress({
            current: currentOperation,
            total: totalOperations,
            meterNumber: meter.meter_number,
            metric: metric.title,
          });

          const chartInfo = chartDataMap.get(metric.key);
          if (!chartInfo || chartInfo.data.length === 0) {
            continue;
          }

          // Look for rendered chart in DOM by data attribute
          const chartSelector = `[data-chart-meter="${meter.meter_number}"][data-chart-metric="${metric.key}"]`;
          const chartElement = document.querySelector(chartSelector) as HTMLElement;
          
          if (chartElement) {
            const dataUrl = await captureChartElement(chartElement);
            if (dataUrl) {
              const saved = await saveChartToStorage(siteId, meter.meter_number, metric.filename, dataUrl);
              if (saved) {
                totalCharts++;
              } else {
                errors.push(`Failed to save ${meter.meter_number}-${metric.filename}`);
              }
            }
          } else {
            // Chart not rendered - skip silently
            console.log(`Chart element not found: ${chartSelector}`);
          }
        }
      }

      return { success: errors.length === 0, totalCharts, errors };
    } catch (error) {
      const errorMsg = `Chart capture failed: ${error}`;
      console.error(errorMsg);
      return { success: false, totalCharts, errors: [errorMsg] };
    } finally {
      setIsCapturing(false);
      setProgress(null);
    }
  }, [captureChartElement]);

  return {
    isCapturing,
    progress,
    captureAndSaveCharts,
    captureChartElement,
  };
}

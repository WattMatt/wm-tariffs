/**
 * Chart capture infrastructure exports
 * 
 * This module provides reusable utilities for generating and saving chart images:
 * - types.ts: Generic interfaces for chart capture configuration
 * - canvasRenderer.ts: Canvas-based chart rendering functions
 * - storage.ts: Storage upload/download utilities
 * 
 * Usage example:
 * ```typescript
 * import { generateBarChart, uploadChartImage, type ChartDataPoint } from '@/lib/charts';
 * 
 * const data: ChartDataPoint[] = [
 *   { label: 'Jan', values: { sales: 100, costs: 50 } },
 *   { label: 'Feb', values: { sales: 150, costs: 60 } },
 * ];
 * 
 * const dataUrl = generateBarChart(data, {
 *   title: 'Monthly Performance',
 *   unit: 'R',
 *   seriesKeys: ['sales', 'costs'],
 *   seriesLabels: { sales: 'Sales', costs: 'Costs' },
 *   seriesColors: { sales: '#3b82f6', costs: '#9ca3af' },
 * });
 * 
 * await uploadChartImage({ bucket: 'client-files', path: 'charts/monthly.png' }, dataUrl);
 * ```
 */

// Types
export type {
  ChartMetric,
  ChartDataPoint,
  StoragePath,
  ChartCaptureConfig,
  ChartCaptureItem,
  CaptureLogEntry,
  ItemCaptureResult,
  ChartCaptureProgress,
  ChartRenderOptions,
  ChartRenderFunction,
  ItemGroup,
} from './types';

// Canvas rendering
export {
  generateBarChart,
  generateComboChart,
  dataURLtoBlob,
  type BarChartOptions,
  type ComboChartOptions,
} from './canvasRenderer';

// SVG rendering
export {
  generateBarChartSVG,
  generateComboChartSVG,
  generateReconciliationMeterChartSVG,
  generateAnalysisMeterChartSVG,
  type BarChartSVGOptions,
  type ComboChartSVGOptions,
  type ReconciliationChartDataPointSVG,
  type AnalysisChartDataPointSVG,
} from './svgRenderer';

// Storage utilities
export {
  uploadChartImage,
  uploadChartBatch,
  deleteChartImage,
  getChartPublicUrl,
  type UploadResult,
  type BatchUploadResult,
  type ChartFormat,
} from './storage';

// Tariff chart generation
export {
  TARIFF_CHART_METRICS,
  generateTariffChartPath,
  fetchTariffCharges,
  processTariffComparisonData,
  generateTariffComparisonChart,
  captureTariffGroupCharts,
  type TariffCaptureResult,
} from './tariffChartGeneration';

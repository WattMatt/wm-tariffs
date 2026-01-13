/**
 * Chart capture infrastructure exports
 * 
 * This module provides reusable utilities for generating and saving chart images:
 * - types.ts: Generic interfaces for chart capture configuration
 * - svgRenderer.ts: SVG-based chart rendering functions (primary)
 * - storage.ts: Storage upload/download utilities
 * 
 * All chart generation now uses SVG for consistent quality and smaller file sizes.
 * 
 * Usage example:
 * ```typescript
 * import { generateBarChartSVG, uploadChartImage, type ChartDataPoint } from '@/lib/charts';
 * 
 * const data: ChartDataPoint[] = [
 *   { label: 'Jan', values: { sales: 100, costs: 50 } },
 *   { label: 'Feb', values: { sales: 150, costs: 60 } },
 * ];
 * 
 * const svg = generateBarChartSVG(data, {
 *   title: 'Monthly Performance',
 *   unit: 'R',
 *   seriesKeys: ['sales', 'costs'],
 *   seriesLabels: { sales: 'Sales', costs: 'Costs' },
 *   seriesColors: { sales: '#3b82f6', costs: '#9ca3af' },
 * });
 * 
 * const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
 * await uploadChartImage({ bucket: 'client-files', path: 'charts/monthly.svg' }, dataUrl);
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

// SVG rendering (primary chart generation)
export {
  generateBarChartSVG,
  generateComboChartSVG,
  generateReconciliationMeterChartSVG,
  generateAnalysisMeterChartSVG,
  generateAssignmentChartSVG,
  generatePieChartSVG,
  generateClusteredTariffChartSVG,
  generateTariffComparisonChartSVG,
  generateDocumentVsAssignedChartSVG,
  generateReconciliationVsDocumentChartSVG,
  generateTariffAnalysisChartSVG,
  type BarChartSVGOptions,
  type ComboChartSVGOptions,
  type ReconciliationChartDataPointSVG,
  type AnalysisChartDataPointSVG,
  type AssignmentChartDataPointSVG,
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

// Legacy canvas rendering (deprecated - use SVG functions instead)
// These are kept for backward compatibility but will be removed in a future version
export {
  generateBarChart,
  generateComboChart,
  dataURLtoBlob,
  type BarChartOptions,
  type ComboChartOptions,
} from './canvasRenderer';

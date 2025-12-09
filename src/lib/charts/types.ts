/**
 * Generic chart capture types for reusable chart generation and saving
 */

export interface ChartMetric {
  key: string;
  title: string;
  unit: string;
  filename: string;
}

export interface ChartDataPoint {
  label: string;  // X-axis label (e.g., period, date)
  values: Record<string, number | null>;  // Key-value pairs for each series
}

export interface StoragePath {
  bucket: string;
  path: string;
}

export interface ChartCaptureConfig<TItem = unknown> {
  metrics: ChartMetric[];
  storagePathGenerator: (siteId: string, itemId: string, metricFilename: string) => Promise<StoragePath> | StoragePath;
  parallelBatchSize?: number;  // Default: 3
  pauseCheckInterval?: number; // Default: 100ms
}

export interface ChartCaptureItem<TItem = unknown> {
  item: TItem;
  itemId: string;
  itemLabel: string;
  metric: ChartMetric;
  docs?: unknown[];  // Optional associated documents
}

export interface CaptureLogEntry {
  timestamp: string;
  itemId: string;
  itemLabel: string;
  metricKey: string;
  metricLabel: string;
  status: 'pending' | 'rendering' | 'capturing' | 'success' | 'failed' | 'retrying' | 'item_complete';
  attempt: number;
  error?: string;
  duration?: number;
  itemIndex?: number;
  totalItems?: number;
}

export interface ItemCaptureResult {
  itemId: string;
  itemLabel: string;
  chartsAttempted: number;
  chartsSuccessful: number;
  chartsFailed: number;
  failedMetrics: string[];
  duration: number;
}

export interface ChartCaptureProgress {
  currentItem: number;
  totalItems: number;
  currentChart: number;
  totalCharts: number;
  currentBatch: number;
  totalBatches: number;
  percentComplete: number;
  isPaused: boolean;
  currentItemLabel: string;
  currentMetricLabel: string;
}

export interface ChartRenderOptions {
  width?: number;
  height?: number;
  scaleFactor?: number;
  colors?: {
    primary?: string;
    secondary?: string;
    tertiary?: string;
    background?: string;
    text?: string;
    grid?: string;
  };
  showLegend?: boolean;
  showGrid?: boolean;
  showValues?: boolean;
}

// Specific render function type - can render any data to a data URL
export type ChartRenderFunction<TItem = unknown> = (
  item: TItem,
  metric: ChartMetric,
  docs: unknown[],
  options?: ChartRenderOptions
) => Promise<string> | string;

// Grouped items for batch processing
export interface ItemGroup<TItem = unknown> {
  item: TItem;
  itemId: string;
  itemLabel: string;
  captureItems: ChartCaptureItem<TItem>[];
}

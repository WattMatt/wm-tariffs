import { uploadChartImage, type StoragePath } from '@/lib/charts';
import { generateStoragePath } from '@/lib/storagePaths';

// Chart types for different tabs
export type ChartType = 'analysis' | 'comparison' | 'assignment';

// Re-export chart metrics for reconciliation - using generic chart infrastructure
export const CHART_METRICS = [
  { key: 'total', title: 'Total Amount', unit: 'R', filename: 'total' },
  { key: 'basic', title: 'Basic Charge', unit: 'R', filename: 'basic' },
  { key: 'kva-charge', title: 'kVA Charge', unit: 'R', filename: 'kva-charge' },
  { key: 'kwh-charge', title: 'kWh Charge', unit: 'R', filename: 'kwh-charge' },
  { key: 'kva-consumption', title: 'kVA Consumption', unit: 'kVA', filename: 'kva-consumption' },
  { key: 'kwh-consumption', title: 'kWh Consumption', unit: 'kWh', filename: 'kwh-consumption' },
] as const;

// Assignment-specific metrics (rate comparisons)
export const ASSIGNMENT_METRICS = [
  { key: 'basic-rate', title: 'Basic Charge Rate', unit: 'R/month', filename: 'basic-rate' },
  { key: 'energy-rate', title: 'Energy Rate', unit: 'R/kWh', filename: 'energy-rate' },
  { key: 'demand-rate', title: 'Demand Rate', unit: 'R/kVA', filename: 'demand-rate' },
] as const;

export type ChartMetricKey = typeof CHART_METRICS[number]['key'];
export type AssignmentMetricKey = typeof ASSIGNMENT_METRICS[number]['key'];

// Storage subfolder paths for each chart type
const CHART_STORAGE_PATHS = {
  analysis: 'Reconciliations/Graphs/Analysis',
  comparison: 'Reconciliations/Graphs/Comparison',
  assignment: 'Reconciliations/Graphs/Assignment',
} as const;

/**
 * Get storage subfolder path for chart type
 */
export function getChartStorageSubpath(chartType: ChartType): string {
  return CHART_STORAGE_PATHS[chartType];
}

/**
 * Generate storage path for reconciliation/comparison chart (now .svg)
 */
export async function generateReconciliationChartPath(
  siteId: string,
  meterNumber: string,
  metricFilename: string
): Promise<StoragePath> {
  const fileName = `${meterNumber}-${metricFilename}.svg`;
  return await generateStoragePath(
    siteId,
    'Metering',
    CHART_STORAGE_PATHS.comparison,
    fileName
  );
}

/**
 * Generate storage path for analysis chart (now .svg)
 */
export async function generateAnalysisChartPath(
  siteId: string,
  meterNumber: string,
  metricFilename: string
): Promise<StoragePath> {
  const fileName = `${meterNumber}-${metricFilename}.svg`;
  return await generateStoragePath(
    siteId,
    'Metering',
    CHART_STORAGE_PATHS.analysis,
    fileName
  );
}

/**
 * Generate storage path for any chart type (now .svg)
 */
export async function generateChartPath(
  siteId: string,
  meterNumber: string,
  metricFilename: string,
  chartType: ChartType = 'comparison'
): Promise<StoragePath> {
  const fileName = `${meterNumber}-${metricFilename}.svg`;
  return await generateStoragePath(
    siteId,
    'Metering',
    CHART_STORAGE_PATHS[chartType],
    fileName
  );
}

/**
 * Save a single chart image to storage (legacy wrapper using new infrastructure)
 */
/**
 * Save a single chart SVG to storage (legacy wrapper using new infrastructure)
 */
export async function saveChartToStorage(
  siteId: string,
  meterNumber: string,
  metricFilename: string,
  chartSvgContent: string,
  chartType: ChartType = 'comparison'
): Promise<boolean> {
  try {
    const storagePath = await generateChartPath(siteId, meterNumber, metricFilename, chartType);
    const result = await uploadChartImage(storagePath, chartSvgContent, 'svg');
    
    if (!result.success) {
      console.error(`Failed to save chart ${meterNumber}-${metricFilename}:`, result.error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error saving chart for ${meterNumber}-${metricFilename}:`, error);
    return false;
  }
}

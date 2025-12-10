/**
 * Tariff chart generation utilities
 * Generates comparison charts for tariff structures across periods
 */

import { generateBarChart, type BarChartOptions } from './canvasRenderer';
import { uploadChartImage } from './storage';
import { supabase } from '@/integrations/supabase/client';
import type { ChartDataPoint, StoragePath, ChartMetric } from './types';

// Chart metrics for tariff comparison (matching TariffPeriodComparisonDialog.CHARGE_TYPES)
export const TARIFF_CHART_METRICS: ChartMetric[] = [
  { key: 'basic_charge', title: 'Basic Charge', unit: 'R/month', filename: 'basic-charge' },
  { key: 'energy_low_season', title: 'Energy Charge - Low Season', unit: 'c/kWh', filename: 'energy-low-season' },
  { key: 'energy_high_season', title: 'Energy Charge - High Season', unit: 'c/kWh', filename: 'energy-high-season' },
  { key: 'demand_low_season', title: 'Demand Charge - Low Season', unit: 'R/kVA', filename: 'demand-low-season' },
  { key: 'demand_high_season', title: 'Demand Charge - High Season', unit: 'R/kVA', filename: 'demand-high-season' },
];

interface TariffCharge {
  id: string;
  tariff_structure_id: string;
  charge_type: string;
  charge_amount: number;
  unit: string;
  description: string | null;
}

interface TariffStructure {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
}

interface TariffComparisonData {
  period: string;
  effectiveFrom: string;
  [key: string]: string | number | null;
}

/**
 * Generate storage path for a tariff chart
 */
export function generateTariffChartPath(
  province: string,
  municipality: string,
  tariffName: string,
  metricFilename: string
): StoragePath {
  // Sanitize names for file paths - handle special Unicode characters
  const sanitize = (str: string) => str
    .replace(/≥/g, 'gte')           // greater than or equal
    .replace(/≤/g, 'lte')           // less than or equal
    .replace(/&/g, 'and')           // ampersand
    .replace(/[/\\?%*:|"<>]/g, '-') // standard invalid chars
    .replace(/[^\x00-\x7F]/g, '')   // remove any remaining non-ASCII
    .trim();
  
  return {
    bucket: 'tariff-files',
    path: `Tariffs/${sanitize(province)}/${sanitize(municipality)}/${sanitize(tariffName)}-${metricFilename}.png`,
  };
}

/**
 * Fetch tariff charges for multiple structure IDs
 */
export async function fetchTariffCharges(structureIds: string[]): Promise<TariffCharge[]> {
  const { data, error } = await supabase
    .from('tariff_charges')
    .select('*')
    .in('tariff_structure_id', structureIds);

  if (error) {
    console.error('Error fetching tariff charges:', error);
    return [];
  }

  return data || [];
}

/**
 * Process tariff structures and charges into comparison data
 */
export function processTariffComparisonData(
  structures: TariffStructure[],
  charges: TariffCharge[]
): TariffComparisonData[] {
  // Sort structures by effective date
  const sortedStructures = [...structures].sort(
    (a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime()
  );

  return sortedStructures.map(structure => {
    const structureCharges = charges.filter(c => c.tariff_structure_id === structure.id);
    
    // Format period label
    const fromDate = new Date(structure.effective_from);
    const periodLabel = fromDate.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });

    // Build data point with all charge types
    const dataPoint: TariffComparisonData = {
      period: periodLabel,
      effectiveFrom: structure.effective_from,
    };

    // Basic charge
    const basicCharge = structureCharges.find(c => c.charge_type === 'basic_charge');
    dataPoint.basic_charge = basicCharge?.charge_amount ?? null;

    // Energy charges - support both explicit and legacy formats
    const energyLow = structureCharges.find(
      c => c.charge_type === 'energy_low_season' || 
           (c.charge_type === 'seasonal_energy' && c.description?.toLowerCase().includes('low'))
    );
    const energyHigh = structureCharges.find(
      c => c.charge_type === 'energy_high_season' || 
           (c.charge_type === 'seasonal_energy' && c.description?.toLowerCase().includes('high'))
    );
    dataPoint.energy_low_season = energyLow?.charge_amount ?? null;
    dataPoint.energy_high_season = energyHigh?.charge_amount ?? null;

    // Demand charges - support both explicit and legacy formats
    const demandLow = structureCharges.find(
      c => c.charge_type === 'demand_low_season' || 
           (c.charge_type === 'demand_charge' && c.description?.toLowerCase().includes('low'))
    );
    const demandHigh = structureCharges.find(
      c => c.charge_type === 'demand_high_season' || 
           (c.charge_type === 'demand_charge' && c.description?.toLowerCase().includes('high'))
    );
    dataPoint.demand_low_season = demandLow?.charge_amount ?? null;
    dataPoint.demand_high_season = demandHigh?.charge_amount ?? null;

    return dataPoint;
  });
}

/**
 * Calculate percentage changes for a metric
 */
function calculatePercentageChanges(
  data: TariffComparisonData[],
  metricKey: string
): { totalChange: number | null; avgYoyChange: number | null } {
  const values = data
    .map(d => d[metricKey])
    .filter((v): v is number => v !== null && v !== undefined);
  
  if (values.length < 2) {
    return { totalChange: null, avgYoyChange: null };
  }
  
  const firstValue = values[0];
  const lastValue = values[values.length - 1];
  
  // Avoid division by zero
  if (firstValue === 0) {
    return { totalChange: null, avgYoyChange: null };
  }
  
  const totalChange = ((lastValue - firstValue) / firstValue) * 100;
  
  // Calculate average year-on-year change
  let totalYoyChange = 0;
  let validYoyCount = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] !== 0) {
      totalYoyChange += ((values[i] - values[i - 1]) / values[i - 1]) * 100;
      validYoyCount++;
    }
  }
  const avgYoyChange = validYoyCount > 0 ? totalYoyChange / validYoyCount : null;
  
  return { totalChange, avgYoyChange };
}

/**
 * Generate a single tariff comparison chart
 */
export function generateTariffComparisonChart(
  data: TariffComparisonData[],
  metric: ChartMetric
): string | null {
  // Filter data to only periods with values for this metric
  const filteredData = data.filter(d => d[metric.key] !== null && d[metric.key] !== undefined);
  
  if (filteredData.length === 0) {
    return null;
  }

  // Calculate percentage changes
  const { totalChange, avgYoyChange } = calculatePercentageChanges(filteredData, metric.key);

  const chartData: ChartDataPoint[] = filteredData.map(d => ({
    label: d.period,
    values: { [metric.key]: d[metric.key] as number },
  }));

  const chartOptions: BarChartOptions = {
    title: metric.title,
    unit: metric.unit,
    seriesKeys: [metric.key],
    seriesLabels: { [metric.key]: metric.title },
    seriesColors: { [metric.key]: '#9ca3af' },  // Gray to match UI
    width: 600,
    height: 400,
    scaleFactor: 2,
    showLegend: false,
    showGrid: true,
    showValues: true,
    percentChange: totalChange,
    avgYoyChange: avgYoyChange,
  };

  try {
    return generateBarChart(chartData, chartOptions);
  } catch (error) {
    console.error(`Error generating chart for ${metric.key}:`, error);
    return null;
  }
}

export interface TariffCaptureResult {
  tariffName: string;
  metricKey: string;
  success: boolean;
  skipped?: boolean;  // True when no data available (not an error)
  error?: string;
}

/**
 * Capture all charts for a single tariff group
 */
export async function captureTariffGroupCharts(
  province: string,
  municipality: string,
  tariffName: string,
  structures: TariffStructure[],
  charges: TariffCharge[]
): Promise<TariffCaptureResult[]> {
  const results: TariffCaptureResult[] = [];
  
  // Process comparison data
  const comparisonData = processTariffComparisonData(structures, charges);
  
  if (comparisonData.length < 2) {
    // Need at least 2 periods for comparison - mark as skipped, not failed
    return TARIFF_CHART_METRICS.map(metric => ({
      tariffName,
      metricKey: metric.key,
      success: false,
      skipped: true,
      error: 'Less than 2 periods available',
    }));
  }

  // Generate and upload each chart
  for (const metric of TARIFF_CHART_METRICS) {
    try {
      const chartDataUrl = generateTariffComparisonChart(comparisonData, metric);
      
      if (!chartDataUrl) {
        results.push({
          tariffName,
          metricKey: metric.key,
          success: false,
          skipped: true,  // No data is expected, not an error
          error: 'No data available for this metric',
        });
        continue;
      }

      const storagePath = generateTariffChartPath(province, municipality, tariffName, metric.filename);
      const uploadResult = await uploadChartImage(storagePath, chartDataUrl);

      results.push({
        tariffName,
        metricKey: metric.key,
        success: uploadResult.success,
        error: uploadResult.error,
      });
    } catch (error: any) {
      results.push({
        tariffName,
        metricKey: metric.key,
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  }

  return results;
}

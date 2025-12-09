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
  // Sanitize names for file paths
  const sanitize = (str: string) => str.replace(/[/\\?%*:|"<>]/g, '-').trim();
  
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

    // Energy charges (seasonal)
    const energyLow = structureCharges.find(
      c => c.charge_type === 'seasonal_energy' && c.description?.toLowerCase().includes('low')
    );
    const energyHigh = structureCharges.find(
      c => c.charge_type === 'seasonal_energy' && c.description?.toLowerCase().includes('high')
    );
    dataPoint.energy_low_season = energyLow?.charge_amount ?? null;
    dataPoint.energy_high_season = energyHigh?.charge_amount ?? null;

    // Demand charges (seasonal)
    const demandLow = structureCharges.find(
      c => c.charge_type === 'demand_charge' && c.description?.toLowerCase().includes('low')
    );
    const demandHigh = structureCharges.find(
      c => c.charge_type === 'demand_charge' && c.description?.toLowerCase().includes('high')
    );
    dataPoint.demand_low_season = demandLow?.charge_amount ?? null;
    dataPoint.demand_high_season = demandHigh?.charge_amount ?? null;

    return dataPoint;
  });
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

  const chartData: ChartDataPoint[] = filteredData.map(d => ({
    label: d.period,
    values: { [metric.key]: d[metric.key] as number },
  }));

  const chartOptions: BarChartOptions = {
    title: metric.title,
    unit: metric.unit,
    seriesKeys: [metric.key],
    seriesLabels: { [metric.key]: metric.title },
    seriesColors: { [metric.key]: '#3b82f6' },
    width: 600,
    height: 400,
    scaleFactor: 2,
    showLegend: false,
    showGrid: true,
    showValues: true,
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
    // Need at least 2 periods for comparison
    return TARIFF_CHART_METRICS.map(metric => ({
      tariffName,
      metricKey: metric.key,
      success: false,
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

import { supabase } from '@/integrations/supabase/client';
import { generateStoragePath } from '@/lib/storagePaths';
import { generateTariffAnalysisChart } from '@/components/site/ChartGenerator';
import { formatDateStringToMonthYear, getMonthFromDateString } from '@/lib/utils';

// Chart metrics configuration
export const CHART_METRICS = [
  { key: 'total', title: 'Total Amount', unit: 'R', filename: 'total' },
  { key: 'basic', title: 'Basic Charge', unit: 'R', filename: 'basic' },
  { key: 'kva-charge', title: 'kVA Charge', unit: 'R', filename: 'kva-charge' },
  { key: 'kwh-charge', title: 'kWh Charge', unit: 'R', filename: 'kwh-charge' },
  { key: 'kva-consumption', title: 'kVA Consumption', unit: 'kVA', filename: 'kva-consumption' },
  { key: 'kwh-consumption', title: 'kWh Consumption', unit: 'kWh', filename: 'kwh-consumption' },
] as const;

export type ChartMetricKey = typeof CHART_METRICS[number]['key'];

interface DocumentLineItem {
  description: string;
  meter_number?: string;
  unit?: 'kWh' | 'kVA' | 'Monthly';
  supply?: 'Normal' | 'Emergency';
  previous_reading?: number;
  current_reading?: number;
  consumption?: number;
  rate?: number;
  amount: number;
}

interface DocumentData {
  documentId: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  lineItems?: DocumentLineItem[];
}

interface ReconciliationCostData {
  period_start: string;
  period_end: string;
  total_cost: number;
  energy_cost: number;
  fixed_charges: number;
  demand_charges: number;
  total_kwh: number;
}

interface ChartDataPoint {
  period: string;
  value: number;
  winterAvg?: number;
  summerAvg?: number;
}

/**
 * Get all meters that have been placed on a schematic for this site
 */
export async function getMetersOnSchematic(siteId: string): Promise<Array<{ id: string; meter_number: string }>> {
  // Get all schematics for this site
  const { data: schematics, error: schematicError } = await supabase
    .from('schematics')
    .select('id')
    .eq('site_id', siteId);

  if (schematicError || !schematics || schematics.length === 0) {
    return [];
  }

  const schematicIds = schematics.map(s => s.id);

  // Get all meter positions for these schematics
  const { data: positions, error: positionsError } = await supabase
    .from('meter_positions')
    .select('meter_id, meters(id, meter_number)')
    .in('schematic_id', schematicIds);

  if (positionsError || !positions) {
    return [];
  }

  // Deduplicate meters (a meter might be on multiple schematics)
  const uniqueMeters = new Map<string, { id: string; meter_number: string }>();
  positions.forEach(pos => {
    const meter = pos.meters as any;
    if (meter && !uniqueMeters.has(meter.id)) {
      uniqueMeters.set(meter.id, { id: meter.id, meter_number: meter.meter_number });
    }
  });

  return Array.from(uniqueMeters.values());
}

/**
 * Get tenant bill documents and their extractions for a meter
 */
export async function getDocumentsForMeter(siteId: string, meterNumber: string): Promise<DocumentData[]> {
  // Get tenant bills for this site
  const { data: documents, error: docsError } = await supabase
    .from('site_documents')
    .select(`
      id,
      file_name,
      document_extractions(
        period_start,
        period_end,
        total_amount,
        extracted_data
      )
    `)
    .eq('site_id', siteId)
    .eq('document_type', 'tenant_bill');

  if (docsError || !documents) {
    return [];
  }

  const result: DocumentData[] = [];

  documents.forEach(doc => {
    const extractions = (doc.document_extractions || []) as any[];
    extractions.forEach(extraction => {
      if (!extraction.period_start || !extraction.period_end) return;

      const extractedData = extraction.extracted_data || {};
      const lineItems = (extractedData.line_items || []) as DocumentLineItem[];

      // Filter line items for this meter
      const meterLineItems = lineItems.filter(item => 
        item.meter_number === meterNumber || 
        !item.meter_number // Include items without specific meter assignment
      );

      if (meterLineItems.length > 0 || extractedData.shop_number === meterNumber) {
        result.push({
          documentId: doc.id,
          periodStart: extraction.period_start,
          periodEnd: extraction.period_end,
          totalAmount: extraction.total_amount || 0,
          lineItems: meterLineItems,
        });
      }
    });
  });

  // Sort by period end date
  return result.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

/**
 * Get reconciliation cost data for a meter from saved reconciliation runs
 */
export async function getReconciliationCostsForMeter(
  siteId: string, 
  meterId: string
): Promise<ReconciliationCostData[]> {
  const { data, error } = await supabase
    .from('reconciliation_meter_results')
    .select(`
      total_cost,
      energy_cost,
      fixed_charges,
      demand_charges,
      total_kwh,
      reconciliation_runs!inner(
        site_id,
        date_from,
        date_to
      )
    `)
    .eq('meter_id', meterId)
    .eq('reconciliation_runs.site_id', siteId);

  if (error || !data) {
    return [];
  }

  return data.map(row => {
    const run = row.reconciliation_runs as any;
    return {
      period_start: run.date_from,
      period_end: run.date_to,
      total_cost: row.total_cost || 0,
      energy_cost: row.energy_cost || 0,
      fixed_charges: row.fixed_charges || 0,
      demand_charges: row.demand_charges || 0,
      total_kwh: row.total_kwh || 0,
    };
  }).sort((a, b) => a.period_end.localeCompare(b.period_end));
}

/**
 * Extract metric value from a document based on metric type
 * Logic copied from TariffAssignmentTab.tsx
 */
function extractMetricValue(doc: DocumentData, metric: ChartMetricKey): number | null {
  if (metric === 'total') {
    const lineItems = doc.lineItems || [];
    const normalTotal = lineItems
      .filter(item => item.supply !== 'Emergency')
      .reduce((sum, item) => sum + (item.amount || 0), 0);
    return normalTotal || doc.totalAmount || null;
  }

  const lineItems = doc.lineItems || [];

  switch (metric) {
    case 'basic': {
      const basicItem = lineItems.find(item => item.unit === 'Monthly');
      return basicItem?.amount || null;
    }
    case 'kva-charge': {
      const kvaItem = lineItems.find(item => item.unit === 'kVA');
      return kvaItem?.amount || null;
    }
    case 'kwh-charge': {
      const kwhItem = lineItems.find(item => 
        item.unit === 'kWh' && item.supply === 'Normal'
      );
      return kwhItem?.amount || null;
    }
    case 'kva-consumption': {
      const kvaConsumption = lineItems.find(item => item.unit === 'kVA');
      return kvaConsumption?.consumption || null;
    }
    case 'kwh-consumption': {
      const kwhConsumption = lineItems.find(item => 
        item.unit === 'kWh' && item.supply === 'Normal'
      );
      return kwhConsumption?.consumption || null;
    }
    default:
      return doc.totalAmount;
  }
}

/**
 * Calculate seasonal averages for a metric
 * South African seasons: Winter (Jun-Aug), Summer (Sep-May)
 */
function calculateSeasonalAverages(
  docs: DocumentData[], 
  metric: ChartMetricKey
): { winterAvg: number | null; summerAvg: number | null } {
  const winterMonths = [6, 7, 8];
  const summerMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];

  const winterValues: number[] = [];
  const summerValues: number[] = [];

  docs.forEach(doc => {
    const month = getMonthFromDateString(doc.periodStart);
    const value = extractMetricValue(doc, metric);
    
    if (value !== null && value > 0) {
      if (winterMonths.includes(month)) {
        winterValues.push(value);
      } else if (summerMonths.includes(month)) {
        summerValues.push(value);
      }
    }
  });

  const winterAvg = winterValues.length > 0
    ? winterValues.reduce((sum, val) => sum + val, 0) / winterValues.length
    : null;

  const summerAvg = summerValues.length > 0
    ? summerValues.reduce((sum, val) => sum + val, 0) / summerValues.length
    : null;

  return { winterAvg, summerAvg };
}

/**
 * Prepare chart data for a specific metric
 */
function prepareChartDataForMetric(
  docs: DocumentData[],
  reconCosts: ReconciliationCostData[],
  metric: ChartMetricKey
): ChartDataPoint[] {
  const { winterAvg, summerAvg } = calculateSeasonalAverages(docs, metric);
  const winterMonths = [6, 7, 8];

  // Sort documents by period
  const sortedDocs = [...docs].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  return sortedDocs.map(doc => {
    const value = extractMetricValue(doc, metric) || 0;
    const month = getMonthFromDateString(doc.periodEnd);
    const isWinter = winterMonths.includes(month);

    return {
      period: formatDateStringToMonthYear(doc.periodEnd),
      value,
      winterAvg: isWinter && winterAvg ? winterAvg : undefined,
      summerAvg: !isWinter && summerAvg ? summerAvg : undefined,
    };
  });
}

/**
 * Generate all 6 charts for a meter
 */
export async function generateMeterCharts(
  siteId: string,
  meterId: string,
  meterNumber: string
): Promise<Map<string, string>> {
  const charts = new Map<string, string>();

  // Fetch data
  const [docs, reconCosts] = await Promise.all([
    getDocumentsForMeter(siteId, meterNumber),
    getReconciliationCostsForMeter(siteId, meterId),
  ]);

  // Generate chart for each metric
  for (const metric of CHART_METRICS) {
    const chartData = prepareChartDataForMetric(docs, reconCosts, metric.key);
    
    // Skip if no data
    if (chartData.length === 0) {
      continue;
    }

    const chartImage = generateTariffAnalysisChart(
      `${meterNumber} - ${metric.title}`,
      metric.unit,
      chartData,
      500,
      320,
      3
    );

    if (chartImage) {
      charts.set(metric.filename, chartImage);
    }
  }

  return charts;
}

/**
 * Convert base64 data URL to Blob
 */
function dataURLtoBlob(dataURL: string): Blob {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Save meter charts to storage
 */
export async function saveMeterCharts(
  siteId: string,
  meterNumber: string,
  charts: Map<string, string>
): Promise<number> {
  let savedCount = 0;

  for (const [metricFilename, chartDataUrl] of charts) {
    try {
      const fileName = `${meterNumber}-${metricFilename}.png`;
      const { bucket, path } = await generateStoragePath(
        siteId,
        'Metering',
        'Reconciliations/Graphs',
        fileName
      );

      const blob = dataURLtoBlob(chartDataUrl);

      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, blob, {
          contentType: 'image/png',
          upsert: true,
        });

      if (error) {
        console.error(`Failed to save chart ${fileName}:`, error);
      } else {
        savedCount++;
      }
    } catch (error) {
      console.error(`Error saving chart for ${meterNumber}-${metricFilename}:`, error);
    }
  }

  return savedCount;
}

/**
 * Generate and save all reconciliation charts for a site
 */
export async function generateAllReconciliationCharts(
  siteId: string,
  onProgress?: (current: number, total: number, meterNumber: string) => void
): Promise<{ success: boolean; totalCharts: number; errors: string[] }> {
  const errors: string[] = [];
  let totalCharts = 0;

  try {
    // Get all meters on schematic
    const meters = await getMetersOnSchematic(siteId);
    
    if (meters.length === 0) {
      return { success: true, totalCharts: 0, errors: [] };
    }

    const totalMetrics = CHART_METRICS.length;
    let currentChart = 0;

    for (const meter of meters) {
      try {
        // Generate charts for this meter
        const charts = await generateMeterCharts(siteId, meter.id, meter.meter_number);
        
        // Save charts
        const savedCount = await saveMeterCharts(siteId, meter.meter_number, charts);
        totalCharts += savedCount;
        
        currentChart += totalMetrics;
        onProgress?.(currentChart, meters.length * totalMetrics, meter.meter_number);
      } catch (error) {
        const errorMsg = `Failed to generate charts for meter ${meter.meter_number}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        currentChart += totalMetrics;
        onProgress?.(currentChart, meters.length * totalMetrics, meter.meter_number);
      }
    }

    return { success: errors.length === 0, totalCharts, errors };
  } catch (error) {
    const errorMsg = `Chart generation failed: ${error}`;
    console.error(errorMsg);
    return { success: false, totalCharts, errors: [errorMsg] };
  }
}

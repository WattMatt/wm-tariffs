import { supabase } from '@/integrations/supabase/client';
import { generateStoragePath } from '@/lib/storagePaths';
import { formatDateStringToMonthYear } from '@/lib/utils';

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

// Chart data format for Recharts rendering - matches MeterChartDataPoint
export interface RechartsDataPoint {
  period: string;
  amount: number;
  documentAmount?: number;
  meterReading?: number;
  isDiscontinuous?: boolean;
  // Index signature for seasonal average segments
  [key: string]: number | string | boolean | undefined;
}

/**
 * Get all meters that have been placed on a schematic for this site
 */
export async function getMetersOnSchematic(siteId: string): Promise<Array<{ id: string; meter_number: string }>> {
  const { data: schematics, error: schematicError } = await supabase
    .from('schematics')
    .select('id')
    .eq('site_id', siteId);

  if (schematicError || !schematics || schematics.length === 0) {
    return [];
  }

  const schematicIds = schematics.map(s => s.id);

  const { data: positions, error: positionsError } = await supabase
    .from('meter_positions')
    .select('meter_id, meters(id, meter_number)')
    .in('schematic_id', schematicIds);

  if (positionsError || !positions) {
    return [];
  }

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

      const meterLineItems = lineItems.filter(item => 
        item.meter_number === meterNumber || 
        !item.meter_number
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
 * Prepare chart data for Recharts rendering - matches TariffAssignmentTab format
 */
export function prepareRechartsData(
  docs: DocumentData[],
  reconCosts: ReconciliationCostData[],
  metric: ChartMetricKey
): RechartsDataPoint[] {
  // Build a map of reconciliation costs by month-year for matching
  const reconCostsByMonth = new Map<string, ReconciliationCostData>();
  reconCosts.forEach(cost => {
    const monthYear = formatDateStringToMonthYear(cost.period_end);
    reconCostsByMonth.set(monthYear, cost);
  });

  // Sort documents by period
  const sortedDocs = [...docs].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  return sortedDocs.map(doc => {
    const period = formatDateStringToMonthYear(doc.periodEnd);
    const documentValue = extractMetricValue(doc, metric) || 0;
    const reconCost = reconCostsByMonth.get(period);
    
    // Calculate reconciliation value based on metric
    let reconValue = 0;
    if (reconCost) {
      switch (metric) {
        case 'total':
          reconValue = reconCost.total_cost;
          break;
        case 'basic':
          reconValue = reconCost.fixed_charges;
          break;
        case 'kva-charge':
          reconValue = reconCost.demand_charges;
          break;
        case 'kwh-charge':
          reconValue = reconCost.energy_cost;
          break;
        case 'kwh-consumption':
          reconValue = reconCost.total_kwh;
          break;
        default:
          reconValue = reconCost.total_cost;
      }
    }

    return {
      period,
      amount: reconValue,
      documentAmount: documentValue,
    };
  });
}

/**
 * Prepare all chart data for a meter (all metrics)
 */
export async function prepareMeterChartData(
  siteId: string,
  meterId: string,
  meterNumber: string
): Promise<Map<ChartMetricKey, { data: RechartsDataPoint[]; title: string }>> {
  const chartDataMap = new Map<ChartMetricKey, { data: RechartsDataPoint[]; title: string }>();

  const [docs, reconCosts] = await Promise.all([
    getDocumentsForMeter(siteId, meterNumber),
    getReconciliationCostsForMeter(siteId, meterId),
  ]);

  for (const metric of CHART_METRICS) {
    const data = prepareRechartsData(docs, reconCosts, metric.key);
    
    if (data.length > 0) {
      chartDataMap.set(metric.key, {
        data,
        title: `${meterNumber} - ${metric.title}`,
      });
    }
  }

  return chartDataMap;
}

/**
 * Convert base64 data URL to Blob
 */
export function dataURLtoBlob(dataURL: string): Blob {
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
 * Save a single chart image to storage
 */
export async function saveChartToStorage(
  siteId: string,
  meterNumber: string,
  metricFilename: string,
  chartDataUrl: string
): Promise<boolean> {
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
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error saving chart for ${meterNumber}-${metricFilename}:`, error);
    return false;
  }
}

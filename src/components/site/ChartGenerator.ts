/**
 * Chart generation utilities using SVG rendering
 * All chart functions return SVG data URLs for consistent quality and smaller file sizes
 */

import {
  generatePieChartSVG,
  generateClusteredTariffChartSVG,
  generateTariffComparisonChartSVG,
  generateDocumentVsAssignedChartSVG,
  generateReconciliationVsDocumentChartSVG,
  generateTariffAnalysisChartSVG,
  generateReconciliationMeterChartSVG,
  generateAnalysisMeterChartSVG,
  generateAssignmentChartSVG,
  type ReconciliationChartDataPointSVG,
  type AnalysisChartDataPointSVG,
  type AssignmentChartDataPointSVG,
} from '@/lib/charts/svgRenderer';

// Helper to convert SVG string to data URL
const svgToDataUrl = (svg: string): string => {
  if (!svg) return '';
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
};

// Utility to generate chart images for preview (pie or bar)
export const generateChartImage = (
  type: 'pie' | 'bar',
  data: number[],
  labels: string[],
  width: number = 400,
  height: number = 300
): string => {
  if (type === 'pie') {
    const svg = generatePieChartSVG(data, labels, width, height);
    return svgToDataUrl(svg);
  } else if (type === 'bar') {
    // Convert to periods format for simple bar chart
    const periods = labels.map((label, index) => ({
      label,
      value: data[index] || 0
    }));
    const svg = generateTariffComparisonChartSVG('', '', periods, width, height);
    return svgToDataUrl(svg);
  }
  return '';
};

export const generateMeterTypeChart = (meterData: any[]): string => {
  const typeCounts: Record<string, number> = {};
  
  meterData.forEach(meter => {
    const type = meter.meter_type || meter.type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });
  
  const labels = Object.keys(typeCounts);
  const data = Object.values(typeCounts);
  
  return generateChartImage('pie', data, labels);
};

export const generateConsumptionChart = (meterData: any[]): string => {
  // Sort by consumption and take top 10
  const sorted = [...meterData]
    .sort((a, b) => (b.totalKwh || 0) - (a.totalKwh || 0))
    .slice(0, 10);
  
  const labels = sorted.map(m => m.meter_number || m.name || 'Unknown');
  const data = sorted.map(m => Math.round(m.totalKwh || 0));
  
  return generateChartImage('bar', data, labels, 600, 400);
};

export const generateClusteredTariffChart = (
  title: string,
  unit: string,
  winterData: { label: string; value: number }[],
  summerData: { label: string; value: number }[],
  width: number = 280,
  height: number = 340
): string => {
  const svg = generateClusteredTariffChartSVG(title, unit, winterData, summerData, width, height);
  return svgToDataUrl(svg);
};

export const generateTariffAnalysisChart = (
  title: string,
  unit: string,
  data: { period: string; value: number; winterAvg?: number; summerAvg?: number }[],
  width: number = 500,
  height: number = 320,
  _scaleFactor: number = 3 // Ignored for SVG, kept for API compatibility
): string => {
  const svg = generateTariffAnalysisChartSVG(title, unit, data, width, height);
  return svgToDataUrl(svg);
};

export const generateDocumentVsAssignedChart = (
  title: string,
  unit: string,
  data: { period: string; documentValue: number; assignedValue: number | null }[],
  width: number = 400,
  height: number = 300,
  _scaleFactor: number = 3 // Ignored for SVG, kept for API compatibility
): string => {
  const svg = generateDocumentVsAssignedChartSVG(title, unit, data, width, height);
  return svgToDataUrl(svg);
};

export const generateTariffComparisonChart = (
  title: string,
  unit: string,
  periods: { label: string; value: number }[],
  width: number = 280,
  height: number = 340
): string => {
  const svg = generateTariffComparisonChartSVG(title, unit, periods, width, height);
  return svgToDataUrl(svg);
};

export const generateReconciliationVsDocumentChart = (
  title: string,
  data: { period: string; reconciliationValue: number; documentValue: number }[],
  width: number = 400,
  height: number = 300
): string => {
  const svg = generateReconciliationVsDocumentChartSVG(title, data, width, height);
  return svgToDataUrl(svg);
};

// Interface for reconciliation chart data
export interface ReconciliationChartDataPoint {
  period: string;
  amount: number | null;        // Reconciliation cost
  documentAmount: number | null; // Document billed
  meterReading: number | null;   // Meter reading value
}

/**
 * Generate a reconciliation meter chart using SVG
 * Creates a clustered bar chart with bars for Reconciliation Cost and Document Billed,
 * plus a line for Meter Reading on a secondary Y-axis.
 */
export const generateReconciliationMeterChart = (
  title: string,
  unit: string,
  data: ReconciliationChartDataPoint[],
  width: number = 900,
  height: number = 500,
  _scaleFactor: number = 2 // Ignored for SVG, kept for API compatibility
): string => {
  // Convert to SVG data point format
  const svgData: ReconciliationChartDataPointSVG[] = data.map(d => ({
    period: d.period,
    amount: d.amount,
    documentAmount: d.documentAmount,
    meterReading: d.meterReading
  }));
  
  const svg = generateReconciliationMeterChartSVG(title, unit, svgData, width, height);
  return svgToDataUrl(svg);
};

// Interface for analysis chart data (Document Amount with segment-based Winter/Summer averages)
export interface AnalysisChartDataPoint {
  period: string;
  documentAmount: number | null;
  isWinter?: boolean;
  isSummer?: boolean;
  // Dynamic segment keys: winterAvg_0, winterAvg_1, summerAvg_0, etc.
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Generate an analysis meter chart using SVG
 * Creates a bar chart with Document Amount bars plus segmented Winter and Summer average lines
 * that connect only consecutive months of the same season (matching the UI).
 */
export const generateAnalysisMeterChart = (
  title: string,
  unit: string,
  data: AnalysisChartDataPoint[],
  width: number = 900,
  height: number = 500,
  _scaleFactor: number = 2 // Ignored for SVG, kept for API compatibility
): string => {
  // Convert to SVG data point format
  const svgData: AnalysisChartDataPointSVG[] = data.map(d => {
    const result: AnalysisChartDataPointSVG = {
      period: d.period,
      documentAmount: d.documentAmount,
      isWinter: d.isWinter,
      isSummer: d.isSummer
    };
    
    // Copy over dynamic winter/summer avg keys
    Object.keys(d).forEach(key => {
      if (key.startsWith('winterAvg_') || key.startsWith('summerAvg_')) {
        result[key] = d[key];
      }
    });
    
    return result;
  });
  
  const svg = generateAnalysisMeterChartSVG(title, unit, svgData, width, height);
  return svgToDataUrl(svg);
};

/**
 * Generate all 6 metric charts for a meter (fast, synchronous)
 */
export const generateAllMeterCharts = (
  meterNumber: string,
  chartDataByMetric: Map<string, ReconciliationChartDataPoint[]>
): Map<string, string> => {
  const result = new Map<string, string>();
  
  const metrics = [
    { key: 'total', title: 'Total Amount', unit: 'R' },
    { key: 'basic', title: 'Basic Charge', unit: 'R' },
    { key: 'kva-charge', title: 'kVA Charge', unit: 'R' },
    { key: 'kwh-charge', title: 'kWh Charge', unit: 'R' },
    { key: 'kva-consumption', title: 'kVA Consumption', unit: 'kVA' },
    { key: 'kwh-consumption', title: 'kWh Consumption', unit: 'kWh' },
  ];
  
  for (const metric of metrics) {
    const data = chartDataByMetric.get(metric.key);
    if (data && data.length > 0) {
      const dataUrl = generateReconciliationMeterChart(
        `${meterNumber} - ${metric.title}`,
        metric.unit,
        data
      );
      if (dataUrl) {
        result.set(metric.key, dataUrl);
      }
    }
  }
  
  return result;
};

// Re-export types for convenience
export type { ReconciliationChartDataPointSVG, AnalysisChartDataPointSVG, AssignmentChartDataPointSVG };

/**
 * SVG-based chart rendering utilities
 * These functions generate chart images as SVG strings for perfect quality at any size
 */

import type { ChartDataPoint, ChartRenderOptions } from './types';

// Default colors
const DEFAULT_COLORS = {
  primary: '#3b82f6',
  secondary: '#9ca3af',
  tertiary: '#22c55e',
  background: '#ffffff',
  text: '#000000',
  grid: '#e5e7eb',
};

// Helper function to abbreviate large numbers
const abbreviateNumber = (value: number): string => {
  if (Math.abs(value) >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  } else if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  return value.toFixed(1);
};

// Helper to escape XML special characters
const escapeXml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

export interface BarChartSVGOptions extends ChartRenderOptions {
  title?: string;
  unit?: string;
  seriesKeys: string[];
  seriesLabels?: Record<string, string>;
  seriesColors?: Record<string, string>;
  percentChange?: number | null;
  avgYoyChange?: number | null;
}

/**
 * Generate a bar chart as SVG string
 */
export function generateBarChartSVG(
  data: ChartDataPoint[],
  options: BarChartSVGOptions
): string {
  const {
    width = 400,
    height = 300,
    title,
    unit,
    seriesKeys,
    seriesLabels = {},
    seriesColors = {},
    colors = DEFAULT_COLORS,
    showLegend = true,
    showGrid = true,
    showValues = true,
    percentChange,
    avgYoyChange,
  } = options;

  if (data.length === 0) return '';

  // Chart dimensions
  const padding = 50;
  const bottomPadding = 80;
  const topPadding = showLegend ? 80 : 50;
  const chartWidth = width - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;

  // Find max value
  const allValues = data.flatMap(d => 
    seriesKeys.map(key => d.values[key] || 0)
  );
  const maxValue = Math.max(...allValues, 1);

  // Calculate bar dimensions
  const clusterWidth = chartWidth / data.length;
  const barCount = seriesKeys.length;
  const barWidth = Math.max((clusterWidth - 12) / barCount, 15);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  
  // Background
  svg += `<rect width="${width}" height="${height}" fill="${colors.background || DEFAULT_COLORS.background}"/>`;

  // Title
  if (title) {
    svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="${colors.text || DEFAULT_COLORS.text}">${escapeXml(title)}</text>`;
    if (unit) {
      svg += `<text x="${width / 2}" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${colors.text || DEFAULT_COLORS.text}">(${escapeXml(unit)})</text>`;
    }
  }

  // Percentage change indicators
  if (percentChange !== undefined && percentChange !== null) {
    const changeY = 58;
    const isIncrease = percentChange > 0;
    const changeColor = isIncrease ? '#ef4444' : '#22c55e';
    const arrow = isIncrease ? '↗' : '↘';
    const sign = isIncrease ? '+' : '';
    const percentText = `${arrow} ${sign}${percentChange.toFixed(1)}%`;
    
    let xOffset = width / 2;
    if (avgYoyChange !== undefined && avgYoyChange !== null) {
      xOffset = width / 2 - 50;
    }
    
    svg += `<text x="${xOffset}" y="${changeY}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="${changeColor}">${percentText}</text>`;
    
    if (avgYoyChange !== undefined && avgYoyChange !== null) {
      const avgXOffset = width / 2 + 30;
      const avgIsIncrease = avgYoyChange > 0;
      const avgSign = avgIsIncrease ? '+' : '';
      svg += `<text x="${avgXOffset - 35}" y="${changeY}" text-anchor="start" font-family="sans-serif" font-size="9" fill="#6b7280">Avg YoY:</text>`;
      svg += `<text x="${avgXOffset + 10}" y="${changeY}" text-anchor="start" font-family="sans-serif" font-size="10" font-weight="bold" fill="${avgIsIncrease ? '#ef4444' : '#22c55e'}">${avgSign}${avgYoyChange.toFixed(1)}%</text>`;
    }
  }

  // Gridlines
  if (showGrid) {
    for (let i = 0; i <= 5; i++) {
      const y = topPadding + (chartHeight * i / 5);
      svg += `<line x1="${padding}" y1="${y}" x2="${padding + chartWidth}" y2="${y}" stroke="${colors.grid || DEFAULT_COLORS.grid}" stroke-dasharray="3,3"/>`;
    }
  }

  // Bars
  data.forEach((item, dataIndex) => {
    const clusterX = padding + dataIndex * clusterWidth;

    seriesKeys.forEach((key, keyIndex) => {
      const value = item.values[key] || 0;
      const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
      const barX = clusterX + keyIndex * (barWidth + 4) + 4;
      const barY = topPadding + chartHeight - barHeight;

      const color = seriesColors[key] || Object.values(DEFAULT_COLORS)[keyIndex % 3];
      
      // Bar with rounded corners
      const barRadius = 4;
      svg += `<path d="M${barX},${barY + barRadius} Q${barX},${barY} ${barX + barRadius},${barY} L${barX + barWidth - barRadius},${barY} Q${barX + barWidth},${barY} ${barX + barWidth},${barY + barRadius} L${barX + barWidth},${topPadding + chartHeight} L${barX},${topPadding + chartHeight} Z" fill="${color}"/>`;

      // Value on top
      if (showValues && value > 0) {
        svg += `<text x="${barX + barWidth / 2}" y="${barY - 4}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="${colors.text || DEFAULT_COLORS.text}">${abbreviateNumber(value)}</text>`;
      }
    });
  });

  // X-axis labels
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    svg += `<text x="${x}" y="${height - bottomPadding + 15}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${colors.text || DEFAULT_COLORS.text}">${escapeXml(item.label)}</text>`;
  });

  // Axes
  svg += `<line x1="${padding}" y1="${topPadding}" x2="${padding}" y2="${topPadding + chartHeight}" stroke="${colors.grid || DEFAULT_COLORS.grid}"/>`;
  svg += `<line x1="${padding}" y1="${topPadding + chartHeight}" x2="${padding + chartWidth}" y2="${topPadding + chartHeight}" stroke="${colors.grid || DEFAULT_COLORS.grid}"/>`;

  svg += '</svg>';
  return svg;
}

export interface ComboChartSVGOptions extends BarChartSVGOptions {
  lineSeriesKey?: string;
  lineSeriesLabel?: string;
  lineSeriesColor?: string;
}

/**
 * Generate a combo chart (bars + line) as SVG string
 */
export function generateComboChartSVG(
  data: ChartDataPoint[],
  options: ComboChartSVGOptions
): string {
  const {
    width = 900,
    height = 500,
    title,
    unit,
    seriesKeys,
    seriesLabels = {},
    seriesColors = {},
    lineSeriesKey,
    lineSeriesLabel,
    lineSeriesColor = '#22c55e',
    colors = DEFAULT_COLORS,
    showLegend = true,
    showGrid = true,
  } = options;

  if (data.length === 0) return '';

  // Chart dimensions
  const padding = 60;
  const rightPadding = 80;
  const bottomPadding = 100;
  const topPadding = showLegend ? 75 : 50;
  const chartWidth = width - padding - rightPadding;
  const chartHeight = height - topPadding - bottomPadding;

  // Find max values
  const barValues = data.flatMap(d => seriesKeys.map(key => d.values[key] || 0));
  const maxBarValue = Math.max(...barValues, 1);
  
  const lineValues = lineSeriesKey 
    ? data.map(d => d.values[lineSeriesKey]).filter((v): v is number => v !== null && v !== undefined)
    : [];
  const maxLineValue = lineValues.length > 0 ? Math.max(...lineValues) : 1;

  const clusterWidth = chartWidth / data.length;
  const barCount = seriesKeys.length;
  const barWidth = Math.max((clusterWidth - 12) / barCount, 20);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  
  // Background
  svg += `<rect width="${width}" height="${height}" fill="${colors.background || DEFAULT_COLORS.background}"/>`;

  // Title
  if (title) {
    svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="${colors.text || DEFAULT_COLORS.text}">${escapeXml(title)}</text>`;
    if (unit) {
      svg += `<text x="${width / 2}" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${colors.text || DEFAULT_COLORS.text}">(${escapeXml(unit)})</text>`;
    }
  }

  // Legend
  if (showLegend) {
    const allSeries = [...seriesKeys, ...(lineSeriesKey ? [lineSeriesKey] : [])];
    const legendY = 55;
    const legendSpacing = 140;
    let legendX = width / 2 - (allSeries.length * legendSpacing) / 2;

    seriesKeys.forEach((key, i) => {
      const color = seriesColors[key] || Object.values(DEFAULT_COLORS)[i % 3];
      svg += `<rect x="${legendX}" y="${legendY}" width="14" height="14" fill="${color}"/>`;
      svg += `<text x="${legendX + 18}" y="${legendY + 11}" font-family="sans-serif" font-size="10" fill="${colors.text || DEFAULT_COLORS.text}">${escapeXml(seriesLabels[key] || key)}</text>`;
      legendX += legendSpacing;
    });

    if (lineSeriesKey) {
      svg += `<line x1="${legendX}" y1="${legendY + 7}" x2="${legendX + 14}" y2="${legendY + 7}" stroke="${lineSeriesColor}" stroke-width="2"/>`;
      svg += `<circle cx="${legendX + 7}" cy="${legendY + 7}" r="3" fill="${lineSeriesColor}"/>`;
      svg += `<text x="${legendX + 18}" y="${legendY + 11}" font-family="sans-serif" font-size="10" fill="${colors.text || DEFAULT_COLORS.text}">${escapeXml(lineSeriesLabel || lineSeriesKey)}</text>`;
    }
  }

  // Gridlines
  if (showGrid) {
    for (let i = 0; i <= 5; i++) {
      const y = topPadding + (chartHeight * i / 5);
      svg += `<line x1="${padding}" y1="${y}" x2="${padding + chartWidth}" y2="${y}" stroke="${colors.grid || DEFAULT_COLORS.grid}" stroke-dasharray="3,3"/>`;
    }
  }

  // Bars
  data.forEach((item, dataIndex) => {
    const clusterX = padding + dataIndex * clusterWidth;

    seriesKeys.forEach((key, keyIndex) => {
      const value = item.values[key] || 0;
      const barHeight = maxBarValue > 0 ? (value / maxBarValue) * chartHeight : 0;
      const barX = clusterX + keyIndex * (barWidth + 4) + 4;
      const barY = topPadding + chartHeight - barHeight;

      const color = seriesColors[key] || Object.values(DEFAULT_COLORS)[keyIndex % 3];
      const barRadius = 4;
      svg += `<path d="M${barX},${barY + barRadius} Q${barX},${barY} ${barX + barRadius},${barY} L${barX + barWidth - barRadius},${barY} Q${barX + barWidth},${barY} ${barX + barWidth},${barY + barRadius} L${barX + barWidth},${topPadding + chartHeight} L${barX},${topPadding + chartHeight} Z" fill="${color}"/>`;
    });
  });

  // Line series
  if (lineSeriesKey) {
    let linePath = '';
    let isFirst = true;

    data.forEach((item, index) => {
      const value = item.values[lineSeriesKey];
      if (value !== null && value !== undefined) {
        const x = padding + index * clusterWidth + clusterWidth / 2;
        const y = topPadding + chartHeight - (value / maxLineValue) * chartHeight;
        linePath += isFirst ? `M${x},${y}` : ` L${x},${y}`;
        isFirst = false;
      }
    });

    if (linePath) {
      svg += `<path d="${linePath}" fill="none" stroke="${lineSeriesColor}" stroke-width="2"/>`;
    }

    // Dots
    data.forEach((item, index) => {
      const value = item.values[lineSeriesKey];
      if (value !== null && value !== undefined) {
        const x = padding + index * clusterWidth + clusterWidth / 2;
        const y = topPadding + chartHeight - (value / maxLineValue) * chartHeight;
        svg += `<circle cx="${x}" cy="${y}" r="4" fill="${lineSeriesColor}"/>`;
      }
    });
  }

  // X-axis labels (rotated)
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const y = topPadding + chartHeight + 10;
    svg += `<text x="${x}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="9" fill="${colors.text || DEFAULT_COLORS.text}" transform="rotate(-45 ${x} ${y})">${escapeXml(item.label)}</text>`;
  });

  svg += '</svg>';
  return svg;
}

// ==================== Reconciliation-specific SVG generators ====================

export interface ReconciliationChartDataPointSVG {
  period: string;
  amount: number | null;
  documentAmount: number | null;
  meterReading: number | null;
}

/**
 * Generate a reconciliation meter chart as SVG
 */
export function generateReconciliationMeterChartSVG(
  title: string,
  unit: string,
  data: ReconciliationChartDataPointSVG[],
  width: number = 900,
  height: number = 500
): string {
  if (data.length === 0) return '';

  // Colors
  const reconciliationColor = 'rgba(156, 163, 175, 0.5)';
  const documentColor = '#3b82f6';
  const meterReadingColor = '#22c55e';

  // Chart dimensions
  const padding = 60;
  const rightPadding = 80;
  const bottomPadding = 100;
  const topPadding = 70;
  const chartWidth = width - padding - rightPadding;
  const chartHeight = height - topPadding - bottomPadding;

  // Calculate scales
  const barValues = data.map(d => Math.max(d.amount || 0, d.documentAmount || 0));
  const maxBarValue = Math.max(...barValues, 1);
  
  const meterReadings = data.map(d => d.meterReading).filter(v => v !== null) as number[];
  const maxMeterReading = meterReadings.length > 0 ? Math.max(...meterReadings) : 1;
  
  const clusterWidth = chartWidth / data.length;
  const barWidth = Math.max((clusterWidth - 12) / 2, 20);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  
  // Background
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;

  // Title
  svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#000000">${escapeXml(title)}</text>`;
  if (unit) {
    svg += `<text x="${width / 2}" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#000000">(${escapeXml(unit)})</text>`;
  }

  // Legend
  const legendY = 55;
  const legendSpacing = 140;
  let legendX = width / 2 - legendSpacing * 1.2;

  svg += `<rect x="${legendX}" y="${legendY}" width="14" height="14" fill="${reconciliationColor}"/>`;
  svg += `<text x="${legendX + 18}" y="${legendY + 11}" font-family="sans-serif" font-size="10" fill="#000000">Reconciliation Cost</text>`;

  legendX += legendSpacing;
  svg += `<rect x="${legendX}" y="${legendY}" width="14" height="14" fill="${documentColor}"/>`;
  svg += `<text x="${legendX + 18}" y="${legendY + 11}" font-family="sans-serif" font-size="10" fill="#000000">Document Billed</text>`;

  legendX += legendSpacing;
  svg += `<line x1="${legendX}" y1="${legendY + 7}" x2="${legendX + 14}" y2="${legendY + 7}" stroke="${meterReadingColor}" stroke-width="2"/>`;
  svg += `<circle cx="${legendX + 7}" cy="${legendY + 7}" r="3" fill="${meterReadingColor}"/>`;
  svg += `<text x="${legendX + 18}" y="${legendY + 11}" font-family="sans-serif" font-size="10" fill="#000000">Meter Reading</text>`;

  // Gridlines
  const numGridLines = 5;
  for (let i = 0; i <= numGridLines; i++) {
    const y = topPadding + (chartHeight * i / numGridLines);
    svg += `<line x1="${padding}" y1="${y}" x2="${padding + chartWidth}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="3,3"/>`;
  }

  // Bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;
    
    // Reconciliation bar
    const reconValue = item.amount || 0;
    const reconBarHeight = maxBarValue > 0 ? (reconValue / maxBarValue) * chartHeight : 0;
    const reconY = topPadding + chartHeight - reconBarHeight;
    const reconBarX = clusterX + 4;
    const barRadius = 4;
    
    svg += `<path d="M${reconBarX},${reconY + barRadius} Q${reconBarX},${reconY} ${reconBarX + barRadius},${reconY} L${reconBarX + barWidth - barRadius},${reconY} Q${reconBarX + barWidth},${reconY} ${reconBarX + barWidth},${reconY + barRadius} L${reconBarX + barWidth},${topPadding + chartHeight} L${reconBarX},${topPadding + chartHeight} Z" fill="${reconciliationColor}"/>`;
    
    // Document bar
    const docValue = item.documentAmount || 0;
    const docBarHeight = maxBarValue > 0 ? (docValue / maxBarValue) * chartHeight : 0;
    const docY = topPadding + chartHeight - docBarHeight;
    const docBarX = clusterX + barWidth + 8;
    
    svg += `<path d="M${docBarX},${docY + barRadius} Q${docBarX},${docY} ${docBarX + barRadius},${docY} L${docBarX + barWidth - barRadius},${docY} Q${docBarX + barWidth},${docY} ${docBarX + barWidth},${docY + barRadius} L${docBarX + barWidth},${topPadding + chartHeight} L${docBarX},${topPadding + chartHeight} Z" fill="${documentColor}"/>`;
  });

  // Meter reading line
  let linePath = '';
  let isFirst = true;
  data.forEach((item, index) => {
    if (item.meterReading !== null) {
      const x = padding + index * clusterWidth + clusterWidth / 2;
      const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
      linePath += isFirst ? `M${x},${y}` : ` L${x},${y}`;
      isFirst = false;
    }
  });
  if (linePath) {
    svg += `<path d="${linePath}" fill="none" stroke="${meterReadingColor}" stroke-width="2"/>`;
  }

  // Meter reading dots
  data.forEach((item, index) => {
    if (item.meterReading !== null) {
      const x = padding + index * clusterWidth + clusterWidth / 2;
      const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="${meterReadingColor}"/>`;
    }
  });

  // Y-axis labels (left)
  for (let i = 0; i <= numGridLines; i++) {
    const value = maxBarValue * (1 - i / numGridLines);
    const y = topPadding + (chartHeight * i / numGridLines);
    const label = value >= 1000 ? `R${(value / 1000).toFixed(0)}k` : `R${value.toFixed(0)}`;
    svg += `<text x="${padding - 8}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#374151">${label}</text>`;
  }

  // Y-axis labels (right - meter reading)
  for (let i = 0; i <= numGridLines; i++) {
    const value = maxMeterReading * (1 - i / numGridLines);
    const y = topPadding + (chartHeight * i / numGridLines);
    svg += `<text x="${padding + chartWidth + 10}" y="${y + 4}" text-anchor="start" font-family="sans-serif" font-size="10" fill="#374151">${value.toLocaleString()}</text>`;
  }

  // X-axis labels (rotated)
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const y = topPadding + chartHeight + 15;
    svg += `<text x="${x}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#374151" transform="rotate(-45 ${x} ${y})">${escapeXml(item.period)}</text>`;
  });

  // Axes
  svg += `<line x1="${padding}" y1="${topPadding}" x2="${padding}" y2="${topPadding + chartHeight}" stroke="#374151"/>`;
  svg += `<line x1="${padding}" y1="${topPadding + chartHeight}" x2="${padding + chartWidth}" y2="${topPadding + chartHeight}" stroke="#374151"/>`;

  svg += '</svg>';
  return svg;
}

// ==================== Analysis Chart SVG ====================

export interface AnalysisChartDataPointSVG {
  period: string;
  documentAmount: number | null;
  meterReading?: number | null;
  isWinter?: boolean;
  isSummer?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Generate an analysis meter chart as SVG
 */
export function generateAnalysisMeterChartSVG(
  title: string,
  unit: string,
  data: AnalysisChartDataPointSVG[],
  width: number = 900,
  height: number = 500
): string {
  if (data.length === 0) return '';

  // Colors
  const documentColor = 'rgba(156, 163, 175, 0.6)';
  const winterColor = '#3b82f6';
  const summerColor = '#f97316';
  const meterReadingColor = '#22c55e';

  // Chart dimensions
  const padding = 60;
  const rightPadding = 80; // Increased for right Y-axis
  const bottomPadding = 100;
  const topPadding = 70;
  const chartWidth = width - padding - rightPadding;
  const chartHeight = height - topPadding - bottomPadding;

  // Find max values
  const docValues = data.map(d => d.documentAmount || 0);
  const maxValue = Math.max(...docValues, 1);
  
  // Meter reading scale (separate right Y-axis)
  const meterReadings = data.map(d => d.meterReading).filter((v): v is number => v !== null && v !== undefined);
  const maxMeterReading = meterReadings.length > 0 ? Math.max(...meterReadings) : 1;

  const barSpacing = chartWidth / data.length;
  const barWidth = Math.max(barSpacing * 0.6, 20);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  
  // Background
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;

  // Title
  svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#000000">${escapeXml(title)}</text>`;
  if (unit) {
    svg += `<text x="${width / 2}" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#000000">(${escapeXml(unit)})</text>`;
  }

  // Legend
  const legendY = 55;
  const legendSpacing = 100;
  let legendX = width / 2 - legendSpacing * 1.5;

  svg += `<rect x="${legendX}" y="${legendY}" width="12" height="12" fill="${documentColor}"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Amount</text>`;

  legendX += legendSpacing;
  svg += `<line x1="${legendX}" y1="${legendY + 6}" x2="${legendX + 12}" y2="${legendY + 6}" stroke="${winterColor}" stroke-width="2"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Winter Avg</text>`;

  legendX += legendSpacing;
  svg += `<line x1="${legendX}" y1="${legendY + 6}" x2="${legendX + 12}" y2="${legendY + 6}" stroke="${summerColor}" stroke-width="2"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Summer Avg</text>`;

  // Meter Reading legend (if data exists)
  if (meterReadings.length > 0) {
    legendX += legendSpacing;
    svg += `<line x1="${legendX}" y1="${legendY + 6}" x2="${legendX + 12}" y2="${legendY + 6}" stroke="${meterReadingColor}" stroke-width="2"/>`;
    svg += `<circle cx="${legendX + 6}" cy="${legendY + 6}" r="3" fill="${meterReadingColor}"/>`;
    svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Meter Reading</text>`;
  }

  // Bars
  data.forEach((item, index) => {
    const value = item.documentAmount || 0;
    const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
    const x = padding + index * barSpacing + (barSpacing - barWidth) / 2;
    const y = topPadding + chartHeight - barHeight;

    svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${documentColor}"/>`;

    // Value on top
    if (value > 0) {
      svg += `<text x="${x + barWidth / 2}" y="${y - 3}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${abbreviateNumber(value)}</text>`;
    }
  });

  // Draw winter segments
  const winterSegments: { indices: number[] }[] = [];
  let currentWinterSegment: number[] = [];
  data.forEach((item, index) => {
    const winterKey = Object.keys(item).find(k => k.startsWith('winterAvg_'));
    if (winterKey && item[winterKey] !== undefined) {
      currentWinterSegment.push(index);
    } else if (currentWinterSegment.length > 0) {
      winterSegments.push({ indices: currentWinterSegment });
      currentWinterSegment = [];
    }
  });
  if (currentWinterSegment.length > 0) {
    winterSegments.push({ indices: currentWinterSegment });
  }

  winterSegments.forEach(segment => {
    if (segment.indices.length > 1) {
      let linePath = '';
      segment.indices.forEach((idx, i) => {
        const winterKey = Object.keys(data[idx]).find(k => k.startsWith('winterAvg_'));
        const value = winterKey ? (data[idx][winterKey] as number) : 0;
        const x = padding + idx * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (value / maxValue) * chartHeight;
        linePath += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
      });
      svg += `<path d="${linePath}" fill="none" stroke="${winterColor}" stroke-width="2" stroke-dasharray="4,2"/>`;
    }
    // Dots
    segment.indices.forEach(idx => {
      const winterKey = Object.keys(data[idx]).find(k => k.startsWith('winterAvg_'));
      const value = winterKey ? (data[idx][winterKey] as number) : 0;
      const x = padding + idx * barSpacing + barSpacing / 2;
      const y = topPadding + chartHeight - (value / maxValue) * chartHeight;
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="${winterColor}"/>`;
    });
  });

  // Draw summer segments similarly
  const summerSegments: { indices: number[] }[] = [];
  let currentSummerSegment: number[] = [];
  data.forEach((item, index) => {
    const summerKey = Object.keys(item).find(k => k.startsWith('summerAvg_'));
    if (summerKey && item[summerKey] !== undefined) {
      currentSummerSegment.push(index);
    } else if (currentSummerSegment.length > 0) {
      summerSegments.push({ indices: currentSummerSegment });
      currentSummerSegment = [];
    }
  });
  if (currentSummerSegment.length > 0) {
    summerSegments.push({ indices: currentSummerSegment });
  }

  summerSegments.forEach(segment => {
    if (segment.indices.length > 1) {
      let linePath = '';
      segment.indices.forEach((idx, i) => {
        const summerKey = Object.keys(data[idx]).find(k => k.startsWith('summerAvg_'));
        const value = summerKey ? (data[idx][summerKey] as number) : 0;
        const x = padding + idx * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (value / maxValue) * chartHeight;
        linePath += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
      });
      svg += `<path d="${linePath}" fill="none" stroke="${summerColor}" stroke-width="2" stroke-dasharray="4,2"/>`;
    }
    segment.indices.forEach(idx => {
      const summerKey = Object.keys(data[idx]).find(k => k.startsWith('summerAvg_'));
      const value = summerKey ? (data[idx][summerKey] as number) : 0;
      const x = padding + idx * barSpacing + barSpacing / 2;
      const y = topPadding + chartHeight - (value / maxValue) * chartHeight;
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="${summerColor}"/>`;
    });
  });

  // Meter reading line (green, solid)
  if (meterReadings.length > 0) {
    let linePath = '';
    let isFirst = true;
    data.forEach((item, index) => {
      if (item.meterReading !== null && item.meterReading !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
        linePath += isFirst ? `M${x},${y}` : ` L${x},${y}`;
        isFirst = false;
      }
    });
    if (linePath) {
      svg += `<path d="${linePath}" fill="none" stroke="${meterReadingColor}" stroke-width="2"/>`;
    }

    // Meter reading dots
    data.forEach((item, index) => {
      if (item.meterReading !== null && item.meterReading !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
        svg += `<circle cx="${x}" cy="${y}" r="4" fill="${meterReadingColor}"/>`;
      }
    });

    // Right Y-axis labels for meter reading
    const numLabels = 5;
    for (let i = 0; i <= numLabels; i++) {
      const value = (maxMeterReading / numLabels) * (numLabels - i);
      const y = topPadding + (chartHeight * i / numLabels);
      svg += `<text x="${padding + chartWidth + 8}" y="${y + 4}" text-anchor="start" font-family="sans-serif" font-size="9" fill="${meterReadingColor}">${abbreviateNumber(value)}</text>`;
    }
  }

  // X-axis labels (rotated)
  data.forEach((item, index) => {
    const x = padding + index * barSpacing + barSpacing / 2;
    const y = topPadding + chartHeight + 10;
    svg += `<text x="${x}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#000000" transform="rotate(-45 ${x} ${y})">${escapeXml(item.period)}</text>`;
  });

  svg += '</svg>';
  return svg;
}

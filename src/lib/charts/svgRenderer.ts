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
  isDiscontinuous?: boolean;
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

  // Meter reading line - segmented at discontinuities
  const segments: string[] = [];
  let currentSegment = '';
  let segmentFirst = true;

  data.forEach((item, index) => {
    if (item.meterReading !== null) {
      const x = padding + index * clusterWidth + clusterWidth / 2;
      const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
      
      // If this point is discontinuous, start a new segment here
      if (item.isDiscontinuous && currentSegment) {
        segments.push(currentSegment);
        currentSegment = `M${x},${y}`;
        segmentFirst = false;
      } else {
        currentSegment += segmentFirst ? `M${x},${y}` : ` L${x},${y}`;
        segmentFirst = false;
      }
    }
  });

  // Push final segment
  if (currentSegment) segments.push(currentSegment);

  // Draw all segments
  segments.forEach(segment => {
    svg += `<path d="${segment}" fill="none" stroke="${meterReadingColor}" stroke-width="2"/>`;
  });

  // Meter reading dots - RED for discontinuous, GREEN otherwise
  data.forEach((item, index) => {
    if (item.meterReading !== null) {
      const x = padding + index * clusterWidth + clusterWidth / 2;
      const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
      const dotColor = item.isDiscontinuous ? '#ef4444' : meterReadingColor;
      const dotRadius = item.isDiscontinuous ? 5 : 4;
      const strokeAttr = item.isDiscontinuous ? ' stroke="#ffffff" stroke-width="2"' : '';
      svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${dotColor}"${strokeAttr}/>`;
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
  isDiscontinuous?: boolean;
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

  // Meter reading line (green, solid) - segmented at discontinuities
  if (meterReadings.length > 0) {
    const segments: string[] = [];
    let currentSegment = '';
    let segmentFirst = true;

    data.forEach((item, index) => {
      if (item.meterReading !== null && item.meterReading !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
        
        // If this point is discontinuous, start a new segment here
        if (item.isDiscontinuous && currentSegment) {
          segments.push(currentSegment);
          currentSegment = `M${x},${y}`;
          segmentFirst = false;
        } else {
          currentSegment += segmentFirst ? `M${x},${y}` : ` L${x},${y}`;
          segmentFirst = false;
        }
      }
    });

    // Push final segment
    if (currentSegment) segments.push(currentSegment);

    // Draw all segments
    segments.forEach(segment => {
      svg += `<path d="${segment}" fill="none" stroke="${meterReadingColor}" stroke-width="2"/>`;
    });

    // Meter reading dots - RED for discontinuous, GREEN otherwise
    data.forEach((item, index) => {
      if (item.meterReading !== null && item.meterReading !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
        const dotColor = item.isDiscontinuous ? '#ef4444' : meterReadingColor;
        const dotRadius = item.isDiscontinuous ? 5 : 4;
        const strokeAttr = item.isDiscontinuous ? ' stroke="#ffffff" stroke-width="2"' : '';
        svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${dotColor}"${strokeAttr}/>`;
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

// ==================== Assignment Chart SVG (Document vs Assigned Rate Comparison) ====================

export interface AssignmentChartDataPointSVG {
  period: string;
  documentValue: number | null;
  assignedValue: number | null;
}

/**
 * Generate an assignment rate comparison chart as SVG
 * Compares document rates vs assigned tariff rates
 */
export function generateAssignmentChartSVG(
  title: string,
  unit: string,
  data: AssignmentChartDataPointSVG[],
  width: number = 900,
  height: number = 500
): string {
  if (data.length === 0) return '';

  // Colors matching reconciliation charts pattern (gray + blue)
  const documentColor = '#3b82f6';  // Blue for Document Rate
  const assignedColor = 'rgba(156, 163, 175, 0.5)';  // Gray for Assigned Rate

  // Chart dimensions
  const padding = 60;
  const rightPadding = 60;
  const bottomPadding = 100;
  const topPadding = 70;
  const chartWidth = width - padding - rightPadding;
  const chartHeight = height - topPadding - bottomPadding;

  // Find max value
  const allValues = data.flatMap(d => [d.documentValue || 0, d.assignedValue || 0]);
  const maxValue = Math.max(...allValues, 1);

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
  const legendSpacing = 120;
  let legendX = width / 2 - legendSpacing;

  svg += `<rect x="${legendX}" y="${legendY}" width="14" height="14" fill="${documentColor}"/>`;
  svg += `<text x="${legendX + 18}" y="${legendY + 11}" font-family="sans-serif" font-size="10" fill="#000000">Document Rate</text>`;

  legendX += legendSpacing;
  svg += `<rect x="${legendX}" y="${legendY}" width="14" height="14" fill="${assignedColor}"/>`;
  svg += `<text x="${legendX + 18}" y="${legendY + 11}" font-family="sans-serif" font-size="10" fill="#000000">Assigned Rate</text>`;

  // Gridlines
  const numGridLines = 5;
  for (let i = 0; i <= numGridLines; i++) {
    const y = topPadding + (chartHeight * i / numGridLines);
    svg += `<line x1="${padding}" y1="${y}" x2="${padding + chartWidth}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="3,3"/>`;
  }

  // Bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;
    const barRadius = 4;
    
    // Document bar (left)
    const docValue = item.documentValue || 0;
    const docBarHeight = maxValue > 0 ? (docValue / maxValue) * chartHeight : 0;
    const docY = topPadding + chartHeight - docBarHeight;
    const docBarX = clusterX + 4;
    
    if (docBarHeight > 0) {
      svg += `<path d="M${docBarX},${docY + barRadius} Q${docBarX},${docY} ${docBarX + barRadius},${docY} L${docBarX + barWidth - barRadius},${docY} Q${docBarX + barWidth},${docY} ${docBarX + barWidth},${docY + barRadius} L${docBarX + barWidth},${topPadding + chartHeight} L${docBarX},${topPadding + chartHeight} Z" fill="${documentColor}"/>`;
      // Value on top
      svg += `<text x="${docBarX + barWidth / 2}" y="${docY - 4}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${abbreviateNumber(docValue)}</text>`;
    }
    
    // Assigned bar (right)
    const assignedValue = item.assignedValue || 0;
    const assignedBarHeight = maxValue > 0 ? (assignedValue / maxValue) * chartHeight : 0;
    const assignedY = topPadding + chartHeight - assignedBarHeight;
    const assignedBarX = clusterX + barWidth + 8;
    
    if (assignedBarHeight > 0) {
      svg += `<path d="M${assignedBarX},${assignedY + barRadius} Q${assignedBarX},${assignedY} ${assignedBarX + barRadius},${assignedY} L${assignedBarX + barWidth - barRadius},${assignedY} Q${assignedBarX + barWidth},${assignedY} ${assignedBarX + barWidth},${assignedY + barRadius} L${assignedBarX + barWidth},${topPadding + chartHeight} L${assignedBarX},${topPadding + chartHeight} Z" fill="${assignedColor}"/>`;
      // Value on top
      svg += `<text x="${assignedBarX + barWidth / 2}" y="${assignedY - 4}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${abbreviateNumber(assignedValue)}</text>`;
    }
  });

  // Y-axis labels (left)
  for (let i = 0; i <= numGridLines; i++) {
    const value = maxValue * (1 - i / numGridLines);
    const y = topPadding + (chartHeight * i / numGridLines);
    svg += `<text x="${padding - 8}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#374151">${abbreviateNumber(value)}</text>`;
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

// ==================== Pie Chart SVG ====================

/**
 * Generate a pie chart as SVG string
 */
export function generatePieChartSVG(
  data: number[],
  labels: string[],
  width: number = 400,
  height: number = 300
): string {
  if (data.length === 0 || data.every(v => v === 0)) return '';

  const colors = [
    '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', 
    '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
  ];

  const centerX = width / 2;
  const centerY = height / 2 - 20;
  const radius = Math.min(width, height) * 0.3;
  const total = data.reduce((sum, val) => sum + val, 0);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;

  let currentAngle = -Math.PI / 2;

  // Draw pie slices
  data.forEach((value, index) => {
    if (value <= 0) return;
    
    const sliceAngle = (value / total) * 2 * Math.PI;
    const endAngle = currentAngle + sliceAngle;
    
    const x1 = centerX + radius * Math.cos(currentAngle);
    const y1 = centerY + radius * Math.sin(currentAngle);
    const x2 = centerX + radius * Math.cos(endAngle);
    const y2 = centerY + radius * Math.sin(endAngle);
    
    const largeArcFlag = sliceAngle > Math.PI ? 1 : 0;
    const color = colors[index % colors.length];
    
    svg += `<path d="M${centerX},${centerY} L${x1},${y1} A${radius},${radius} 0 ${largeArcFlag},1 ${x2},${y2} Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>`;
    
    currentAngle = endAngle;
  });

  // Draw legend
  const legendX = 15;
  let legendY = height - (labels.length * 22) - 10;

  labels.forEach((label, index) => {
    if (data[index] <= 0) return;
    
    const color = colors[index % colors.length];
    const percentage = ((data[index] / total) * 100).toFixed(1);
    
    svg += `<rect x="${legendX}" y="${legendY}" width="12" height="12" fill="${color}"/>`;
    svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">${escapeXml(label)}: ${data[index].toLocaleString()} (${percentage}%)</text>`;
    legendY += 22;
  });

  svg += '</svg>';
  return svg;
}

// ==================== Clustered Tariff Chart SVG ====================

/**
 * Generate a clustered bar chart for winter/summer tariff comparison as SVG
 */
export function generateClusteredTariffChartSVG(
  title: string,
  unit: string,
  winterData: { label: string; value: number }[],
  summerData: { label: string; value: number }[],
  width: number = 280,
  height: number = 340
): string {
  if (winterData.length === 0) return '';

  const winterColor = '#3b82f6';  // Blue for Winter
  const summerColor = '#f97316';  // Orange for Summer

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;

  // Title
  svg += `<text x="${width / 2}" y="20" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#000000">${escapeXml(title)}</text>`;
  svg += `<text x="${width / 2}" y="35" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#000000">(${escapeXml(unit)})</text>`;

  // Legend
  const legendY = 48;
  svg += `<rect x="10" y="${legendY}" width="10" height="10" fill="${winterColor}"/>`;
  svg += `<text x="23" y="${legendY + 8}" font-family="sans-serif" font-size="9" fill="#000000">Winter</text>`;
  svg += `<rect x="60" y="${legendY}" width="10" height="10" fill="${summerColor}"/>`;
  svg += `<text x="73" y="${legendY + 8}" font-family="sans-serif" font-size="9" fill="#000000">Summer</text>`;

  const padding = 25;
  const bottomPadding = 60;
  const topPadding = 70;
  const chartWidth = width - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const clusterWidth = chartWidth / winterData.length;
  const barWidth = (clusterWidth - 6) / 2;

  const maxValue = Math.max(
    ...winterData.map(d => d.value),
    ...summerData.map(d => d.value),
    1
  );

  // Draw clustered bars
  winterData.forEach((winter, index) => {
    const summer = summerData[index];
    const clusterX = padding + index * clusterWidth;

    // Winter bar
    const winterBarHeight = maxValue > 0 ? (winter.value / maxValue) * chartHeight : 0;
    const winterY = height - bottomPadding - winterBarHeight;
    svg += `<rect x="${clusterX + 2}" y="${winterY}" width="${barWidth}" height="${winterBarHeight}" fill="${winterColor}"/>`;

    // Summer bar
    const summerBarHeight = maxValue > 0 ? (summer.value / maxValue) * chartHeight : 0;
    const summerY = height - bottomPadding - summerBarHeight;
    svg += `<rect x="${clusterX + barWidth + 4}" y="${summerY}" width="${barWidth}" height="${summerBarHeight}" fill="${summerColor}"/>`;

    // Values on top
    if (winter.value > 0) {
      svg += `<text x="${clusterX + barWidth / 2 + 2}" y="${winterY - 3}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${winter.value.toLocaleString()}</text>`;
    }
    if (summer.value > 0) {
      svg += `<text x="${clusterX + barWidth * 1.5 + 4}" y="${summerY - 3}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${summer.value.toLocaleString()}</text>`;
    }
  });

  // X-axis labels
  winterData.forEach((period, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    svg += `<text x="${x}" y="${height - bottomPadding + 15}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#000000">${escapeXml(period.label)}</text>`;
  });

  // Percentage increases
  if (winterData.length >= 2) {
    const firstWinter = winterData[0].value;
    const lastWinter = winterData[winterData.length - 1].value;

    if (firstWinter > 0) {
      const overallIncrease = ((lastWinter - firstWinter) / firstWinter * 100).toFixed(1);

      let totalYoY = 0;
      let validTransitions = 0;
      for (let i = 1; i < winterData.length; i++) {
        if (winterData[i - 1].value > 0) {
          totalYoY += (winterData[i].value - winterData[i - 1].value) / winterData[i - 1].value * 100;
          validTransitions++;
        }
      }

      if (validTransitions > 0) {
        const avgYoY = (totalYoY / validTransitions).toFixed(1);
        svg += `<text x="${width - 10}" y="${height - 30}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#666666">Overall: +${overallIncrease}%</text>`;
        svg += `<text x="${width - 10}" y="${height - 18}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#666666">Avg YoY: +${avgYoY}%</text>`;
      }
    }
  }

  svg += '</svg>';
  return svg;
}

// ==================== Tariff Comparison Chart SVG (Single Series) ====================

/**
 * Generate a simple bar chart for tariff period comparison as SVG
 */
export function generateTariffComparisonChartSVG(
  title: string,
  unit: string,
  periods: { label: string; value: number }[],
  width: number = 280,
  height: number = 340
): string {
  if (periods.length === 0) return '';

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;

  // Title
  svg += `<text x="${width / 2}" y="20" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#000000">${escapeXml(title)}</text>`;
  svg += `<text x="${width / 2}" y="35" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#000000">(${escapeXml(unit)})</text>`;

  const padding = 25;
  const bottomPadding = 60;
  const topPadding = 70;
  const chartWidth = width - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const barWidth = chartWidth / periods.length;
  const maxValue = Math.max(...periods.map(p => p.value), 1);

  // Draw bars (gray like TariffPeriodComparisonDialog)
  periods.forEach((period, index) => {
    const barHeight = maxValue > 0 ? (period.value / maxValue) * chartHeight : 0;
    const x = padding + index * barWidth;
    const y = height - bottomPadding - barHeight;

    svg += `<rect x="${x + 5}" y="${y}" width="${barWidth - 10}" height="${barHeight}" fill="#9ca3af"/>`;

    // Value on top
    if (period.value > 0) {
      svg += `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#000000">${period.value.toLocaleString()}</text>`;
    }
  });

  // X-axis labels
  periods.forEach((period, index) => {
    const x = padding + index * barWidth + barWidth / 2;
    svg += `<text x="${x}" y="${height - bottomPadding + 15}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#000000">${escapeXml(period.label)}</text>`;
  });

  // Percentage increases
  if (periods.length >= 2) {
    const firstValue = periods[0].value;
    const lastValue = periods[periods.length - 1].value;

    if (firstValue > 0) {
      const overallIncrease = ((lastValue - firstValue) / firstValue * 100).toFixed(1);

      let totalYoY = 0;
      let validTransitions = 0;
      for (let i = 1; i < periods.length; i++) {
        if (periods[i - 1].value > 0) {
          totalYoY += (periods[i].value - periods[i - 1].value) / periods[i - 1].value * 100;
          validTransitions++;
        }
      }
      const avgYoY = validTransitions > 0 ? (totalYoY / validTransitions).toFixed(1) : '0.0';

      svg += `<text x="${width - 10}" y="${height - 30}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#666666">Overall: +${overallIncrease}%</text>`;
      svg += `<text x="${width - 10}" y="${height - 18}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#666666">Avg YoY: +${avgYoY}%</text>`;
    }
  }

  svg += '</svg>';
  return svg;
}

// ==================== Document vs Assigned Chart SVG ====================

/**
 * Generate a document vs assigned comparison chart as SVG
 * Uses consistent blue/gray color scheme
 */
export function generateDocumentVsAssignedChartSVG(
  title: string,
  unit: string,
  data: { period: string; documentValue: number; assignedValue: number | null }[],
  width: number = 500,
  height: number = 320
): string {
  if (data.length === 0) return '';

  // Colors matching reconciliation charts pattern (blue + gray)
  const documentColor = '#3b82f6';  // Blue for Document
  const assignedColor = 'rgba(156, 163, 175, 0.6)';  // Gray for Assigned

  // Adjust width based on data points
  const adjustedWidth = Math.max(width, 500 + (data.length - 5) * 50);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${adjustedWidth}" height="${height}" viewBox="0 0 ${adjustedWidth} ${height}">`;
  svg += `<rect width="${adjustedWidth}" height="${height}" fill="#ffffff"/>`;

  // Title
  svg += `<text x="${adjustedWidth / 2}" y="20" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#000000">${escapeXml(title)}</text>`;
  if (unit && unit.trim()) {
    svg += `<text x="${adjustedWidth / 2}" y="35" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#000000">(${escapeXml(unit)})</text>`;
  }

  // Legend
  const legendY = 48;
  const legendX = adjustedWidth / 2 - 50;
  svg += `<rect x="${legendX}" y="${legendY}" width="12" height="12" fill="${documentColor}"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Document</text>`;
  svg += `<rect x="${legendX + 80}" y="${legendY}" width="12" height="12" fill="${assignedColor}"/>`;
  svg += `<text x="${legendX + 96}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Assigned</text>`;

  const padding = 40;
  const bottomPadding = 80;
  const topPadding = 70;
  const chartWidth = adjustedWidth - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const clusterWidth = chartWidth / data.length;
  const barWidth = Math.max((clusterWidth - 8) / 2, 15);

  const maxValue = Math.max(
    ...data.map(d => d.documentValue),
    ...data.map(d => d.assignedValue || 0),
    1
  );

  // Draw clustered bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;

    // Document bar (left)
    const docBarHeight = maxValue > 0 ? (item.documentValue / maxValue) * chartHeight : 0;
    const docY = height - bottomPadding - docBarHeight;
    svg += `<rect x="${clusterX + 4}" y="${docY}" width="${barWidth}" height="${docBarHeight}" fill="${documentColor}"/>`;

    // Assigned bar (right)
    const assignedValue = item.assignedValue || 0;
    const assignedBarHeight = maxValue > 0 ? (assignedValue / maxValue) * chartHeight : 0;
    const assignedY = height - bottomPadding - assignedBarHeight;
    svg += `<rect x="${clusterX + barWidth + 8}" y="${assignedY}" width="${barWidth}" height="${assignedBarHeight}" fill="${assignedColor}"/>`;

    // Values on top
    if (item.documentValue > 0) {
      svg += `<text x="${clusterX + 4 + barWidth / 2}" y="${docY - 4}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#000000">${abbreviateNumber(item.documentValue)}</text>`;
    }
    if (assignedValue > 0) {
      svg += `<text x="${clusterX + barWidth + 8 + barWidth / 2}" y="${assignedY - 4}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#000000">${abbreviateNumber(assignedValue)}</text>`;
    }
  });

  // X-axis labels (split into two lines)
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const periodParts = item.period.split(' - ');
    svg += `<text x="${x}" y="${height - bottomPadding + 15}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#000000">${escapeXml(periodParts[0])}</text>`;
    if (periodParts[1]) {
      svg += `<text x="${x}" y="${height - bottomPadding + 27}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#000000">${escapeXml(periodParts[1])}</text>`;
    }
  });

  svg += '</svg>';
  return svg;
}

// ==================== Reconciliation vs Document Chart SVG ====================

/**
 * Generate a reconciliation vs document comparison chart as SVG
 * Uses consistent gray/blue color scheme
 */
export function generateReconciliationVsDocumentChartSVG(
  title: string,
  data: { period: string; reconciliationValue: number; documentValue: number }[],
  width: number = 500,
  height: number = 320
): string {
  if (data.length === 0) return '';

  // Colors - Gray for Reconciliation Cost, Blue for Document Billed
  const reconciliationColor = 'rgba(156, 163, 175, 0.6)';  // Gray for Reconciliation Cost
  const documentColor = '#3b82f6';  // Blue for Document Billed

  // Adjust width based on data points
  const adjustedWidth = Math.max(width, 500 + (data.length - 5) * 50);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${adjustedWidth}" height="${height}" viewBox="0 0 ${adjustedWidth} ${height}">`;
  svg += `<rect width="${adjustedWidth}" height="${height}" fill="#ffffff"/>`;

  // Title
  svg += `<text x="${adjustedWidth / 2}" y="20" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#000000">${escapeXml(title)}</text>`;

  // Legend
  const legendY = 40;
  const legendX = adjustedWidth / 2 - 70;
  svg += `<rect x="${legendX}" y="${legendY}" width="12" height="12" fill="${reconciliationColor}"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Reconciliation Cost</text>`;
  svg += `<rect x="${legendX + 110}" y="${legendY}" width="12" height="12" fill="${documentColor}"/>`;
  svg += `<text x="${legendX + 126}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Document Billed</text>`;

  const padding = 40;
  const bottomPadding = 80;
  const topPadding = 65;
  const chartWidth = adjustedWidth - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const clusterWidth = chartWidth / data.length;
  const barWidth = Math.max((clusterWidth - 8) / 2, 15);

  const maxValue = Math.max(
    ...data.map(d => d.reconciliationValue),
    ...data.map(d => d.documentValue),
    1
  );

  // Draw clustered bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;

    // Reconciliation bar (left)
    const reconciliationBarHeight = maxValue > 0 ? (item.reconciliationValue / maxValue) * chartHeight : 0;
    const reconciliationY = height - bottomPadding - reconciliationBarHeight;
    svg += `<rect x="${clusterX + 2}" y="${reconciliationY}" width="${barWidth}" height="${reconciliationBarHeight}" fill="${reconciliationColor}"/>`;

    // Document bar (right)
    const documentBarHeight = maxValue > 0 ? (item.documentValue / maxValue) * chartHeight : 0;
    const documentY = height - bottomPadding - documentBarHeight;
    svg += `<rect x="${clusterX + barWidth + 4}" y="${documentY}" width="${barWidth}" height="${documentBarHeight}" fill="${documentColor}"/>`;

    // Values on top
    if (item.reconciliationValue > 0) {
      svg += `<text x="${clusterX + barWidth / 2 + 2}" y="${reconciliationY - 3}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${abbreviateNumber(item.reconciliationValue)}</text>`;
    }
    if (item.documentValue > 0) {
      svg += `<text x="${clusterX + barWidth * 1.5 + 4}" y="${documentY - 3}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${abbreviateNumber(item.documentValue)}</text>`;
    }
  });

  // X-axis labels (rotated)
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const y = height - bottomPadding + 10;
    svg += `<text x="${x}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#000000" transform="rotate(-45 ${x} ${y})">${escapeXml(item.period)}</text>`;
  });

  // Percentage increases
  if (data.length >= 2) {
    const firstValue = data[0].reconciliationValue;
    const lastValue = data[data.length - 1].reconciliationValue;

    if (firstValue > 0) {
      const overallIncreaseNum = ((lastValue - firstValue) / firstValue * 100);
      const overallIncrease = overallIncreaseNum.toFixed(1);

      let totalYoY = 0;
      let validTransitions = 0;
      for (let i = 1; i < data.length; i++) {
        if (data[i - 1].reconciliationValue > 0) {
          totalYoY += (data[i].reconciliationValue - data[i - 1].reconciliationValue) / data[i - 1].reconciliationValue * 100;
          validTransitions++;
        }
      }

      if (validTransitions > 0) {
        const avgYoYNum = (totalYoY / validTransitions);
        const avgYoY = avgYoYNum.toFixed(1);
        svg += `<text x="${adjustedWidth - 10}" y="${height - 30}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#666666">Overall: ${overallIncreaseNum >= 0 ? '+' : ''}${overallIncrease}%</text>`;
        svg += `<text x="${adjustedWidth - 10}" y="${height - 18}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#666666">Avg YoY: ${avgYoYNum >= 0 ? '+' : ''}${avgYoY}%</text>`;
      }
    }
  }

  svg += '</svg>';
  return svg;
}

// ==================== Tariff Analysis Chart SVG (Document with seasonal averages) ====================

/**
 * Generate a tariff analysis chart with document amounts and seasonal average lines as SVG
 */
export function generateTariffAnalysisChartSVG(
  title: string,
  unit: string,
  data: { period: string; value: number; winterAvg?: number; summerAvg?: number }[],
  width: number = 500,
  height: number = 320
): string {
  if (data.length === 0) return '';

  const barColor = '#9ca3af';  // Gray bars
  const winterLineColor = '#3b82f6';  // Blue line
  const summerLineColor = '#f97316';  // Orange line

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;

  // Title
  svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#000000">${escapeXml(title)}</text>`;
  if (unit && unit.trim()) {
    svg += `<text x="${width / 2}" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#000000">(${escapeXml(unit)})</text>`;
  }

  // Legend
  const legendY = 55;
  const legendSpacing = 110;
  let legendX = width / 2 - legendSpacing;

  svg += `<rect x="${legendX}" y="${legendY}" width="12" height="12" fill="${barColor}"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Amount</text>`;

  legendX += legendSpacing;
  svg += `<line x1="${legendX}" y1="${legendY + 6}" x2="${legendX + 12}" y2="${legendY + 6}" stroke="${winterLineColor}" stroke-width="2"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Winter Avg</text>`;

  legendX += legendSpacing;
  svg += `<line x1="${legendX}" y1="${legendY + 6}" x2="${legendX + 12}" y2="${legendY + 6}" stroke="${summerLineColor}" stroke-width="2"/>`;
  svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-family="sans-serif" font-size="10" fill="#000000">Summer Avg</text>`;

  const padding = 50;
  const bottomPadding = 100;
  const topPadding = 80;
  const chartWidth = width - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const barWidth = Math.max((chartWidth / data.length) * 0.6, 20);
  const barSpacing = chartWidth / data.length;

  const maxValue = Math.max(...data.map(d => d.value), 1);
  const scale = chartHeight / maxValue;

  // Draw bars
  data.forEach((item, index) => {
    const barHeight = item.value * scale;
    const x = padding + index * barSpacing + (barSpacing - barWidth) / 2;
    const y = topPadding + chartHeight - barHeight;

    svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${barColor}"/>`;

    // Value on top
    if (item.value > 0) {
      svg += `<text x="${x + barWidth / 2}" y="${y - 3}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#000000">${abbreviateNumber(item.value)}</text>`;
    }
  });

  // Draw winter average line
  if (data.some(d => d.winterAvg !== undefined)) {
    let linePath = '';
    let isFirst = true;
    data.forEach((item, index) => {
      if (item.winterAvg !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.winterAvg * scale);
        linePath += isFirst ? `M${x},${y}` : ` L${x},${y}`;
        isFirst = false;
      }
    });
    if (linePath) {
      svg += `<path d="${linePath}" fill="none" stroke="${winterLineColor}" stroke-width="2"/>`;
    }
  }

  // Draw summer average line
  if (data.some(d => d.summerAvg !== undefined)) {
    let linePath = '';
    let isFirst = true;
    data.forEach((item, index) => {
      if (item.summerAvg !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.summerAvg * scale);
        linePath += isFirst ? `M${x},${y}` : ` L${x},${y}`;
        isFirst = false;
      }
    });
    if (linePath) {
      svg += `<path d="${linePath}" fill="none" stroke="${summerLineColor}" stroke-width="2"/>`;
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

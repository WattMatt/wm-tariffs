/**
 * Canvas-based chart rendering utilities
 * These functions generate chart images directly using Canvas API
 */

import type { ChartDataPoint, ChartRenderOptions } from './types';
import { dataURLtoBlob } from '@/lib/storageUtils';

// Re-export for backwards compatibility
export { dataURLtoBlob };

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

export interface BarChartOptions extends ChartRenderOptions {
  title?: string;
  unit?: string;
  seriesKeys: string[];  // Which keys from values to render as bars
  seriesLabels?: Record<string, string>;  // Display labels for series
  seriesColors?: Record<string, string>;  // Colors for series
  percentChange?: number | null;  // Total period percentage change
  avgYoyChange?: number | null;   // Average year-on-year change
}

/**
 * Generate a bar chart (single or clustered) using Canvas API
 */
export function generateBarChart(
  data: ChartDataPoint[],
  options: BarChartOptions
): string {
  const {
    width = 400,
    height = 300,
    scaleFactor = 2,
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

  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;

  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx || data.length === 0) return '';

  // Clear canvas with background
  ctx.fillStyle = colors.background || DEFAULT_COLORS.background;
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);

  // Chart dimensions
  const padding = 50 * scaleFactor;
  const bottomPadding = 80 * scaleFactor;
  const topPadding = showLegend ? 80 * scaleFactor : 50 * scaleFactor;
  const chartWidth = scaledWidth - padding * 2;
  const chartHeight = scaledHeight - topPadding - bottomPadding;

  // Draw title
  if (title) {
    ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
    ctx.font = `bold ${14 * scaleFactor}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(title, scaledWidth / 2, 25 * scaleFactor);

    if (unit) {
      ctx.font = `${11 * scaleFactor}px sans-serif`;
      ctx.fillText(`(${unit})`, scaledWidth / 2, 42 * scaleFactor);
    }
  }

  // Draw percentage change indicators
  if (percentChange !== undefined && percentChange !== null) {
    const changeY = 58 * scaleFactor;
    const isIncrease = percentChange > 0;
    
    // Draw trend arrow + percentage
    ctx.font = `bold ${11 * scaleFactor}px sans-serif`;
    ctx.fillStyle = isIncrease ? '#ef4444' : '#22c55e'; // red for increase, green for decrease
    const arrow = isIncrease ? '↗' : '↘';
    const sign = isIncrease ? '+' : '';
    const percentText = `${arrow} ${sign}${percentChange.toFixed(1)}%`;
    
    // Center the combined text
    ctx.textAlign = 'center';
    let xOffset = scaledWidth / 2;
    
    if (avgYoyChange !== undefined && avgYoyChange !== null) {
      // If we have both, offset the main percentage to the left
      xOffset = scaledWidth / 2 - 50 * scaleFactor;
    }
    
    ctx.fillText(percentText, xOffset, changeY);
    
    // Draw avg YoY next to it
    if (avgYoyChange !== undefined && avgYoyChange !== null) {
      const avgXOffset = scaledWidth / 2 + 30 * scaleFactor;
      const avgIsIncrease = avgYoyChange > 0;
      
      ctx.font = `${9 * scaleFactor}px sans-serif`;
      ctx.fillStyle = '#6b7280'; // muted gray for label
      ctx.textAlign = 'left';
      ctx.fillText('Avg YoY:', avgXOffset - 35 * scaleFactor, changeY);
      
      ctx.font = `bold ${10 * scaleFactor}px sans-serif`;
      ctx.fillStyle = avgIsIncrease ? '#ef4444' : '#22c55e';
      const avgSign = avgIsIncrease ? '+' : '';
      ctx.fillText(`${avgSign}${avgYoyChange.toFixed(1)}%`, avgXOffset + 10 * scaleFactor, changeY);
    }
  }

  // Draw legend
  if (showLegend && seriesKeys.length > 0) {
    const legendY = 55 * scaleFactor;
    const legendSpacing = 120 * scaleFactor;
    let legendX = scaledWidth / 2 - (seriesKeys.length * legendSpacing) / 2;

    seriesKeys.forEach((key, i) => {
      const color = seriesColors[key] || Object.values(DEFAULT_COLORS)[i % 3];
      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY, 12 * scaleFactor, 12 * scaleFactor);
      ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
      ctx.font = `${10 * scaleFactor}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(seriesLabels[key] || key, legendX + 16 * scaleFactor, legendY + 10 * scaleFactor);
      legendX += legendSpacing;
    });
  }

  // Find max value
  const allValues = data.flatMap(d => 
    seriesKeys.map(key => d.values[key] || 0)
  );
  const maxValue = Math.max(...allValues, 1);

  // Draw gridlines
  if (showGrid) {
    ctx.strokeStyle = colors.grid || DEFAULT_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([3 * scaleFactor, 3 * scaleFactor]);
    for (let i = 0; i <= 5; i++) {
      const y = topPadding + (chartHeight * i / 5);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + chartWidth, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Calculate bar dimensions
  const clusterWidth = chartWidth / data.length;
  const barCount = seriesKeys.length;
  const barWidth = Math.max((clusterWidth - 12 * scaleFactor) / barCount, 15 * scaleFactor);

  // Draw bars
  data.forEach((item, dataIndex) => {
    const clusterX = padding + dataIndex * clusterWidth;

    seriesKeys.forEach((key, keyIndex) => {
      const value = item.values[key] || 0;
      const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
      const barX = clusterX + keyIndex * (barWidth + 4 * scaleFactor) + 4 * scaleFactor;
      const barY = topPadding + chartHeight - barHeight;

      ctx.fillStyle = seriesColors[key] || Object.values(DEFAULT_COLORS)[keyIndex % 3];
      
      // Draw bar with rounded top corners
      const barRadius = 4 * scaleFactor;
      ctx.beginPath();
      ctx.moveTo(barX, barY + barRadius);
      ctx.arcTo(barX, barY, barX + barRadius, barY, barRadius);
      ctx.arcTo(barX + barWidth, barY, barX + barWidth, barY + barRadius, barRadius);
      ctx.lineTo(barX + barWidth, topPadding + chartHeight);
      ctx.lineTo(barX, topPadding + chartHeight);
      ctx.closePath();
      ctx.fill();

      // Draw value on top
      if (showValues && value > 0) {
        ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
        ctx.font = `bold ${9 * scaleFactor}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(abbreviateNumber(value), barX + barWidth / 2, barY - 4 * scaleFactor);
      }
    });
  });

  // Draw X-axis labels
  ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
  ctx.font = `${9 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'center';
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    ctx.fillText(item.label, x, scaledHeight - bottomPadding + 15 * scaleFactor);
  });

  // Draw axes
  ctx.strokeStyle = colors.grid || DEFAULT_COLORS.grid;
  ctx.lineWidth = 1 * scaleFactor;
  ctx.beginPath();
  ctx.moveTo(padding, topPadding);
  ctx.lineTo(padding, topPadding + chartHeight);
  ctx.lineTo(padding + chartWidth, topPadding + chartHeight);
  ctx.stroke();

  return canvas.toDataURL('image/png');
}

export interface ComboChartOptions extends BarChartOptions {
  lineSeriesKey?: string;  // Which key to render as a line
  lineSeriesLabel?: string;
  lineSeriesColor?: string;
}

/**
 * Generate a combo chart (bars + line) using Canvas API
 */
export function generateComboChart(
  data: ChartDataPoint[],
  options: ComboChartOptions
): string {
  const {
    width = 900,
    height = 500,
    scaleFactor = 2,
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
    showValues = true,
  } = options;

  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;

  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx || data.length === 0) return '';

  // Clear canvas with background
  ctx.fillStyle = colors.background || DEFAULT_COLORS.background;
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);

  // Chart dimensions
  const padding = 60 * scaleFactor;
  const rightPadding = 80 * scaleFactor;
  const bottomPadding = 100 * scaleFactor;
  const topPadding = showLegend ? 75 * scaleFactor : 50 * scaleFactor;
  const chartWidth = scaledWidth - padding - rightPadding;
  const chartHeight = scaledHeight - topPadding - bottomPadding;

  // Draw title
  if (title) {
    ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
    ctx.font = `bold ${14 * scaleFactor}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(title, scaledWidth / 2, 25 * scaleFactor);

    if (unit) {
      ctx.font = `${11 * scaleFactor}px sans-serif`;
      ctx.fillText(`(${unit})`, scaledWidth / 2, 42 * scaleFactor);
    }
  }

  // Draw legend
  if (showLegend) {
    const allSeries = [...seriesKeys, ...(lineSeriesKey ? [lineSeriesKey] : [])];
    const legendY = 55 * scaleFactor;
    const legendSpacing = 140 * scaleFactor;
    let legendX = scaledWidth / 2 - (allSeries.length * legendSpacing) / 2;

    seriesKeys.forEach((key, i) => {
      const color = seriesColors[key] || Object.values(DEFAULT_COLORS)[i % 3];
      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY, 14 * scaleFactor, 14 * scaleFactor);
      ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
      ctx.font = `${10 * scaleFactor}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(seriesLabels[key] || key, legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
      legendX += legendSpacing;
    });

    // Line series legend
    if (lineSeriesKey) {
      ctx.strokeStyle = lineSeriesColor;
      ctx.lineWidth = 2 * scaleFactor;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY + 7 * scaleFactor);
      ctx.lineTo(legendX + 14 * scaleFactor, legendY + 7 * scaleFactor);
      ctx.stroke();
      ctx.fillStyle = lineSeriesColor;
      ctx.beginPath();
      ctx.arc(legendX + 7 * scaleFactor, legendY + 7 * scaleFactor, 3 * scaleFactor, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
      ctx.fillText(lineSeriesLabel || lineSeriesKey, legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
    }
  }

  // Find max values for bars
  const barValues = data.flatMap(d => seriesKeys.map(key => d.values[key] || 0));
  const maxBarValue = Math.max(...barValues, 1);

  // Find max value for line
  const lineValues = lineSeriesKey 
    ? data.map(d => d.values[lineSeriesKey]).filter((v): v is number => v !== null && v !== undefined)
    : [];
  const maxLineValue = lineValues.length > 0 ? Math.max(...lineValues) : 1;

  // Draw gridlines
  if (showGrid) {
    ctx.strokeStyle = colors.grid || DEFAULT_COLORS.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([3 * scaleFactor, 3 * scaleFactor]);
    for (let i = 0; i <= 5; i++) {
      const y = topPadding + (chartHeight * i / 5);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + chartWidth, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Calculate bar dimensions
  const clusterWidth = chartWidth / data.length;
  const barCount = seriesKeys.length;
  const barWidth = Math.max((clusterWidth - 12 * scaleFactor) / barCount, 20 * scaleFactor);

  // Draw bars
  data.forEach((item, dataIndex) => {
    const clusterX = padding + dataIndex * clusterWidth;

    seriesKeys.forEach((key, keyIndex) => {
      const value = item.values[key] || 0;
      const barHeight = maxBarValue > 0 ? (value / maxBarValue) * chartHeight : 0;
      const barX = clusterX + keyIndex * (barWidth + 4 * scaleFactor) + 4 * scaleFactor;
      const barY = topPadding + chartHeight - barHeight;

      ctx.fillStyle = seriesColors[key] || Object.values(DEFAULT_COLORS)[keyIndex % 3];
      
      // Draw bar with rounded top corners
      const barRadius = 4 * scaleFactor;
      ctx.beginPath();
      ctx.moveTo(barX, barY + barRadius);
      ctx.arcTo(barX, barY, barX + barRadius, barY, barRadius);
      ctx.arcTo(barX + barWidth, barY, barX + barWidth, barY + barRadius, barRadius);
      ctx.lineTo(barX + barWidth, topPadding + chartHeight);
      ctx.lineTo(barX, topPadding + chartHeight);
      ctx.closePath();
      ctx.fill();
    });
  });

  // Draw line series
  if (lineSeriesKey) {
    ctx.strokeStyle = lineSeriesColor;
    ctx.lineWidth = 2 * scaleFactor;
    ctx.beginPath();
    let isFirstPoint = true;

    data.forEach((item, index) => {
      const value = item.values[lineSeriesKey];
      if (value !== null && value !== undefined) {
        const x = padding + index * clusterWidth + clusterWidth / 2;
        const y = topPadding + chartHeight - (value / maxLineValue) * chartHeight;

        if (isFirstPoint) {
          ctx.moveTo(x, y);
          isFirstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();

    // Draw dots
    ctx.fillStyle = lineSeriesColor;
    data.forEach((item, index) => {
      const value = item.values[lineSeriesKey];
      if (value !== null && value !== undefined) {
        const x = padding + index * clusterWidth + clusterWidth / 2;
        const y = topPadding + chartHeight - (value / maxLineValue) * chartHeight;
        ctx.beginPath();
        ctx.arc(x, y, 4 * scaleFactor, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }

  // Draw X-axis labels (rotated)
  ctx.save();
  ctx.fillStyle = colors.text || DEFAULT_COLORS.text;
  ctx.font = `${9 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'right';
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const y = topPadding + chartHeight + 10 * scaleFactor;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(item.label, 0, 0);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-x, -y);
  });
  ctx.restore();

  return canvas.toDataURL('image/png');
}

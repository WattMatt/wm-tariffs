// Utility to generate chart images for preview
export const generateChartImage = (
  type: 'pie' | 'bar',
  data: number[],
  labels: string[],
  width: number = 400,
  height: number = 300
): string => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return '';
  
  // Clear canvas
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
    '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
  ];
  
  if (type === 'pie') {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;
    
    const total = data.reduce((sum, val) => sum + val, 0);
    let currentAngle = -Math.PI / 2;
    
    // Draw pie slices
    data.forEach((value, index) => {
      const sliceAngle = (value / total) * 2 * Math.PI;
      const endAngle = currentAngle + sliceAngle;
      
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, currentAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = colors[index % colors.length];
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      currentAngle = endAngle;
    });
    
    // Draw legend
    const legendX = 20;
    let legendY = height - (labels.length * 25) - 20;
    
    ctx.font = '12px sans-serif';
    labels.forEach((label, index) => {
      // Color box
      ctx.fillStyle = colors[index % colors.length];
      ctx.fillRect(legendX, legendY, 15, 15);
      
      // Label text
      ctx.fillStyle = '#000000';
      const percentage = ((data[index] / total) * 100).toFixed(1);
      ctx.fillText(`${label}: ${data[index].toLocaleString()} (${percentage}%)`, legendX + 20, legendY + 12);
      legendY += 25;
    });
  } else if (type === 'bar') {
    const padding = 60;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const barWidth = chartWidth / data.length;
    const maxValue = Math.max(...data);
    
    // Draw bars
    data.forEach((value, index) => {
      const barHeight = (value / maxValue) * chartHeight;
      const x = padding + index * barWidth;
      const y = height - padding - barHeight;
      
      ctx.fillStyle = colors[index % colors.length];
      ctx.fillRect(x + 5, y, barWidth - 10, barHeight);
      
      // Draw value on top
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(value.toLocaleString(), x + barWidth / 2, y - 5);
    });
    
    // Draw X-axis labels
    ctx.fillStyle = '#000000';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    labels.forEach((label, index) => {
      const x = padding + index * barWidth + barWidth / 2;
      const words = label.split(' ');
      words.forEach((word, wordIndex) => {
        ctx.fillText(word, x, height - padding + 15 + wordIndex * 12);
      });
    });
    
    // Draw Y-axis
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
  }
  
  return canvas.toDataURL('image/png');
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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx || winterData.length === 0) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Colors
  const winterColor = '#3b82f6';  // Blue for Winter
  const summerColor = '#f59e0b';  // Orange for Summer
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 20);
  
  // Draw unit
  ctx.font = '11px sans-serif';
  ctx.fillText(`(${unit})`, width / 2, 35);
  
  // Draw legend
  const legendY = 48;
  const legendX = 10;
  
  ctx.fillStyle = winterColor;
  ctx.fillRect(legendX, legendY, 10, 10);
  ctx.fillStyle = '#000000';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Winter', legendX + 13, legendY + 8);
  
  ctx.fillStyle = summerColor;
  ctx.fillRect(legendX + 50, legendY, 10, 10);
  ctx.fillStyle = '#000000';
  ctx.fillText('Summer', legendX + 63, legendY + 8);
  
  const padding = 25;
  const bottomPadding = 60;
  const topPadding = 70;
  const chartWidth = width - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const clusterWidth = chartWidth / winterData.length;
  const barWidth = (clusterWidth - 6) / 2;  // Two bars with small gap
  
  const maxValue = Math.max(
    ...winterData.map(d => d.value),
    ...summerData.map(d => d.value)
  );
  
  // Draw clustered bars
  winterData.forEach((winter, index) => {
    const summer = summerData[index];
    const clusterX = padding + index * clusterWidth;
    
    // Winter bar (left)
    const winterBarHeight = maxValue > 0 ? (winter.value / maxValue) * chartHeight : 0;
    const winterY = height - bottomPadding - winterBarHeight;
    ctx.fillStyle = winterColor;
    ctx.fillRect(clusterX + 2, winterY, barWidth, winterBarHeight);
    
    // Summer bar (right)
    const summerBarHeight = maxValue > 0 ? (summer.value / maxValue) * chartHeight : 0;
    const summerY = height - bottomPadding - summerBarHeight;
    ctx.fillStyle = summerColor;
    ctx.fillRect(clusterX + barWidth + 4, summerY, barWidth, summerBarHeight);
    
    // Draw values on top of bars
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    if (winter.value > 0) {
      ctx.fillText(winter.value.toLocaleString(), clusterX + barWidth / 2 + 2, winterY - 3);
    }
    if (summer.value > 0) {
      ctx.fillText(summer.value.toLocaleString(), clusterX + barWidth * 1.5 + 4, summerY - 3);
    }
  });
  
  // Draw X-axis labels (period labels - just the year)
  ctx.fillStyle = '#000000';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  winterData.forEach((period, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    ctx.fillText(period.label, x, height - bottomPadding + 15);
  });
  
  // Calculate and display percentage increases at BOTTOM (if enough data)
  if (winterData.length >= 2) {
    const firstWinter = winterData[0].value;
    const lastWinter = winterData[winterData.length - 1].value;
    
    if (firstWinter > 0) {
      const overallIncrease = ((lastWinter - firstWinter) / firstWinter * 100).toFixed(1);
      
      // Calculate YoY average increase
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
        
        // Draw percentage text at bottom right (below X-axis labels)
        ctx.fillStyle = '#666666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`Overall: +${overallIncrease}%`, width - 10, height - 30);
        ctx.fillText(`Avg YoY: +${avgYoY}%`, width - 10, height - 18);
      }
    }
  }
  
  return canvas.toDataURL('image/png');
};

// Helper function to abbreviate large numbers
const abbreviateNumber = (value: number): string => {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  } else if (value >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  return value.toFixed(1);
};

export const generateTariffAnalysisChart = (
  title: string,
  unit: string,
  data: { period: string; value: number; winterAvg?: number; summerAvg?: number }[],
  width: number = 500,
  height: number = 320,
  scaleFactor: number = 3
): string => {
  const canvas = document.createElement('canvas');
  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);
  
  // Colors
  const barColor = '#9ca3af';  // Gray bars
  const winterLineColor = '#3b82f6';  // Blue line
  const summerLineColor = '#f97316';  // Orange line
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${14 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(title, scaledWidth / 2, 25 * scaleFactor);
  
  // Draw unit
  if (unit && unit.trim()) {
    ctx.font = `${11 * scaleFactor}px sans-serif`;
    ctx.fillText(`(${unit})`, scaledWidth / 2, 42 * scaleFactor);
  }
  
  // Draw legend
  const legendY = 55 * scaleFactor;
  const legendSpacing = 110 * scaleFactor;
  let legendX = scaledWidth / 2 - legendSpacing;
  
  ctx.fillStyle = barColor;
  ctx.fillRect(legendX, legendY, 12 * scaleFactor, 12 * scaleFactor);
  ctx.fillStyle = '#000000';
  ctx.font = `${10 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('Amount', legendX + 16 * scaleFactor, legendY + 10 * scaleFactor);
  
  legendX += legendSpacing;
  ctx.strokeStyle = winterLineColor;
  ctx.lineWidth = 2 * scaleFactor;
  ctx.beginPath();
  ctx.moveTo(legendX, legendY + 6 * scaleFactor);
  ctx.lineTo(legendX + 12 * scaleFactor, legendY + 6 * scaleFactor);
  ctx.stroke();
  ctx.fillText('Winter Avg', legendX + 16 * scaleFactor, legendY + 10 * scaleFactor);
  
  legendX += legendSpacing;
  ctx.strokeStyle = summerLineColor;
  ctx.beginPath();
  ctx.moveTo(legendX, legendY + 6 * scaleFactor);
  ctx.lineTo(legendX + 12 * scaleFactor, legendY + 6 * scaleFactor);
  ctx.stroke();
  ctx.fillText('Summer Avg', legendX + 16 * scaleFactor, legendY + 10 * scaleFactor);
  
  // Chart area
  const padding = 50 * scaleFactor;
  const bottomPadding = 100 * scaleFactor;
  const topPadding = 80 * scaleFactor;
  const chartWidth = scaledWidth - padding * 2;
  const chartHeight = scaledHeight - topPadding - bottomPadding;
  const barWidth = Math.max((chartWidth / data.length) * 0.6, 20 * scaleFactor);
  const barSpacing = chartWidth / data.length;
  
  // Find max value for scaling
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const scale = chartHeight / maxValue;
  
  // Draw bars
  data.forEach((item, index) => {
    const barHeight = item.value * scale;
    const x = padding + index * barSpacing + (barSpacing - barWidth) / 2;
    const y = topPadding + chartHeight - barHeight;
    
    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, barWidth, barHeight);
    
    // Draw value on top
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${9 * scaleFactor}px sans-serif`;
    ctx.textAlign = 'center';
    if (item.value > 0) {
      ctx.fillText(abbreviateNumber(item.value), x + barWidth / 2, y - 3 * scaleFactor);
    }
  });
  
  // Draw average lines
  if (data.some(d => d.winterAvg !== undefined)) {
    ctx.strokeStyle = winterLineColor;
    ctx.lineWidth = 2 * scaleFactor;
    ctx.beginPath();
    data.forEach((item, index) => {
      if (item.winterAvg !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.winterAvg * scale);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();
  }
  
  if (data.some(d => d.summerAvg !== undefined)) {
    ctx.strokeStyle = summerLineColor;
    ctx.lineWidth = 2 * scaleFactor;
    ctx.beginPath();
    data.forEach((item, index) => {
      if (item.summerAvg !== undefined) {
        const x = padding + index * barSpacing + barSpacing / 2;
        const y = topPadding + chartHeight - (item.summerAvg * scale);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();
  }
  
  // Draw x-axis labels (rotated)
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.font = `${9 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'right';
  data.forEach((item, index) => {
    const x = padding + index * barSpacing + barSpacing / 2;
    const y = topPadding + chartHeight + 10 * scaleFactor;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(item.period, 0, 0);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-x, -y);
  });
  ctx.restore();
  
  return canvas.toDataURL('image/png');
};

export const generateDocumentVsAssignedChart = (
  title: string,
  unit: string,
  data: { period: string; documentValue: number; assignedValue: number | null }[],
  width: number = 400,
  height: number = 300,
  scaleFactor: number = 3
): string => {
  // Dynamically adjust width based on number of data points
  const adjustedWidth = Math.max(width, 500 + (data.length - 5) * 50);
  
  // Scale all dimensions for high-resolution output
  const scaledWidth = adjustedWidth * scaleFactor;
  const scaledHeight = height * scaleFactor;
  
  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx || data.length === 0) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);
  
  // Colors matching the reference image
  const documentColor = '#3b82f6';  // Blue for Document
  const assignedColor = '#f59e0b';  // Orange for Assigned
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${12 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(title, scaledWidth / 2, 20 * scaleFactor);
  
  // Draw unit (only if provided)
  if (unit && unit.trim()) {
    ctx.font = `${10 * scaleFactor}px sans-serif`;
    ctx.fillText(`(${unit})`, scaledWidth / 2, 35 * scaleFactor);
  }
  
  // Draw legend
  const legendY = 48 * scaleFactor;
  const legendX = scaledWidth / 2 - 50 * scaleFactor;
  
  ctx.fillStyle = documentColor;
  ctx.fillRect(legendX, legendY, 12 * scaleFactor, 12 * scaleFactor);
  ctx.fillStyle = '#000000';
  ctx.font = `${10 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('Document', legendX + 16 * scaleFactor, legendY + 10 * scaleFactor);
  
  ctx.fillStyle = assignedColor;
  ctx.fillRect(legendX + 80 * scaleFactor, legendY, 12 * scaleFactor, 12 * scaleFactor);
  ctx.fillStyle = '#000000';
  ctx.fillText('Assigned', legendX + 96 * scaleFactor, legendY + 10 * scaleFactor);
  
  const padding = 40 * scaleFactor;
  const bottomPadding = 80 * scaleFactor;
  const topPadding = 70 * scaleFactor;
  const chartWidth = scaledWidth - padding * 2;
  const chartHeight = scaledHeight - topPadding - bottomPadding;
  const clusterWidth = chartWidth / data.length;
  const barWidth = Math.max((clusterWidth - 8 * scaleFactor) / 2, 15 * scaleFactor);
  
  const maxValue = Math.max(
    ...data.map(d => d.documentValue),
    ...data.map(d => d.assignedValue || 0)
  );
  
  // Draw clustered bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;
    
    // Document bar (left)
    const docBarHeight = maxValue > 0 ? (item.documentValue / maxValue) * chartHeight : 0;
    const docY = scaledHeight - bottomPadding - docBarHeight;
    ctx.fillStyle = documentColor;
    ctx.fillRect(clusterX + 4 * scaleFactor, docY, barWidth, docBarHeight);
    
    // Assigned bar (right)
    const assignedValue = item.assignedValue || 0;
    const assignedBarHeight = maxValue > 0 ? (assignedValue / maxValue) * chartHeight : 0;
    const assignedY = scaledHeight - bottomPadding - assignedBarHeight;
    ctx.fillStyle = assignedColor;
    ctx.fillRect(clusterX + barWidth + 8 * scaleFactor, assignedY, barWidth, assignedBarHeight);
    
    // Draw abbreviated values on top of bars (centered on each bar)
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${10 * scaleFactor}px sans-serif`;
    ctx.textAlign = 'center';
    
    if (item.documentValue > 0) {
      ctx.fillText(abbreviateNumber(item.documentValue), clusterX + 4 * scaleFactor + barWidth / 2, docY - 4 * scaleFactor);
    }
    if (assignedValue > 0) {
      ctx.fillText(abbreviateNumber(assignedValue), clusterX + barWidth + 8 * scaleFactor + barWidth / 2, assignedY - 4 * scaleFactor);
    }
  });
  
  // Draw X-axis labels (period labels - split into two lines if needed)
  ctx.fillStyle = '#000000';
  ctx.font = `${9 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'center';
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const periodParts = item.period.split(' - ');
    ctx.fillText(periodParts[0], x, scaledHeight - bottomPadding + 15 * scaleFactor);
    if (periodParts[1]) {
      ctx.fillText(periodParts[1], x, scaledHeight - bottomPadding + 27 * scaleFactor);
    }
  });
  
  // Draw Y-axis
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1 * scaleFactor;
  ctx.beginPath();
  ctx.moveTo(padding, topPadding);
  ctx.lineTo(padding, scaledHeight - bottomPadding);
  ctx.lineTo(scaledWidth - padding, scaledHeight - bottomPadding);
  ctx.stroke();
  
  return canvas.toDataURL('image/png');
};

export const generateTariffComparisonChart = (
  title: string,
  unit: string,
  periods: { label: string; value: number }[],
  width: number = 280,
  height: number = 340
): string => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx || periods.length === 0) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 20);
  
  // Draw unit
  ctx.font = '11px sans-serif';
  ctx.fillText(`(${unit})`, width / 2, 35);
  
  const padding = 25;
  const bottomPadding = 60;
  const topPadding = 70;
  const chartWidth = width - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const barWidth = chartWidth / periods.length;
  const maxValue = Math.max(...periods.map(p => p.value));
  
  // Draw bars
  periods.forEach((period, index) => {
    const barHeight = maxValue > 0 ? (period.value / maxValue) * chartHeight : 0;
    const x = padding + index * barWidth;
    const y = height - bottomPadding - barHeight;
    
    // Grey bars like TariffPeriodComparisonDialog
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(x + 5, y, barWidth - 10, barHeight);
    
    // Draw value on top
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(period.value.toLocaleString(), x + barWidth / 2, y - 5);
  });
  
  // Draw X-axis labels (just the year)
  ctx.fillStyle = '#000000';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  periods.forEach((period, index) => {
    const x = padding + index * barWidth + barWidth / 2;
    ctx.fillText(period.label, x, height - bottomPadding + 15);
  });
  
  // Draw Y-axis
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, topPadding);
  ctx.lineTo(padding, height - bottomPadding);
  ctx.lineTo(width - padding, height - bottomPadding);
  ctx.stroke();
  
  // Calculate and display percentage increases at BOTTOM
  if (periods.length >= 2) {
    const firstValue = periods[0].value;
    const lastValue = periods[periods.length - 1].value;
    
    if (firstValue > 0) {
      const overallIncrease = ((lastValue - firstValue) / firstValue * 100).toFixed(1);
      
      // Calculate YoY average
      let totalYoY = 0;
      let validTransitions = 0;
      for (let i = 1; i < periods.length; i++) {
        if (periods[i - 1].value > 0) {
          totalYoY += (periods[i].value - periods[i - 1].value) / periods[i - 1].value * 100;
          validTransitions++;
        }
      }
      const avgYoY = validTransitions > 0 ? (totalYoY / validTransitions).toFixed(1) : '0.0';
      
      // Draw percentage text at bottom right (below X-axis labels)
      ctx.fillStyle = '#666666';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`Overall: +${overallIncrease}%`, width - 10, height - 30);
      ctx.fillText(`Avg YoY: +${avgYoY}%`, width - 10, height - 18);
    }
  }
  
  return canvas.toDataURL('image/png');
};

export const generateReconciliationVsDocumentChart = (
  title: string,
  data: { period: string; reconciliationValue: number; documentValue: number }[],
  width: number = 400,
  height: number = 300
): string => {
  // Dynamically adjust width based on number of data points
  const adjustedWidth = Math.max(width, 500 + (data.length - 5) * 50);
  
  const canvas = document.createElement('canvas');
  canvas.width = adjustedWidth;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx || data.length === 0) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, adjustedWidth, height);
  
  // Colors - Grey for Reconciliation Cost, Blue for Document Billed
  const reconciliationColor = '#9ca3af';  // Grey for Reconciliation Cost
  const documentColor = '#3b82f6';  // Blue for Document Billed
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, adjustedWidth / 2, 20);
  
  // Draw legend
  const legendY = 40;
  const legendX = adjustedWidth / 2 - 70;
  
  ctx.fillStyle = reconciliationColor;
  ctx.fillRect(legendX, legendY, 12, 12);
  ctx.fillStyle = '#000000';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Reconciliation Cost', legendX + 16, legendY + 10);
  
  ctx.fillStyle = documentColor;
  ctx.fillRect(legendX + 110, legendY, 12, 12);
  ctx.fillStyle = '#000000';
  ctx.fillText('Document Billed', legendX + 126, legendY + 10);
  
  const padding = 40;
  const bottomPadding = 80;
  const topPadding = 65;
  const chartWidth = adjustedWidth - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const clusterWidth = chartWidth / data.length;
  const barWidth = Math.max((clusterWidth - 8) / 2, 15);  // Two bars with gap
  
  const maxValue = Math.max(
    ...data.map(d => d.reconciliationValue),
    ...data.map(d => d.documentValue)
  );
  
  // Draw clustered bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;
    
    // Reconciliation bar (left)
    const reconciliationBarHeight = maxValue > 0 ? (item.reconciliationValue / maxValue) * chartHeight : 0;
    const reconciliationY = height - bottomPadding - reconciliationBarHeight;
    ctx.fillStyle = reconciliationColor;
    ctx.fillRect(clusterX + 2, reconciliationY, barWidth, reconciliationBarHeight);
    
    // Document bar (right)
    const documentBarHeight = maxValue > 0 ? (item.documentValue / maxValue) * chartHeight : 0;
    const documentY = height - bottomPadding - documentBarHeight;
    ctx.fillStyle = documentColor;
    ctx.fillRect(clusterX + barWidth + 4, documentY, barWidth, documentBarHeight);
    
    // Draw values on top of bars
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    if (item.reconciliationValue > 0) {
      ctx.fillText(abbreviateNumber(item.reconciliationValue), clusterX + barWidth / 2 + 2, reconciliationY - 3);
    }
    if (item.documentValue > 0) {
      ctx.fillText(abbreviateNumber(item.documentValue), clusterX + barWidth * 1.5 + 4, documentY - 3);
    }
  });
  
  // Draw X-axis labels (rotated)
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const y = height - bottomPadding + 10;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(item.period, 0, 0);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-x, -y);
  });
  ctx.restore();
  
  // Calculate and display overall and YoY percentage increases (bottom right)
  if (data.length >= 2) {
    const firstValue = data[0].reconciliationValue;
    const lastValue = data[data.length - 1].reconciliationValue;
    
    if (firstValue > 0) {
      const overallIncreaseNum = ((lastValue - firstValue) / firstValue * 100);
      const overallIncrease = overallIncreaseNum.toFixed(1);
      
      // Calculate YoY average increase
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
        
        // Draw percentage text at bottom right
        ctx.fillStyle = '#666666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`Overall: ${overallIncreaseNum >= 0 ? '+' : ''}${overallIncrease}%`, adjustedWidth - 10, height - 30);
        ctx.fillText(`Avg YoY: ${avgYoYNum >= 0 ? '+' : ''}${avgYoY}%`, adjustedWidth - 10, height - 18);
      }
    }
  }
  
  return canvas.toDataURL('image/png');
};

// Interface for reconciliation chart data
export interface ReconciliationChartDataPoint {
  period: string;
  amount: number | null;        // Reconciliation cost
  documentAmount: number | null; // Document billed
  meterReading: number | null;   // Meter reading value
}

/**
 * Generate a reconciliation meter chart using Canvas API (fast, no DOM rendering)
 * Creates a clustered bar chart with bars for Reconciliation Cost and Document Billed,
 * plus a line for Meter Reading on a secondary Y-axis.
 */
export const generateReconciliationMeterChart = (
  title: string,
  unit: string,
  data: ReconciliationChartDataPoint[],
  width: number = 900,
  height: number = 500,
  scaleFactor: number = 2
): string => {
  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;
  
  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx || data.length === 0) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);
  
  // Colors matching the UI
  const reconciliationColor = 'rgba(156, 163, 175, 0.5)';  // Gray with opacity for Reconciliation Cost
  const documentColor = '#3b82f6';  // Primary blue for Document Billed
  const meterReadingColor = '#22c55e';  // Green for Meter Reading line
  
  // Chart dimensions
  const padding = 60 * scaleFactor;
  const rightPadding = 80 * scaleFactor;
  const bottomPadding = 100 * scaleFactor;
  const topPadding = 70 * scaleFactor;
  const chartWidth = scaledWidth - padding - rightPadding;
  const chartHeight = scaledHeight - topPadding - bottomPadding;
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${14 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(title, scaledWidth / 2, 25 * scaleFactor);
  
  // Draw unit
  if (unit && unit.trim()) {
    ctx.font = `${11 * scaleFactor}px sans-serif`;
    ctx.fillText(`(${unit})`, scaledWidth / 2, 42 * scaleFactor);
  }
  
  // Draw legend
  const legendY = 55 * scaleFactor;
  const legendSpacing = 140 * scaleFactor;
  let legendX = scaledWidth / 2 - legendSpacing * 1.2;
  
  // Reconciliation Cost legend
  ctx.fillStyle = reconciliationColor;
  ctx.fillRect(legendX, legendY, 14 * scaleFactor, 14 * scaleFactor);
  ctx.fillStyle = '#000000';
  ctx.font = `${10 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('Reconciliation Cost', legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
  
  // Document Billed legend
  legendX += legendSpacing;
  ctx.fillStyle = documentColor;
  ctx.fillRect(legendX, legendY, 14 * scaleFactor, 14 * scaleFactor);
  ctx.fillStyle = '#000000';
  ctx.fillText('Document Billed', legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
  
  // Meter Reading legend (line)
  legendX += legendSpacing;
  ctx.strokeStyle = meterReadingColor;
  ctx.lineWidth = 2 * scaleFactor;
  ctx.beginPath();
  ctx.moveTo(legendX, legendY + 7 * scaleFactor);
  ctx.lineTo(legendX + 14 * scaleFactor, legendY + 7 * scaleFactor);
  ctx.stroke();
  ctx.fillStyle = meterReadingColor;
  ctx.beginPath();
  ctx.arc(legendX + 7 * scaleFactor, legendY + 7 * scaleFactor, 3 * scaleFactor, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.fillText('Meter Reading', legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
  
  // Calculate scales
  const barValues = data.map(d => Math.max(d.amount || 0, d.documentAmount || 0));
  const maxBarValue = Math.max(...barValues, 1);
  
  const meterReadings = data.map(d => d.meterReading).filter(v => v !== null) as number[];
  const maxMeterReading = meterReadings.length > 0 ? Math.max(...meterReadings) : 1;
  
  const clusterWidth = chartWidth / data.length;
  const barWidth = Math.max((clusterWidth - 12 * scaleFactor) / 2, 20 * scaleFactor);
  
  // Draw gridlines
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  const numGridLines = 5;
  for (let i = 0; i <= numGridLines; i++) {
    const y = topPadding + (chartHeight * i / numGridLines);
    ctx.setLineDash([3 * scaleFactor, 3 * scaleFactor]);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + chartWidth, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  
  // Draw clustered bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;
    
    // Reconciliation bar (left)
    const reconValue = item.amount || 0;
    const reconBarHeight = maxBarValue > 0 ? (reconValue / maxBarValue) * chartHeight : 0;
    const reconY = topPadding + chartHeight - reconBarHeight;
    ctx.fillStyle = reconciliationColor;
    
    // Draw bar with rounded top corners
    const barRadius = 4 * scaleFactor;
    const reconBarX = clusterX + 4 * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(reconBarX, reconY + barRadius);
    ctx.arcTo(reconBarX, reconY, reconBarX + barRadius, reconY, barRadius);
    ctx.arcTo(reconBarX + barWidth, reconY, reconBarX + barWidth, reconY + barRadius, barRadius);
    ctx.lineTo(reconBarX + barWidth, topPadding + chartHeight);
    ctx.lineTo(reconBarX, topPadding + chartHeight);
    ctx.closePath();
    ctx.fill();
    
    // Document bar (right)
    const docValue = item.documentAmount || 0;
    const docBarHeight = maxBarValue > 0 ? (docValue / maxBarValue) * chartHeight : 0;
    const docY = topPadding + chartHeight - docBarHeight;
    ctx.fillStyle = documentColor;
    
    const docBarX = clusterX + barWidth + 8 * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(docBarX, docY + barRadius);
    ctx.arcTo(docBarX, docY, docBarX + barRadius, docY, barRadius);
    ctx.arcTo(docBarX + barWidth, docY, docBarX + barWidth, docY + barRadius, barRadius);
    ctx.lineTo(docBarX + barWidth, topPadding + chartHeight);
    ctx.lineTo(docBarX, topPadding + chartHeight);
    ctx.closePath();
    ctx.fill();
  });
  
  // Draw meter reading line
  ctx.strokeStyle = meterReadingColor;
  ctx.lineWidth = 2 * scaleFactor;
  ctx.beginPath();
  let isFirstPoint = true;
  
  data.forEach((item, index) => {
    if (item.meterReading !== null) {
      const clusterX = padding + index * clusterWidth + clusterWidth / 2;
      const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
      
      if (isFirstPoint) {
        ctx.moveTo(clusterX, y);
        isFirstPoint = false;
      } else {
        ctx.lineTo(clusterX, y);
      }
    }
  });
  ctx.stroke();
  
  // Draw meter reading dots
  ctx.fillStyle = meterReadingColor;
  data.forEach((item, index) => {
    if (item.meterReading !== null) {
      const clusterX = padding + index * clusterWidth + clusterWidth / 2;
      const y = topPadding + chartHeight - (item.meterReading / maxMeterReading) * chartHeight;
      ctx.beginPath();
      ctx.arc(clusterX, y, 4 * scaleFactor, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  
  // Draw left Y-axis (values)
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, topPadding);
  ctx.lineTo(padding, topPadding + chartHeight);
  ctx.lineTo(padding + chartWidth, topPadding + chartHeight);
  ctx.stroke();
  
  // Left Y-axis labels
  ctx.fillStyle = '#374151';
  ctx.font = `${10 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'right';
  for (let i = 0; i <= numGridLines; i++) {
    const value = maxBarValue * (1 - i / numGridLines);
    const y = topPadding + (chartHeight * i / numGridLines);
    const label = value >= 1000 ? `R${(value / 1000).toFixed(0)}k` : `R${value.toFixed(0)}`;
    ctx.fillText(label, padding - 8 * scaleFactor, y + 4 * scaleFactor);
  }
  
  // Right Y-axis labels (meter reading)
  ctx.textAlign = 'left';
  for (let i = 0; i <= numGridLines; i++) {
    const value = maxMeterReading * (1 - i / numGridLines);
    const y = topPadding + (chartHeight * i / numGridLines);
    ctx.fillText(value.toLocaleString(), padding + chartWidth + 10 * scaleFactor, y + 4 * scaleFactor);
  }
  
  // X-axis labels (rotated)
  ctx.save();
  ctx.fillStyle = '#374151';
  ctx.font = `${9 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'right';
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const y = topPadding + chartHeight + 15 * scaleFactor;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(item.period, 0, 0);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-x, -y);
  });
  ctx.restore();
  
  return canvas.toDataURL('image/png');
};

// Interface for analysis chart data (Document Amount with Winter/Summer averages)
export interface AnalysisChartDataPoint {
  period: string;
  documentAmount: number | null;
  winterAvg: number | null;
  summerAvg: number | null;
}

/**
 * Generate an analysis meter chart using Canvas API (fast, no DOM rendering)
 * Creates a bar chart with Document Amount bars plus Winter and Summer average lines.
 */
export const generateAnalysisMeterChart = (
  title: string,
  unit: string,
  data: AnalysisChartDataPoint[],
  width: number = 900,
  height: number = 500,
  scaleFactor: number = 2
): string => {
  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;
  
  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx || data.length === 0) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);
  
  // Colors matching the UI
  const documentColor = 'rgba(156, 163, 175, 0.6)';  // Gray for Document Amount
  const winterColor = '#3b82f6';  // Blue for Winter Average
  const summerColor = '#f97316';  // Orange for Summer Average
  
  // Chart dimensions
  const padding = 60 * scaleFactor;
  const rightPadding = 40 * scaleFactor;
  const bottomPadding = 100 * scaleFactor;
  const topPadding = 70 * scaleFactor;
  const chartWidth = scaledWidth - padding - rightPadding;
  const chartHeight = scaledHeight - topPadding - bottomPadding;
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${14 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(title, scaledWidth / 2, 25 * scaleFactor);
  
  // Draw unit
  if (unit && unit.trim()) {
    ctx.font = `${11 * scaleFactor}px sans-serif`;
    ctx.fillText(`(${unit})`, scaledWidth / 2, 42 * scaleFactor);
  }
  
  // Draw legend
  const legendY = 55 * scaleFactor;
  const legendSpacing = 130 * scaleFactor;
  let legendX = scaledWidth / 2 - legendSpacing * 1.1;
  
  // Document Amount legend
  ctx.fillStyle = documentColor;
  ctx.fillRect(legendX, legendY, 14 * scaleFactor, 14 * scaleFactor);
  ctx.fillStyle = '#000000';
  ctx.font = `${10 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('Document Amount', legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
  
  // Winter Average legend (line)
  legendX += legendSpacing;
  ctx.strokeStyle = winterColor;
  ctx.lineWidth = 2 * scaleFactor;
  ctx.setLineDash([6 * scaleFactor, 3 * scaleFactor]);
  ctx.beginPath();
  ctx.moveTo(legendX, legendY + 7 * scaleFactor);
  ctx.lineTo(legendX + 14 * scaleFactor, legendY + 7 * scaleFactor);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#000000';
  ctx.fillText('Winter Avg', legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
  
  // Summer Average legend (line)
  legendX += legendSpacing;
  ctx.strokeStyle = summerColor;
  ctx.lineWidth = 2 * scaleFactor;
  ctx.setLineDash([6 * scaleFactor, 3 * scaleFactor]);
  ctx.beginPath();
  ctx.moveTo(legendX, legendY + 7 * scaleFactor);
  ctx.lineTo(legendX + 14 * scaleFactor, legendY + 7 * scaleFactor);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#000000';
  ctx.fillText('Summer Avg', legendX + 18 * scaleFactor, legendY + 11 * scaleFactor);
  
  // Calculate scales
  const allValues = data.map(d => d.documentAmount || 0);
  const winterAvg = data[0]?.winterAvg || 0;
  const summerAvg = data[0]?.summerAvg || 0;
  const maxValue = Math.max(...allValues, winterAvg, summerAvg, 1);
  
  const barWidth = Math.max((chartWidth / data.length) - 8 * scaleFactor, 20 * scaleFactor);
  const barSpacing = chartWidth / data.length;
  
  // Draw gridlines
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  const numGridLines = 5;
  for (let i = 0; i <= numGridLines; i++) {
    const y = topPadding + (chartHeight * i / numGridLines);
    ctx.setLineDash([3 * scaleFactor, 3 * scaleFactor]);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + chartWidth, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  
  // Draw bars
  data.forEach((item, index) => {
    const barX = padding + index * barSpacing + (barSpacing - barWidth) / 2;
    const value = item.documentAmount || 0;
    const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
    const barY = topPadding + chartHeight - barHeight;
    
    ctx.fillStyle = documentColor;
    
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
  
  // Draw Winter Average line (dashed horizontal)
  if (winterAvg > 0) {
    const winterY = topPadding + chartHeight - (winterAvg / maxValue) * chartHeight;
    ctx.strokeStyle = winterColor;
    ctx.lineWidth = 2 * scaleFactor;
    ctx.setLineDash([6 * scaleFactor, 3 * scaleFactor]);
    ctx.beginPath();
    ctx.moveTo(padding, winterY);
    ctx.lineTo(padding + chartWidth, winterY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  // Draw Summer Average line (dashed horizontal)
  if (summerAvg > 0) {
    const summerY = topPadding + chartHeight - (summerAvg / maxValue) * chartHeight;
    ctx.strokeStyle = summerColor;
    ctx.lineWidth = 2 * scaleFactor;
    ctx.setLineDash([6 * scaleFactor, 3 * scaleFactor]);
    ctx.beginPath();
    ctx.moveTo(padding, summerY);
    ctx.lineTo(padding + chartWidth, summerY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  // Draw axes
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, topPadding);
  ctx.lineTo(padding, topPadding + chartHeight);
  ctx.lineTo(padding + chartWidth, topPadding + chartHeight);
  ctx.stroke();
  
  // Y-axis labels
  ctx.fillStyle = '#374151';
  ctx.font = `${10 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'right';
  for (let i = 0; i <= numGridLines; i++) {
    const value = maxValue * (1 - i / numGridLines);
    const y = topPadding + (chartHeight * i / numGridLines);
    let label: string;
    if (unit === 'R') {
      label = value >= 1000 ? `R${(value / 1000).toFixed(0)}k` : `R${value.toFixed(0)}`;
    } else {
      label = value.toLocaleString();
    }
    ctx.fillText(label, padding - 8 * scaleFactor, y + 4 * scaleFactor);
  }
  
  // X-axis labels (rotated)
  ctx.save();
  ctx.fillStyle = '#374151';
  ctx.font = `${9 * scaleFactor}px sans-serif`;
  ctx.textAlign = 'right';
  data.forEach((item, index) => {
    const x = padding + index * barSpacing + barSpacing / 2;
    const y = topPadding + chartHeight + 15 * scaleFactor;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(item.period, 0, 0);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-x, -y);
  });
  ctx.restore();
  
  return canvas.toDataURL('image/png');
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

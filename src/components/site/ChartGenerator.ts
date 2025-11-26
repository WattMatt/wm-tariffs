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

export const generateDocumentVsAssignedChart = (
  title: string,
  unit: string,
  data: { period: string; documentValue: number; assignedValue: number | null }[],
  width: number = 400,
  height: number = 300
): string => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx || data.length === 0) return '';
  
  // Clear canvas with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Colors matching the reference image
  const documentColor = '#3b82f6';  // Blue for Document
  const assignedColor = '#f59e0b';  // Orange for Assigned
  
  // Draw title
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 20);
  
  // Draw unit (only if provided)
  if (unit && unit.trim()) {
    ctx.font = '10px sans-serif';
    ctx.fillText(`(${unit})`, width / 2, 35);
  }
  
  // Draw legend
  const legendY = 48;
  const legendX = width / 2 - 50;
  
  ctx.fillStyle = documentColor;
  ctx.fillRect(legendX, legendY, 12, 12);
  ctx.fillStyle = '#000000';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Document', legendX + 16, legendY + 10);
  
  ctx.fillStyle = assignedColor;
  ctx.fillRect(legendX + 80, legendY, 12, 12);
  ctx.fillStyle = '#000000';
  ctx.fillText('Assigned', legendX + 96, legendY + 10);
  
  const padding = 40;
  const bottomPadding = 80;
  const topPadding = 70;
  const chartWidth = width - padding * 2;
  const chartHeight = height - topPadding - bottomPadding;
  const clusterWidth = chartWidth / data.length;
  const barWidth = Math.max((clusterWidth - 8) / 2, 15);  // Two bars with gap
  
  const maxValue = Math.max(
    ...data.map(d => d.documentValue),
    ...data.map(d => d.assignedValue || 0)
  );
  
  // Draw clustered bars
  data.forEach((item, index) => {
    const clusterX = padding + index * clusterWidth;
    
    // Document bar (left)
    const docBarHeight = maxValue > 0 ? (item.documentValue / maxValue) * chartHeight : 0;
    const docY = height - bottomPadding - docBarHeight;
    ctx.fillStyle = documentColor;
    ctx.fillRect(clusterX + 4, docY, barWidth, docBarHeight);
    
    // Assigned bar (right)
    const assignedValue = item.assignedValue || 0;
    const assignedBarHeight = maxValue > 0 ? (assignedValue / maxValue) * chartHeight : 0;
    const assignedY = height - bottomPadding - assignedBarHeight;
    ctx.fillStyle = assignedColor;
    ctx.fillRect(clusterX + barWidth + 8, assignedY, barWidth, assignedBarHeight);
    
    // Draw values on top of bars (centered on each bar)
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    
    if (item.documentValue > 0) {
      ctx.fillText(item.documentValue.toFixed(2), clusterX + 4 + barWidth / 2, docY - 3);
    }
    if (assignedValue > 0) {
      ctx.fillText(assignedValue.toFixed(2), clusterX + barWidth + 8 + barWidth / 2, assignedY - 3);
    }
  });
  
  // Draw X-axis labels (period labels - split into two lines if needed)
  ctx.fillStyle = '#000000';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  data.forEach((item, index) => {
    const x = padding + index * clusterWidth + clusterWidth / 2;
    const periodParts = item.period.split(' - ');
    ctx.fillText(periodParts[0], x, height - bottomPadding + 15);
    if (periodParts[1]) {
      ctx.fillText(periodParts[1], x, height - bottomPadding + 27);
    }
  });
  
  // Draw Y-axis
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, topPadding);
  ctx.lineTo(padding, height - bottomPadding);
  ctx.lineTo(width - padding, height - bottomPadding);
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

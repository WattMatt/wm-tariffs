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

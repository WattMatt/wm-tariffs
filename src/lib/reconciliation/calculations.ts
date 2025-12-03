import type { ColumnSettings } from './types';

/**
 * Apply column settings (selection, operations, factors) to hierarchical CSV data
 */
export function applyColumnSettingsToHierarchicalData(
  csvColumnTotals: Record<string, number>,
  csvColumnMaxValues: Record<string, number>,
  rowCount: number,
  settings: ColumnSettings
): {
  processedColumnTotals: Record<string, number>;
  processedColumnMaxValues: Record<string, number>;
  totalKwhPositive: number;
  totalKwhNegative: number;
  totalKwh: number;
} {
  const processedColumnTotals: Record<string, number> = {};
  const processedColumnMaxValues: Record<string, number> = {};
  let totalKwhPositive = 0;
  let totalKwhNegative = 0;
  let totalKwh = 0;

  Object.entries(csvColumnTotals).forEach(([column, rawSum]) => {
    // 1. Only include selected columns
    if (!settings.selectedColumns.has(column)) return;
    
    // 2. Get the operation and factor for this column
    const operation = settings.columnOperations.get(column) || 'sum';
    const factor = Number(settings.columnFactors.get(column) || 1);
    
    // 3. Apply the operation
    let result = rawSum;
    let isMaxOperation = false;
    
    switch (operation) {
      case 'sum':
        result = rawSum;
        break;
      case 'average':
        result = rowCount > 0 ? rawSum / rowCount : 0;
        break;
      case 'max':
        // Use the actual max value from csvColumnMaxValues
        if (csvColumnMaxValues[column] === undefined) {
          return; // Skip this column if no max value available
        }
        result = csvColumnMaxValues[column];
        isMaxOperation = true;
        break;
      case 'min':
        // Min would need per-timestamp tracking - fall back to sum
        result = rawSum;
        break;
    }
    
    // 4. Apply column factor
    result = result * factor;
    
    // 5. Store the processed value in the correct location
    if (isMaxOperation) {
      processedColumnMaxValues[column] = result;
    } else {
      processedColumnTotals[column] = result;
    }
    
    // 6. Track positive/negative for totalKwh calculations (exclude kVA columns and max columns)
    const isKvaColumn = column.toLowerCase().includes('kva');
    if (!isKvaColumn && !isMaxOperation) {
      if (result > 0) {
        totalKwhPositive += result;
      } else if (result < 0) {
        totalKwhNegative += result;
      }
      totalKwh += result;
    }
  });

  // Process columnMaxValues - filter by selected columns and apply factor
  Object.entries(csvColumnMaxValues).forEach(([column, rawValue]) => {
    // Only include selected columns
    if (!settings.selectedColumns.has(column)) return;
    
    // Apply column factor
    const factor = Number(settings.columnFactors.get(column) || 1);
    processedColumnMaxValues[column] = rawValue * factor;
  });

  return { processedColumnTotals, processedColumnMaxValues, totalKwhPositive, totalKwhNegative, totalKwh };
}

/**
 * Helper to combine date and time into a naive timestamp string
 */
export function getFullDateTime(date: Date, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hrs = String(hours).padStart(2, '0');
  const mins = String(minutes).padStart(2, '0');
  return `${year}-${month}-${day} ${hrs}:${mins}:00`;
}

/**
 * Calculate totals for reconciliation summary
 */
export function calculateReconciliationTotals(
  gridSupplyMeters: Array<{ totalKwhPositive?: number; totalKwh?: number; totalKwhNegative?: number }>,
  solarEnergyMeters: Array<{ totalKwh?: number }>,
  tenantMeters: Array<{ totalKwh?: number }>
): {
  bulkTotal: number;
  solarMeterTotal: number;
  gridNegative: number;
  otherTotal: number;
  tenantTotal: number;
  totalSupply: number;
  recoveryRate: number;
  discrepancy: number;
} {
  // Grid Supply: use totalKwhPositive if columns selected, otherwise fall back to totalKwh
  const bulkTotal = gridSupplyMeters.reduce((sum, m) => {
    const meterValue = (m.totalKwhPositive || 0) > 0 ? m.totalKwhPositive! : Math.max(0, m.totalKwh || 0);
    return sum + meterValue;
  }, 0);
  
  // Solar Energy: sum all solar meters + sum of all grid negative values
  const solarMeterTotal = solarEnergyMeters.reduce((sum, m) => sum + (m.totalKwh || 0), 0);
  const gridNegative = gridSupplyMeters.reduce((sum, m) => sum + (m.totalKwhNegative || 0), 0);
  const otherTotal = solarMeterTotal + gridNegative;
  const tenantTotal = tenantMeters.reduce((sum, m) => sum + (m.totalKwh || 0), 0);
  
  // Total Supply: Grid Supply + only positive Solar contribution
  const totalSupply = bulkTotal + Math.max(0, otherTotal);
  const recoveryRate = totalSupply > 0 ? (tenantTotal / totalSupply) * 100 : 0;
  const discrepancy = totalSupply - tenantTotal;

  return {
    bulkTotal,
    solarMeterTotal,
    gridNegative,
    otherTotal,
    tenantTotal,
    totalSupply,
    recoveryRate,
    discrepancy
  };
}

/**
 * Get meter type priority for sorting
 */
export function getMeterTypePriority(meterType: string): number {
  switch (meterType) {
    case 'council_meter': return 0;
    case 'bulk_meter': return 1;
    case 'check_meter': return 2;
    case 'tenant_meter': return 3;
    case 'other': return 4;
    default: return 5;
  }
}

/**
 * Calculate indent level by meter type (fallback when no connections)
 */
export function getIndentByMeterType(meterType: string): number {
  switch (meterType) {
    case 'council_meter': return 0;
    case 'bulk_meter': return 0;
    case 'check_meter': return 1;
    case 'tenant_meter': return 2;
    case 'other': return 3;
    default: return 3;
  }
}

/**
 * Aggregate column totals from child meters
 */
export function aggregateColumnTotals(
  childTotals: Array<Record<string, number>>
): Record<string, number> {
  const aggregated: Record<string, number> = {};
  
  childTotals.forEach(totals => {
    Object.entries(totals).forEach(([key, value]) => {
      aggregated[key] = (aggregated[key] || 0) + value;
    });
  });
  
  return aggregated;
}

/**
 * Aggregate column max values from child meters (take max of maxes)
 */
export function aggregateColumnMaxValues(
  childMaxValues: Array<Record<string, number>>
): Record<string, number> {
  const aggregated: Record<string, number> = {};
  
  childMaxValues.forEach(maxValues => {
    Object.entries(maxValues).forEach(([key, value]) => {
      aggregated[key] = Math.max(aggregated[key] || 0, value);
    });
  });
  
  return aggregated;
}

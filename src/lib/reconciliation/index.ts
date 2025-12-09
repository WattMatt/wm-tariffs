// Types
export * from './types';

// Data Fetching
export {
  fetchDateRanges,
  fetchBasicMeters,
  fetchDocumentDateRanges,
  fetchHierarchicalDataFromReadings,
  fetchMeterCsvFilesInfo,
  checkHierarchicalCsvCoverage,
  getMetersWithUploadedCsvs,
  fetchSchematicConnections,
} from './dataFetching';

// Calculations
export {
  applyColumnSettingsToHierarchicalData,
  getFullDateTime,
  calculateReconciliationTotals,
  getMeterTypePriority,
  getIndentByMeterType,
  aggregateColumnTotals,
  aggregateColumnMaxValues,
} from './calculations';

// Hierarchy Utilities
export {
  getHierarchyDepth,
  sortParentMetersByDepth,
  deriveConnectionsFromIndents,
  isMeterVisible,
  buildConnectionsMap,
  buildParentInfoMap,
  calculateIndentLevel,
  getAllDescendants,
  getLeafMeterIds,
  getParentMeterIds,
} from './hierarchyUtils';

// CSV Generation
export {
  generateHierarchicalCsvForMeter,
  downloadCsvFromStorage,
  getCsvStorageUrl,
} from './csvGeneration';

// Chart Generation
export {
  CHART_METRICS,
  saveChartToStorage,
  generateReconciliationChartPath,
} from './chartGeneration';

export type { ChartMetricKey } from './chartGeneration';

// Re-export from generic chart infrastructure
export { dataURLtoBlob } from '@/lib/charts';

// Re-export hook types for convenience
export type { MeterConnection, HierarchicalCsvResult, DateRange, DocumentDateRange } from './types';

import type { CorrectedReading } from '@/lib/dataValidation';

export interface MeterData {
  id: string;
  meter_number: string;
  meter_type: string;
  name?: string | null;
  location?: string | null;
  tariff_structure_id?: string | null;
  assigned_tariff_name?: string | null;
  hasData?: boolean;
  totalKwh?: number;
  totalKwhPositive?: number;
  totalKwhNegative?: number;
  columnTotals?: Record<string, number>;
  columnMaxValues?: Record<string, number>;
  readingsCount?: number;
  hasError?: boolean;
  errorMessage?: string;
  // Hierarchical values
  directTotalKwh?: number;
  directColumnTotals?: Record<string, number>;
  directColumnMaxValues?: Record<string, number>;
  directReadingsCount?: number;
  hierarchicalTotalKwh?: number;
  hierarchicalColumnTotals?: Record<string, number>;
  hierarchicalColumnMaxValues?: Record<string, number>;
  hierarchicalReadingsCount?: number;
}

export interface RevenueData {
  meterRevenues: Map<string, any>;
  gridSupplyCost: number;
  solarCost: number;
  tenantCost: number;
  totalRevenue: number;
  avgCostPerKwh: number;
}

export interface ReconciliationResult {
  councilBulk: MeterData[];
  bulkMeters: MeterData[];
  solarMeters: MeterData[];
  checkMeters: MeterData[];
  tenantMeters: MeterData[];
  distributionMeters: MeterData[];
  distribution: MeterData[];
  otherMeters: MeterData[];
  unassignedMeters: MeterData[];
  bulkTotal: number;
  councilTotal: number;
  solarTotal: number;
  otherTotal: number;
  tenantTotal: number;
  distributionTotal: number;
  totalSupply: number;
  recoveryRate: number;
  discrepancy: number;
  revenueData: RevenueData | null;
}

export interface HierarchicalCsvResult {
  totalKwh: number;
  columnTotals: Record<string, number>;
  columnMaxValues: Record<string, number>;
  rowCount: number;
  corrections?: CorrectedReading[];
  requiresParsing?: boolean;
  csvFileId?: string;
  columnMapping?: Record<string, any>;
}

export interface DateRange {
  earliest: Date | null;
  latest: Date | null;
  readingsCount?: number;
}

export interface DocumentDateRange {
  id: string;
  document_type: string;
  file_name: string;
  period_start: string;
  period_end: string;
}

export interface MeterConnection {
  parent_meter_id: string;
  child_meter_id: string;
}

export interface ProcessMeterResult {
  results: MeterData[];
  errors: Map<string, string>;
  corrections: CorrectedReading[];
}

export interface ColumnSettings {
  selectedColumns: Set<string>;
  columnOperations: Map<string, string>;
  columnFactors: Map<string, string>;
}

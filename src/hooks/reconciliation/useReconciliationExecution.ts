import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { calculateMeterCost, calculateMeterCostAcrossPeriods } from '@/lib/costCalculation';
import { isValueCorrupt, type CorrectedReading } from '@/lib/dataValidation';
import { getFullDateTime } from '@/lib/reconciliation';

export interface MeterResult {
  id: string;
  meter_number: string;
  meter_type: string;
  name?: string;
  location?: string;
  tariff_structure_id?: string;
  assigned_tariff_name?: string;
  totalKwh: number;
  totalKwhPositive: number;
  totalKwhNegative: number;
  columnTotals: Record<string, number>;
  columnMaxValues: Record<string, number>;
  readingsCount: number;
  hasData: boolean;
  hasError: boolean;
  errorMessage?: string;
  directTotalKwh?: number;
  directColumnTotals?: Record<string, number>;
  directColumnMaxValues?: Record<string, number>;
  directReadingsCount?: number;
  hierarchicalTotalKwh?: number;
  hierarchicalColumnTotals?: Record<string, number>;
  hierarchicalColumnMaxValues?: Record<string, number>;
  hierarchicalReadingsCount?: number;
  assignment?: string;
}

export interface ReconciliationResult {
  bulkMeters: MeterResult[];
  solarMeters: MeterResult[];
  tenantMeters: MeterResult[];
  checkMeters: MeterResult[];
  unassignedMeters: MeterResult[];
  otherMeters: MeterResult[];
  councilBulk: MeterResult[];
  distribution: MeterResult[];
  distributionMeters: MeterResult[];
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

export interface RevenueData {
  gridSupplyCost: number;
  solarCost: number;
  tenantCost: number;
  totalRevenue: number;
  avgCostPerKwh: number;
  meterRevenues: Map<string, MeterRevenueInfo>;
}

export interface MeterRevenueInfo {
  tariffName: string;
  energyCost: number;
  fixedCharges: number;
  demandCharges: number;
  totalCost: number;
  avgCostPerKwh: number;
  hasError?: boolean;
  errorMessage?: string;
}

export interface UseReconciliationExecutionOptions {
  siteId: string;
  selectedColumnsRef: React.RefObject<Set<string>>;
  columnOperationsRef: React.RefObject<Map<string, string>>;
  columnFactorsRef: React.RefObject<Map<string, string>>;
  meterAssignments: Map<string, string>;
  meterConnectionsMap: Map<string, string[]>;
  cancelRef: React.RefObject<boolean>;
  onEnergyProgress?: (progress: { current: number; total: number }) => void;
  onRevenueProgress?: (progress: { current: number; total: number }) => void;
}

export function useReconciliationExecution(options: UseReconciliationExecutionOptions) {
  const {
    siteId,
    selectedColumnsRef,
    columnOperationsRef,
    columnFactorsRef,
    meterAssignments,
    meterConnectionsMap,
    cancelRef,
    onEnergyProgress,
    onRevenueProgress,
  } = options;

  // ========== HELPER FUNCTIONS ==========

  /**
   * Apply column settings (selection, operations, factors) to hierarchical CSV data
   */
  const applyColumnSettingsToHierarchicalData = useCallback((
    csvColumnTotals: Record<string, number>,
    csvColumnMaxValues: Record<string, number>,
    rowCount: number
  ): {
    processedColumnTotals: Record<string, number>;
    processedColumnMaxValues: Record<string, number>;
    totalKwhPositive: number;
    totalKwhNegative: number;
    totalKwh: number;
  } => {
    const processedColumnTotals: Record<string, number> = {};
    const processedColumnMaxValues: Record<string, number> = {};
    let totalKwhPositive = 0;
    let totalKwhNegative = 0;
    let totalKwh = 0;

    const selectedCols = selectedColumnsRef.current;
    const colOps = columnOperationsRef.current;
    const colFactors = columnFactorsRef.current;

    Object.entries(csvColumnTotals).forEach(([column, rawSum]) => {
      if (!selectedCols.has(column)) return;

      const operation = colOps.get(column) || 'sum';
      const factor = Number(colFactors.get(column) || 1);

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
          if (csvColumnMaxValues[column] === undefined) return;
          result = csvColumnMaxValues[column];
          isMaxOperation = true;
          break;
        case 'min':
          result = rawSum;
          break;
      }

      result = result * factor;

      if (isMaxOperation) {
        processedColumnMaxValues[column] = result;
      } else {
        processedColumnTotals[column] = result;
      }

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

    // Process max values
    Object.entries(csvColumnMaxValues).forEach(([column, rawValue]) => {
      if (!selectedCols.has(column)) return;
      const factor = Number(colFactors.get(column) || 1);
      processedColumnMaxValues[column] = rawValue * factor;
    });

    return { processedColumnTotals, processedColumnMaxValues, totalKwhPositive, totalKwhNegative, totalKwh };
  }, [selectedColumnsRef, columnOperationsRef, columnFactorsRef]);

  /**
   * Update meter category with both direct and hierarchical values
   */
  const updateMeterCategoryWithHierarchy = useCallback((
    meters: MeterResult[],
    csvResults: Map<string, { totalKwh: number; columnTotals: Record<string, number>; columnMaxValues: Record<string, number>; rowCount: number }>,
    metersWithUploadedCsvs: Set<string>
  ): MeterResult[] => {
    return meters.map(meter => {
      const csvData = csvResults.get(meter.id);
      const hasHierarchicalCsv = csvData !== undefined;
      const hasUploadedCsv = metersWithUploadedCsvs.has(meter.id);

      const directTotalKwh = meter.totalKwh;
      const directColumnTotals = { ...meter.columnTotals };
      const directColumnMaxValues = { ...meter.columnMaxValues };
      const directReadingsCount = meter.readingsCount;

      if (hasHierarchicalCsv && csvData) {
        const { processedColumnTotals, processedColumnMaxValues, totalKwhPositive, totalKwhNegative, totalKwh } =
          applyColumnSettingsToHierarchicalData(csvData.columnTotals, csvData.columnMaxValues || {}, csvData.rowCount);

        if (hasUploadedCsv) {
          return {
            ...meter,
            totalKwh: directTotalKwh,
            columnTotals: directColumnTotals,
            columnMaxValues: directColumnMaxValues,
            directTotalKwh,
            directColumnTotals,
            directColumnMaxValues,
            directReadingsCount,
            hierarchicalTotalKwh: totalKwh,
            hierarchicalColumnTotals: processedColumnTotals,
            hierarchicalColumnMaxValues: processedColumnMaxValues,
            hierarchicalReadingsCount: csvData.rowCount,
          };
        }

        return {
          ...meter,
          totalKwh: totalKwh,
          columnTotals: processedColumnTotals,
          columnMaxValues: processedColumnMaxValues,
          totalKwhPositive,
          totalKwhNegative,
          directTotalKwh,
          directColumnTotals,
          directColumnMaxValues,
          directReadingsCount,
          hierarchicalTotalKwh: totalKwh,
          hierarchicalColumnTotals: processedColumnTotals,
          hierarchicalColumnMaxValues: processedColumnMaxValues,
          hierarchicalReadingsCount: csvData.rowCount,
        };
      }

      return {
        ...meter,
        directTotalKwh,
        directColumnTotals,
        directColumnMaxValues,
        directReadingsCount,
      };
    });
  }, [applyColumnSettingsToHierarchicalData]);

  /**
   * Calculate leaf meter sum recursively (only counts leaf meters, not parent totals)
   */
  const getLeafMeterSum = useCallback((
    meterId: string,
    meterMap: Map<string, MeterResult>,
    connectionsMap: Map<string, string[]>,
    visited = new Set<string>()
  ): number => {
    if (visited.has(meterId)) return 0;
    visited.add(meterId);

    const children = connectionsMap.get(meterId) || [];

    if (children.length === 0) {
      const meterData = meterMap.get(meterId);
      if (!meterData) return 0;

      const isSolar = meterAssignments.get(meterId) === 'solar_energy' || meterData.assignment === 'solar';
      const value = meterData.totalKwh || 0;
      return isSolar ? -value : value;
    }

    return children.reduce((sum, childId) => {
      return sum + getLeafMeterSum(childId, meterMap, connectionsMap, new Set(visited));
    }, 0);
  }, [meterAssignments]);

  /**
   * Aggregate column totals from leaf meters
   */
  const getLeafColumnTotals = useCallback((
    meterId: string,
    meterMap: Map<string, MeterResult>,
    connectionsMap: Map<string, string[]>,
    visited = new Set<string>()
  ): Record<string, number> => {
    if (visited.has(meterId)) return {};
    visited.add(meterId);

    const children = connectionsMap.get(meterId) || [];

    if (children.length === 0) {
      const meterData = meterMap.get(meterId);
      return meterData?.columnTotals || {};
    }

    const aggregated: Record<string, number> = {};
    children.forEach(childId => {
      const childTotals = getLeafColumnTotals(childId, meterMap, connectionsMap, new Set(visited));
      Object.entries(childTotals).forEach(([key, value]) => {
        aggregated[key] = (aggregated[key] || 0) + value;
      });
    });
    return aggregated;
  }, []);

  /**
   * Get max of columnMaxValues from leaf meters
   */
  const getLeafColumnMaxValues = useCallback((
    meterId: string,
    meterMap: Map<string, MeterResult>,
    connectionsMap: Map<string, string[]>,
    visited = new Set<string>()
  ): Record<string, number> => {
    if (visited.has(meterId)) return {};
    visited.add(meterId);

    const children = connectionsMap.get(meterId) || [];

    if (children.length === 0) {
      const meterData = meterMap.get(meterId);
      return meterData?.columnMaxValues || {};
    }

    const aggregated: Record<string, number> = {};
    children.forEach(childId => {
      const childMaxValues = getLeafColumnMaxValues(childId, meterMap, connectionsMap, new Set(visited));
      Object.entries(childMaxValues).forEach(([key, value]) => {
        aggregated[key] = Math.max(aggregated[key] || 0, value);
      });
    });
    return aggregated;
  }, []);

  /**
   * Calculate hierarchical totals for all meters with children
   */
  const calculateHierarchicalTotals = useCallback((
    allMeters: MeterResult[],
    connectionsMap: Map<string, string[]>
  ): {
    hierarchicalTotals: Map<string, number>;
    hierarchicalColumnTotals: Map<string, Record<string, number>>;
    hierarchicalColumnMaxValues: Map<string, Record<string, number>>;
  } => {
    const meterMap = new Map(allMeters.map(m => [m.id, m]));
    const hierarchicalTotals = new Map<string, number>();
    const hierarchicalColumnTotals = new Map<string, Record<string, number>>();
    const hierarchicalColumnMaxValues = new Map<string, Record<string, number>>();

    allMeters.forEach(meter => {
      const childIds = connectionsMap.get(meter.id) || [];
      if (childIds.length > 0) {
        const total = childIds.reduce((sum, childId) => {
          return sum + getLeafMeterSum(childId, meterMap, connectionsMap);
        }, 0);
        hierarchicalTotals.set(meter.id, total);
        hierarchicalColumnTotals.set(meter.id, getLeafColumnTotals(meter.id, meterMap, connectionsMap));
        hierarchicalColumnMaxValues.set(meter.id, getLeafColumnMaxValues(meter.id, meterMap, connectionsMap));
      }
    });

    return { hierarchicalTotals, hierarchicalColumnTotals, hierarchicalColumnMaxValues };
  }, [getLeafMeterSum, getLeafColumnTotals, getLeafColumnMaxValues]);

  // ========== MAIN EXECUTION FUNCTIONS ==========

  /**
   * Save a reconciliation run to the database
   */
  const saveReconciliationRun = useCallback(async (
    runName: string,
    notes: string | null,
    dateFrom: string,
    dateTo: string,
    reconciliationData: ReconciliationResult,
    availableMeters: Array<{ id: string }>,
    hierarchicalCsvResults?: Map<string, { totalKwh: number; columnTotals: Record<string, number>; columnMaxValues: Record<string, number>; rowCount: number }>
  ): Promise<string> => {
    const { data: { user } } = await supabase.auth.getUser();
    const meterOrder = availableMeters.map(m => m.id);

    // Insert reconciliation run
    const { data: run, error: runError } = await supabase
      .from('reconciliation_runs')
      .insert({
        site_id: siteId,
        run_name: runName,
        date_from: dateFrom,
        date_to: dateTo,
        bulk_total: reconciliationData.bulkTotal,
        solar_total: reconciliationData.solarTotal,
        tenant_total: reconciliationData.tenantTotal || 0,
        total_supply: reconciliationData.totalSupply,
        recovery_rate: reconciliationData.recoveryRate,
        discrepancy: reconciliationData.discrepancy,
        created_by: user?.id,
        notes: notes,
        revenue_enabled: reconciliationData.revenueData !== null,
        grid_supply_cost: reconciliationData.revenueData?.gridSupplyCost || 0,
        solar_cost: reconciliationData.revenueData?.solarCost || 0,
        tenant_cost: reconciliationData.revenueData?.tenantCost || 0,
        total_revenue: reconciliationData.revenueData?.totalRevenue || 0,
        avg_cost_per_kwh: reconciliationData.revenueData?.avgCostPerKwh || 0,
        meter_order: meterOrder
      })
      .select()
      .single();

    if (runError) throw runError;

    // Prepare meter data map
    const meterDataMap = new Map<string, MeterResult>();
    [
      ...(reconciliationData.bulkMeters || []).map(m => ({ ...m, assignment: 'grid_supply' })),
      ...(reconciliationData.solarMeters || []).map(m => ({ ...m, assignment: 'solar' })),
      ...(reconciliationData.tenantMeters || []).map(m => ({ ...m, assignment: 'tenant' })),
      ...(reconciliationData.checkMeters || []).map(m => ({ ...m, assignment: 'check' })),
      ...(reconciliationData.unassignedMeters || []).map(m => ({ ...m, assignment: 'unassigned' }))
    ].forEach(m => meterDataMap.set(m.id, m));

    const allMeters = availableMeters
      .filter(m => meterDataMap.has(m.id))
      .map(m => meterDataMap.get(m.id)!);

    // Calculate hierarchical totals
    const { hierarchicalTotals, hierarchicalColumnTotals, hierarchicalColumnMaxValues } =
      calculateHierarchicalTotals(allMeters, meterConnectionsMap);

    // Prepare meter results for insertion
    const meterResults = allMeters.map(meter => {
      const revenueInfo = reconciliationData.revenueData?.meterRevenues.get(meter.id);
      return {
        reconciliation_run_id: run.id,
        meter_id: meter.id,
        meter_number: meter.meter_number,
        meter_type: meter.meter_type,
        meter_name: meter.name || null,
        location: meter.location || null,
        assignment: meter.assignment,
        tariff_structure_id: meter.tariff_structure_id,
        total_kwh: meter.totalKwh || 0,
        total_kwh_positive: meter.totalKwhPositive || 0,
        total_kwh_negative: meter.totalKwhNegative || 0,
        hierarchical_total: meter.hierarchicalTotalKwh ?? hierarchicalTotals.get(meter.id) ?? 0,
        readings_count: meter.readingsCount || 0,
        column_totals: meter.columnTotals || hierarchicalColumnTotals.get(meter.id) || null,
        column_max_values: meter.columnMaxValues || hierarchicalColumnMaxValues.get(meter.id) || null,
        has_error: meter.hasError || false,
        error_message: meter.errorMessage || null,
        tariff_name: revenueInfo?.tariffName || null,
        energy_cost: revenueInfo?.energyCost || 0,
        fixed_charges: revenueInfo?.fixedCharges || 0,
        demand_charges: revenueInfo?.demandCharges || 0,
        total_cost: revenueInfo?.totalCost || 0,
        avg_cost_per_kwh: revenueInfo?.avgCostPerKwh || 0,
        cost_calculation_error: revenueInfo?.hasError ? revenueInfo.errorMessage : null
      };
    });

    const { error: resultsError } = await supabase
      .from('reconciliation_meter_results')
      .insert(meterResults);

    if (resultsError) throw resultsError;

    // Update parent meters with CSV values if available
    if (hierarchicalCsvResults && hierarchicalCsvResults.size > 0) {
      for (const [meterId, csvData] of hierarchicalCsvResults) {
        await supabase
          .from('reconciliation_meter_results')
          .update({
            column_totals: csvData.columnTotals,
            hierarchical_total: csvData.totalKwh
          })
          .eq('reconciliation_run_id', run.id)
          .eq('meter_id', meterId);
      }
    }

    return run.id;
  }, [siteId, meterConnectionsMap, calculateHierarchicalTotals]);

  /**
   * Check which meters have uploaded (not generated) CSV files
   */
  const getMetersWithUploadedCsvs = useCallback(async (meterIds: string[]): Promise<Set<string>> => {
    if (meterIds.length === 0) return new Set();

    const { data, error } = await supabase
      .from('meter_csv_files')
      .select('meter_id, file_name')
      .in('meter_id', meterIds)
      .eq('parse_status', 'parsed');

    if (error || !data) return new Set();

    const uploadedMeterIds = data
      .filter(d => !d.file_name.toLowerCase().includes('hierarchical'))
      .map(d => d.meter_id);

    return new Set(uploadedMeterIds);
  }, []);

  return {
    // Helper functions
    applyColumnSettingsToHierarchicalData,
    updateMeterCategoryWithHierarchy,
    calculateHierarchicalTotals,
    getLeafMeterSum,
    getLeafColumnTotals,
    getLeafColumnMaxValues,
    getMetersWithUploadedCsvs,
    
    // Main functions
    saveReconciliationRun,
  };
}

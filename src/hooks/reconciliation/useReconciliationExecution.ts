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
  directRevenue?: {
    energyCost: number;
    fixedCharges: number;
    demandCharges: number;
    totalCost: number;
    avgCostPerKwh: number;
  };
  hierarchicalRevenue?: {
    energyCost: number;
    fixedCharges: number;
    demandCharges: number;
    totalCost: number;
    avgCostPerKwh: number;
  };
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
   * Save a reconciliation run to the database with full parent meter revenue calculation
   */
  const saveReconciliationRun = useCallback(async (
    runName: string,
    notes: string | null,
    dateFrom: string,
    dateTo: string,
    reconciliationData: ReconciliationResult,
    availableMeters: Array<{ id: string; [key: string]: any }>,
    hierarchicalCsvResults?: Map<string, { totalKwh: number; columnTotals: Record<string, number>; columnMaxValues: Record<string, number>; rowCount: number }>
  ): Promise<string> => {
    const { data: { user } } = await supabase.auth.getUser();
    const meterOrder = availableMeters.map(m => m.id);

    // Calculate common area values from "other" type meters
    const allCategoryMeters = [
      ...(reconciliationData.bulkMeters || []),
      ...(reconciliationData.solarMeters || []),
      ...(reconciliationData.tenantMeters || []),
      ...(reconciliationData.checkMeters || []),
      ...(reconciliationData.unassignedMeters || []),
      ...(reconciliationData.otherMeters || [])
    ];
    
    const otherMeters = allCategoryMeters.filter(m => m.meter_type === 'other');
    const commonAreaKwh = otherMeters.reduce((sum, m) => sum + (m.totalKwh || 0), 0);
    
    // Calculate common area cost from revenue attached to meter objects
    const commonAreaCost = otherMeters.reduce((sum, meter) => {
      const totalCost = meter.hierarchicalRevenue?.totalCost || meter.directRevenue?.totalCost || 0;
      return sum + totalCost;
    }, 0);

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
        meter_order: meterOrder,
        common_area_kwh: commonAreaKwh,
        common_area_cost: commonAreaCost
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

    // Calculate revenue for ALL meters - both direct and hierarchical costs
    const directMeterRevenues = new Map<string, any>();
    const hierarchicalMeterRevenues = new Map<string, any>();
    
    if (reconciliationData.revenueData) {
      const { data: siteData } = await supabase
        .from("sites")
        .select("supply_authority_id")
        .eq("id", siteId)
        .single();
      
      if (siteData?.supply_authority_id) {
        // Copy existing revenue data as hierarchical baseline
        const existingRevenues = new Map(reconciliationData.revenueData.meterRevenues);
        
        // Calculate BOTH direct and hierarchical revenue for all meters
        const meterRevenuePromises = allMeters.map(async (meter) => {
          const directTotal = meter.directTotalKwh ?? meter.totalKwh ?? 0;
          const hierarchicalTotal = meter.hierarchicalTotalKwh ?? hierarchicalTotals.get(meter.id) ?? 0;
          
          // Get max kVA from direct readings
          const directColMaxValues = meter.directColumnMaxValues || meter.columnMaxValues || {};
          const directMaxKva = Object.entries(directColMaxValues)
            .filter(([key]) => key.toLowerCase().includes('kva') || key.toLowerCase() === 's (kva)')
            .reduce((max, [, value]) => Math.max(max, Number(value) || 0), 0);
          
          // Get max kVA from hierarchical readings
          const hierColMaxValues = meter.hierarchicalColumnMaxValues || hierarchicalColumnMaxValues.get(meter.id) || {};
          const hierarchicalMaxKva = Object.entries(hierColMaxValues)
            .filter(([key]) => key.toLowerCase().includes('kva') || key.toLowerCase() === 's (kva)')
            .reduce((max, [, value]) => Math.max(max, Number(value) || 0), 0);
          
          let directCostResult = null;
          let hierarchicalCostResult = existingRevenues.get(meter.id) || null;
          
          const tariffName = meter.assigned_tariff_name;
          const tariffId = meter.tariff_structure_id;
          
          try {
            // Calculate DIRECT cost if there's direct data and a tariff
            if (directTotal > 0 && (tariffName || tariffId)) {
              if (tariffName) {
                directCostResult = await calculateMeterCostAcrossPeriods(
                  meter.id, siteData.supply_authority_id, tariffName,
                  new Date(dateFrom), new Date(dateTo),
                  directTotal, directMaxKva
                );
              } else if (tariffId) {
                directCostResult = await calculateMeterCost(
                  meter.id, tariffId,
                  new Date(dateFrom), new Date(dateTo),
                  directTotal, directMaxKva
                );
              }
            }
            
            // Calculate HIERARCHICAL cost if there's hierarchical data and no existing revenue
            if (hierarchicalTotal > 0 && (tariffName || tariffId) && !hierarchicalCostResult) {
              if (tariffName) {
                hierarchicalCostResult = await calculateMeterCostAcrossPeriods(
                  meter.id, siteData.supply_authority_id, tariffName,
                  new Date(dateFrom), new Date(dateTo),
                  hierarchicalTotal, hierarchicalMaxKva
                );
              } else if (tariffId) {
                hierarchicalCostResult = await calculateMeterCost(
                  meter.id, tariffId,
                  new Date(dateFrom), new Date(dateTo),
                  hierarchicalTotal, hierarchicalMaxKva
                );
              }
            }
          } catch (error) {
            console.error(`Failed to calculate revenue for meter ${meter.meter_number}:`, error);
            const errorResult = {
              hasError: true,
              errorMessage: error instanceof Error ? error.message : 'Cost calculation failed',
              totalCost: 0, energyCost: 0, fixedCharges: 0, demandCharges: 0, avgCostPerKwh: 0,
              tariffName: tariffName || null
            };
            if (!directCostResult) directCostResult = errorResult;
            if (!hierarchicalCostResult) hierarchicalCostResult = errorResult;
          }
          
          return { meter, directCostResult, hierarchicalCostResult };
        });

        const results = await Promise.allSettled(meterRevenuePromises);
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            const { meter, directCostResult, hierarchicalCostResult } = result.value;
            if (directCostResult) directMeterRevenues.set(meter.id, directCostResult);
            if (hierarchicalCostResult) hierarchicalMeterRevenues.set(meter.id, hierarchicalCostResult);
          }
        });
      }
    }

    // Helper to filter column data by selected columns only
    const selectedCols = selectedColumnsRef.current;
    const filterBySelectedColumns = (columns: Record<string, number> | null | undefined): Record<string, number> | null => {
      if (!columns) return null;
      const filtered: Record<string, number> = {};
      for (const [key, value] of Object.entries(columns)) {
        if (selectedCols.has(key)) {
          filtered[key] = value;
        }
      }
      return Object.keys(filtered).length > 0 ? filtered : null;
    };

    // Prepare meter results for insertion with direct vs hierarchical separation
    const meterResults = allMeters.map(meter => {
      // Get hierarchical values from meter or calculated maps
      const hierTotal = meter.hierarchicalTotalKwh ?? hierarchicalTotals.get(meter.id) ?? 0;
      const hierColTotals = meter.hierarchicalColumnTotals || hierarchicalColumnTotals.get(meter.id) || null;
      const hierColMaxValues = meter.hierarchicalColumnMaxValues || hierarchicalColumnMaxValues.get(meter.id) || null;
      
      // Get direct values from meter
      const directTotal = meter.directTotalKwh ?? meter.totalKwh ?? 0;
      const directColTotals = meter.directColumnTotals || meter.columnTotals || null;
      const directColMaxValues = meter.directColumnMaxValues || meter.columnMaxValues || null;
      const directReadingsCount = meter.directReadingsCount ?? meter.readingsCount ?? 0;
      
      // Get both direct and hierarchical revenue
      const directRevenue = directMeterRevenues.get(meter.id);
      const hierRevenue = hierarchicalMeterRevenues.get(meter.id);
      
      return {
        reconciliation_run_id: run.id,
        meter_id: meter.id,
        meter_number: meter.meter_number,
        meter_type: meter.meter_type,
        meter_name: meter.name || null,
        location: meter.location || null,
        assignment: meter.assignment,
        tariff_structure_id: meter.tariff_structure_id,
        // Legacy fields (for backward compatibility) - use hierarchical if available, otherwise direct
        total_kwh: hierTotal || directTotal || 0,
        total_kwh_positive: meter.totalKwhPositive || 0,
        total_kwh_negative: meter.totalKwhNegative || 0,
        readings_count: meter.readingsCount || 0,
        column_totals: filterBySelectedColumns(hierColTotals) || filterBySelectedColumns(directColTotals),
        column_max_values: filterBySelectedColumns(hierColMaxValues) || filterBySelectedColumns(directColMaxValues),
        // New direct columns - filtered by selected columns
        direct_total_kwh: directTotal,
        direct_readings_count: directReadingsCount,
        direct_column_totals: filterBySelectedColumns(directColTotals),
        direct_column_max_values: filterBySelectedColumns(directColMaxValues),
        // New hierarchical columns - filtered by selected columns
        hierarchical_total: hierTotal,
        hierarchical_column_totals: filterBySelectedColumns(hierColTotals),
        hierarchical_column_max_values: filterBySelectedColumns(hierColMaxValues),
        hierarchical_readings_count: meter.hierarchicalReadingsCount ?? 0,
        // Error tracking
        has_error: meter.hasError || false,
        error_message: meter.errorMessage || null,
        // Revenue - primary values (prefer hierarchical for legacy compatibility)
        tariff_name: hierRevenue?.tariffName || directRevenue?.tariffName || null,
        energy_cost: hierRevenue?.energyCost || directRevenue?.energyCost || 0,
        fixed_charges: hierRevenue?.fixedCharges || directRevenue?.fixedCharges || 0,
        demand_charges: hierRevenue?.demandCharges || directRevenue?.demandCharges || 0,
        total_cost: hierRevenue?.totalCost || directRevenue?.totalCost || 0,
        avg_cost_per_kwh: hierRevenue?.avgCostPerKwh || directRevenue?.avgCostPerKwh || 0,
        cost_calculation_error: (hierRevenue?.hasError ? hierRevenue.errorMessage : null) || 
                               (directRevenue?.hasError ? directRevenue.errorMessage : null),
        // Direct revenue fields - calculated from direct kWh
        direct_total_cost: directRevenue?.totalCost || 0,
        direct_energy_cost: directRevenue?.energyCost || 0,
        direct_fixed_charges: directRevenue?.fixedCharges || 0,
        direct_demand_charges: directRevenue?.demandCharges || 0,
        direct_avg_cost_per_kwh: directRevenue?.avgCostPerKwh || 0,
        // Hierarchical revenue fields - calculated from hierarchical kWh
        hierarchical_total_cost: hierRevenue?.totalCost || 0,
        hierarchical_energy_cost: hierRevenue?.energyCost || 0,
        hierarchical_fixed_charges: hierRevenue?.fixedCharges || 0,
        hierarchical_demand_charges: hierRevenue?.demandCharges || 0,
        hierarchical_avg_cost_per_kwh: hierRevenue?.avgCostPerKwh || 0,
      };
    });

    const { error: resultsError } = await supabase
      .from('reconciliation_meter_results')
      .insert(meterResults);

    if (resultsError) throw resultsError;

    // Update parent meters with CSV values if available - filtered by selected columns
    if (hierarchicalCsvResults && hierarchicalCsvResults.size > 0) {
      for (const [meterId, csvData] of hierarchicalCsvResults) {
        await supabase
          .from('reconciliation_meter_results')
          .update({
            column_totals: filterBySelectedColumns(csvData.columnTotals),
            hierarchical_total: csvData.totalKwh,
            hierarchical_column_totals: filterBySelectedColumns(csvData.columnTotals),
            hierarchical_column_max_values: filterBySelectedColumns(csvData.columnMaxValues),
          })
          .eq('reconciliation_run_id', run.id)
          .eq('meter_id', meterId);
      }
    }

    // Note: Chart generation now uses html2canvas capture and must be triggered from the UI
    // after reconciliation save completes. The old Canvas-based generation produced corrupted output.

    return run.id;
  }, [siteId, meterConnectionsMap, calculateHierarchicalTotals, selectedColumnsRef]);

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

import { useCallback, RefObject, MutableRefObject } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { calculateMeterCost, calculateMeterCostAcrossPeriods } from '@/lib/costCalculation';
import { isValueCorrupt, type CorrectedReading } from '@/lib/dataValidation';
import { sortParentMetersByDepth, getFullDateTime } from '@/lib/reconciliation';
import type { ReconciliationResult, RevenueData, MeterResult } from './useReconciliationExecution';

export interface PreviewData {
  meterNumber: string;
  meterType: string;
  totalReadings: number;
  firstReading: any;
  lastReading: any;
  sampleReadings: any[];
  availableColumns: string[];
  totalKwh: number;
  columnTotals: Record<string, number>;
  columnValues: Record<string, number[]>;
}

export interface UseReconciliationRunnerOptions {
  siteId: string;
  selectedColumnsRef: RefObject<Set<string>>;
  columnOperationsRef: RefObject<Map<string, string>>;
  columnFactorsRef: RefObject<Map<string, string>>;
  meterAssignments: Map<string, string>;
  cancelRef: MutableRefObject<boolean>;
  previewDataRef: RefObject<{ availableColumns: string[] } | null>;
  onEnergyProgress?: (progress: { current: number; total: number }) => void;
  onRevenueProgress?: (progress: { current: number; total: number }) => void;
  setIsCalculatingRevenue?: (value: boolean) => void;
  // Hierarchy generation callbacks
  onCsvGenerationProgress?: (progress: { current: number; total: number }) => void;
  onMeterCorrections?: (corrections: Map<string, CorrectedReading[]>) => void;
  onMeterConnectionsMapUpdate?: (connectionsMap: Map<string, string[]>) => void;
  onHierarchyCsvData?: (data: Map<string, { totalKwh: number; columnTotals: Record<string, number>; columnMaxValues: Record<string, number>; rowCount: number }>) => void;
  onHierarchyGenerated?: (generated: boolean) => void;
  // Preview callbacks
  onPreviewData?: (data: PreviewData) => void;
  onSelectedColumns?: (columns: Set<string>) => void;
  onColumnOperations?: (operations: Map<string, string>) => void;
  onColumnFactors?: (factors: Map<string, string>) => void;
}

export interface RunReconciliationOptions {
  dateFrom: Date;
  dateTo: Date;
  timeFrom: string;
  timeTo: string;
  enableRevenue: boolean;
  availableMeters: any[];
  meterConnectionsMap: Map<string, string[]>;
  hierarchyGenerated: boolean;
  meterCorrections: Map<string, CorrectedReading[]>;
  // Callbacks
  getMetersWithUploadedCsvs: (meterIds: string[]) => Promise<Set<string>>;
  updateMeterCategoryWithHierarchy: (meters: MeterResult[], csvResults: Map<string, any>, metersWithUploadedCsvs: Set<string>) => MeterResult[];
  saveReconciliationSettings: () => Promise<void>;
  setIsLoading: (loading: boolean) => void;
  setFailedMeters: (meters: Map<string, string>) => void;
  setHierarchicalCsvResults: (results: Map<string, any>) => void;
  setReconciliationData: (data: any) => void;
  setAvailableMeters: (fn: (prev: any[]) => any[]) => void;
  setIsColumnsOpen: (open: boolean) => void;
  setIsMetersOpen: (open: boolean) => void;
  setIsCancelling: (cancelling: boolean) => void;
  setIsGeneratingCsvs: (generating: boolean) => void;
}

export interface BulkReconcileOptions {
  selectedDocumentIds: string[];
  documentDateRanges: Array<{ id: string; file_name: string; period_start: string; period_end: string }>;
  meterConnectionsMap: Map<string, string[]>;
  availableMeters: any[];
  enableRevenue: boolean;
  meterCorrections: Map<string, CorrectedReading[]>;
  // Meter config for edge function
  selectedColumns: string[];
  columnOperations: Record<string, string>;
  columnFactors: Record<string, string>;
  meterAssignments: Record<string, string>;
  meterOrder: string[];
  // Callbacks
  setIsBulkProcessing: (processing: boolean) => void;
  setBulkProgress: (progress: { currentDocument: string; current: number; total: number }) => void;
  setCurrentJobId: (jobId: string | null) => void;
}

export interface ProcessedMeterData {
  meterData: MeterResult[];
  errors: Map<string, string>;
  reconciliationData: ReconciliationResult;
  leafCorrectionsByMeter: Map<string, CorrectedReading[]>;
}

export interface HierarchicalCsvGenerationResult {
  totalKwh: number;
  columnTotals: Record<string, number>;
  columnMaxValues: Record<string, number>;
  rowCount: number;
  corrections: CorrectedReading[];
  requiresParsing?: boolean;
  csvFileId?: string;
  columnMapping?: Record<string, any>;
}

export function useReconciliationRunner(options: UseReconciliationRunnerOptions) {
  const {
    siteId,
    selectedColumnsRef,
    columnOperationsRef,
    columnFactorsRef,
    meterAssignments,
    cancelRef,
    previewDataRef,
    onEnergyProgress,
    onRevenueProgress,
    setIsCalculatingRevenue,
    onCsvGenerationProgress,
    onMeterCorrections,
    onMeterConnectionsMapUpdate,
    onHierarchyCsvData,
    onHierarchyGenerated,
    onPreviewData,
    onSelectedColumns,
    onColumnOperations,
    onColumnFactors,
  } = options;

  /**
   * Process a single meter with retry logic
   * Detects corrupt values and tracks corrections
   */
  const processSingleMeter = useCallback(async (
    meter: any,
    fullDateTimeFrom: string,
    fullDateTimeTo: string,
    errors: Map<string, string>,
    retryCount = 0,
    retryingMeters?: Set<string>,
    correctionsCollector?: CorrectedReading[]
  ): Promise<MeterResult> => {
    if (cancelRef.current) {
      throw new Error('Reconciliation cancelled by user');
    }

    const maxRetries = 3;
    const clientTimeout = 10000;

    try {
      let allReadings: any[] = [];
      let start = 0;
      const pageSize = 1000;
      let hasMore = true;
      let fetchError: any = null;

      const fetchAllPages = async () => {
        while (hasMore) {
          if (cancelRef.current) {
            throw new Error('Reconciliation cancelled by user');
          }

          const { data: pageReadings, error: pageError } = await supabase
            .from("meter_readings")
            .select("kwh_value, reading_timestamp, metadata")
            .eq("meter_id", meter.id)
            .gte("reading_timestamp", fullDateTimeFrom)
            .lte("reading_timestamp", fullDateTimeTo)
            .or('metadata->>source.eq.Parsed,metadata->>source.is.null')
            .not('metadata->>source_file', 'ilike', '%Hierarchical%')
            .order("reading_timestamp", { ascending: true })
            .range(start, start + pageSize - 1);

          if (pageError) {
            fetchError = pageError;
            break;
          }

          if (pageReadings && pageReadings.length > 0) {
            allReadings = allReadings.concat(pageReadings);
            start += pageSize;
            hasMore = pageReadings.length === pageSize;

            if (pageReadings.length === pageSize) {
              console.log(`Fetching page ${Math.floor(start / pageSize)} for meter ${meter.meter_number} (direct only)...`);
            }
          } else {
            hasMore = false;
          }
        }
        return { allReadings, fetchError };
      };

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Client timeout')), clientTimeout)
      );

      let result: { allReadings: any[]; fetchError: any };
      try {
        result = await Promise.race([fetchAllPages(), timeoutPromise]) as { allReadings: any[]; fetchError: any };
      } catch (timeoutError: any) {
        if (retryCount < maxRetries) {
          const delay = 2000 * Math.pow(2, retryCount);
          console.warn(`Client timeout for meter ${meter.meter_number}, retry ${retryCount + 1}/${maxRetries} in ${delay / 1000}s...`);

          if (retryingMeters) {
            retryingMeters.add(meter.meter_number);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          return await processSingleMeter(meter, fullDateTimeFrom, fullDateTimeTo, errors, retryCount + 1, retryingMeters, correctionsCollector);
        } else {
          console.error(`All retries exhausted for ${meter.meter_number}:`, timeoutError);
          errors.set(meter.id, "Query timeout after multiple retries");
          return {
            ...meter,
            totalKwh: 0,
            totalKwhPositive: 0,
            totalKwhNegative: 0,
            columnTotals: {},
            columnMaxValues: {},
            readingsCount: 0,
            hasData: false,
            hasError: true,
            errorMessage: "Query timeout after multiple retries"
          };
        }
      }

      const readings = result.allReadings;

      if (result.fetchError) {
        if (retryCount < maxRetries) {
          const delay = 2000 * Math.pow(2, retryCount);
          console.warn(`Error fetching ${meter.meter_number}, retry ${retryCount + 1}/${maxRetries} in ${delay / 1000}s:`, result.fetchError);

          if (retryingMeters) {
            retryingMeters.add(meter.meter_number);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          return await processSingleMeter(meter, fullDateTimeFrom, fullDateTimeTo, errors, retryCount + 1, retryingMeters, correctionsCollector);
        } else {
          console.error(`All retries exhausted for ${meter.meter_number}:`, result.fetchError);
          errors.set(meter.id, result.fetchError.message);
          return {
            ...meter,
            totalKwh: 0,
            totalKwhPositive: 0,
            totalKwhNegative: 0,
            columnTotals: {},
            columnMaxValues: {},
            readingsCount: 0,
            hasData: false,
            hasError: true,
            errorMessage: result.fetchError.message
          };
        }
      }

      // Deduplicate by timestamp
      const uniqueReadings = readings ? readings.filter((reading, index, self) =>
        index === self.findIndex(r => r.reading_timestamp === reading.reading_timestamp)
      ) : [];

      let totalKwh = 0;
      let totalKwhPositive = 0;
      let totalKwhNegative = 0;
      const columnTotals: Record<string, number> = {};
      const columnMaxValues: Record<string, number> = {};
      const columnSums: Record<string, number> = {};
      const columnCounts: Record<string, number> = {};
      const columnMaxRaw: Record<string, number> = {};

      if (uniqueReadings && uniqueReadings.length > 0) {
        const selectedCols = selectedColumnsRef.current;
        const colOps = columnOperationsRef.current;
        const colFactors = columnFactorsRef.current;

        // First pass: collect raw values and detect/correct corrupt values
        uniqueReadings.forEach((reading) => {
          const importedFields = (reading.metadata as any)?.imported_fields || {};

          Object.entries(importedFields).forEach(([key, value]) => {
            if (!selectedCols.has(key)) return;

            const numValue = typeof value === 'number' ? value : parseFloat(String(value));
            if (isNaN(numValue)) return;

            // Corruption detection - check against previous and next values
            const readingIndex = uniqueReadings.indexOf(reading);
            const prevReading = readingIndex > 0 ? uniqueReadings[readingIndex - 1] : null;
            const nextReading = readingIndex < uniqueReadings.length - 1 ? uniqueReadings[readingIndex + 1] : null;

            const prevValue = prevReading ? (prevReading.metadata as any)?.imported_fields?.[key] : null;
            const nextValue = nextReading ? (nextReading.metadata as any)?.imported_fields?.[key] : null;

            let valueToUse = numValue;

            // Check if value is corrupt using the validation function
            const validationResult = isValueCorrupt(numValue, key);
            if (validationResult.isCorrupt) {
              // Calculate interpolated value
              if (typeof prevValue === 'number' && typeof nextValue === 'number') {
                valueToUse = (prevValue + nextValue) / 2;
              } else if (typeof prevValue === 'number') {
                valueToUse = prevValue;
              } else if (typeof nextValue === 'number') {
                valueToUse = nextValue;
              }

              // Track correction
              if (correctionsCollector) {
                correctionsCollector.push({
                  meterId: meter.id,
                  meterNumber: meter.meter_number,
                  timestamp: reading.reading_timestamp,
                  fieldName: key,
                  originalValue: numValue,
                  correctedValue: valueToUse,
                  reason: validationResult.reason || 'Value exceeds threshold'
                });
              }
            }

            // Track sums and counts for each column
            columnSums[key] = (columnSums[key] || 0) + valueToUse;
            columnCounts[key] = (columnCounts[key] || 0) + 1;
            columnMaxRaw[key] = Math.max(columnMaxRaw[key] || -Infinity, valueToUse);
          });
        });

        // Second pass: apply operations and factors
        Object.entries(columnSums).forEach(([key, rawSum]) => {
          const operation = colOps.get(key) || 'sum';
          const factor = Number(colFactors.get(key) || 1);
          const count = columnCounts[key] || 1;

          let result = rawSum;

          switch (operation) {
            case 'sum':
              result = rawSum;
              break;
            case 'average':
              result = rawSum / count;
              break;
            case 'max':
              result = columnMaxRaw[key] || 0;
              break;
            case 'min':
              result = rawSum;
              break;
          }

          result = result * factor;

          if (key.toLowerCase().includes('kva') || key.toLowerCase().includes('s (kva)')) {
            columnMaxValues[key] = result;
          } else {
            columnTotals[key] = result;
          }
        });

        // Calculate totals
        Object.values(columnTotals).forEach((colTotal) => {
          if (colTotal > 0) {
            totalKwhPositive += colTotal;
          } else if (colTotal < 0) {
            totalKwhNegative += colTotal;
          }
        });

        totalKwh = totalKwhPositive + totalKwhNegative;

        console.log(`Reconciliation: Meter ${meter.meter_number} (${meter.meter_type}):`, {
          originalReadings: readings?.length || 0,
          uniqueReadings: uniqueReadings.length,
          duplicatesRemoved: (readings?.length || 0) - uniqueReadings.length,
          totalKwh: totalKwh.toFixed(2),
          columnTotals,
          columnMaxValues,
          firstTimestamp: uniqueReadings[0].reading_timestamp,
          lastTimestamp: uniqueReadings[uniqueReadings.length - 1].reading_timestamp
        });

        if (readings && readings.length >= 100000) {
          console.warn(`WARNING: Meter ${meter.meter_number} may have more than 100k readings - increase limit!`);
        }
      } else {
        console.log(`Meter ${meter.meter_number}: No readings in date range`);
      }

      return {
        ...meter,
        totalKwh,
        totalKwhPositive,
        totalKwhNegative,
        columnTotals,
        columnMaxValues,
        readingsCount: uniqueReadings.length,
        hasData: uniqueReadings.length > 0,
        hasError: false
      };
    } catch (error: any) {
      console.error(`Unexpected error processing meter ${meter.meter_number}:`, error);
      errors.set(meter.id, error.message || "Unexpected error");
      return {
        ...meter,
        totalKwh: 0,
        totalKwhPositive: 0,
        totalKwhNegative: 0,
        columnTotals: {},
        columnMaxValues: {},
        readingsCount: 0,
        hasData: false,
        hasError: true,
        errorMessage: error.message
      };
    }
  }, [cancelRef, selectedColumnsRef, columnOperationsRef, columnFactorsRef]);

  /**
   * Process meters in batches
   * Collects corruption corrections detected during processing
   */
  const processMeterBatches = useCallback(async (
    meters: any[],
    batchSize: number,
    fullDateTimeFrom: string,
    fullDateTimeTo: string
  ): Promise<{ results: MeterResult[]; errors: Map<string, string>; corrections: CorrectedReading[] }> => {
    const results: MeterResult[] = [];
    const errors = new Map<string, string>();
    const retryingMeters = new Set<string>();
    const allCorrections: CorrectedReading[] = [];

    for (let i = 0; i < meters.length; i += batchSize) {
      if (cancelRef.current) {
        throw new Error('Reconciliation cancelled by user');
      }

      const batch = meters.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(meters.length / batchSize);

      const retryingList = Array.from(retryingMeters).join(', ');
      const statusMessage = retryingList
        ? `Processing batch ${batchNumber} of ${totalBatches} (retrying: ${retryingList})`
        : `Processing batch ${batchNumber} of ${totalBatches}`;
      console.log(statusMessage);

      const batchResults = await Promise.all(
        batch.map(async (meter) => {
          const result = await processSingleMeter(meter, fullDateTimeFrom, fullDateTimeTo, errors, 0, retryingMeters, allCorrections);
          retryingMeters.delete(meter.meter_number);
          return result;
        })
      );

      results.push(...batchResults);

      onEnergyProgress?.({
        current: Math.min(i + batchSize, meters.length),
        total: meters.length
      });
    }

    return { results, errors, corrections: allCorrections };
  }, [cancelRef, processSingleMeter, onEnergyProgress]);

  /**
   * Perform reconciliation calculation
   * Shared by both single and bulk reconciliation
   */
  const performReconciliationCalculation = useCallback(async (
    startDateTime: string,
    endDateTime: string,
    enableRevenue?: boolean
  ): Promise<ProcessedMeterData> => {
    // Fetch site details
    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, name, supply_authority_id")
      .eq("id", siteId)
      .single();

    if (siteError || !siteData?.supply_authority_id) {
      throw new Error("Site supply authority not configured");
    }

    // Fetch all meters
    const { data: meters, error: metersError } = await supabase
      .from("meters")
      .select("id, meter_number, meter_type, tariff_structure_id, assigned_tariff_name, name, location")
      .eq("site_id", siteId);

    if (metersError) {
      console.error("Error fetching meters:", metersError);
      throw new Error("Failed to fetch meters");
    }

    if (!meters || meters.length === 0) {
      throw new Error("No meters found for this site");
    }

    // Process meters in batches
    const { results: meterData, errors, corrections: leafMeterCorrections } = await processMeterBatches(
      meters,
      2,
      startDateTime,
      endDateTime
    );

    // Group corrections by meter
    const leafCorrectionsByMeter = new Map<string, CorrectedReading[]>();
    for (const correction of leafMeterCorrections) {
      const meterId = correction.originalSourceMeterId || correction.meterId;
      if (!leafCorrectionsByMeter.has(meterId)) {
        leafCorrectionsByMeter.set(meterId, []);
      }
      leafCorrectionsByMeter.get(meterId)!.push(correction);
    }

    if (leafMeterCorrections.length > 0) {
      console.log(`Corruption detection complete: ${leafMeterCorrections.length} values corrected across ${leafCorrectionsByMeter.size} meters`);
    }

    const safeMeters = Array.isArray(meterData) ? meterData : [];

    // Filter meters based on assignments
    let gridSupplyMeters = safeMeters.filter((m) => meterAssignments.get(m.id) === "grid_supply");
    let solarEnergyMeters = safeMeters.filter((m) => meterAssignments.get(m.id) === "solar_energy");

    if (gridSupplyMeters.length === 0 && solarEnergyMeters.length === 0) {
      gridSupplyMeters = safeMeters.filter((m) => m.meter_type === "bulk_meter");
      solarEnergyMeters = [];
    }

    const checkMeters = safeMeters.filter((m) => m.meter_type === "check_meter");
    const tenantMeters = safeMeters.filter((m) => m.meter_type === "tenant_meter");

    const assignedMeterIds = new Set([
      ...gridSupplyMeters.map(m => m.id),
      ...solarEnergyMeters.map(m => m.id),
      ...tenantMeters.map(m => m.id),
      ...checkMeters.map(m => m.id)
    ]);
    const unassignedMeters = safeMeters.filter(m => !assignedMeterIds.has(m.id));

    // Calculate totals
    const bulkTotal = gridSupplyMeters.reduce((sum, m) => {
      const meterValue = m.totalKwhPositive > 0 ? m.totalKwhPositive : Math.max(0, m.totalKwh);
      return sum + meterValue;
    }, 0);

    const solarMeterTotal = solarEnergyMeters.reduce((sum, m) => sum + m.totalKwh, 0);
    const gridNegative = gridSupplyMeters.reduce((sum, m) => sum + (m.totalKwhNegative || 0), 0);
    const otherTotal = solarMeterTotal + gridNegative;
    const tenantTotal = tenantMeters.reduce((sum, m) => sum + m.totalKwh, 0);

    const totalSupply = bulkTotal + Math.max(0, otherTotal);
    const recoveryRate = totalSupply > 0 ? (tenantTotal / totalSupply) * 100 : 0;
    const discrepancy = totalSupply - tenantTotal;

    // Revenue calculation
    let revenueData: RevenueData | null = null;
    if (enableRevenue) {
      setIsCalculatingRevenue?.(true);
      toast.info("Calculating revenue for meters with tariffs...");

      const metersWithTariffs = meterData.filter(m => (m.tariff_structure_id || m.assigned_tariff_name) && m.totalKwhPositive > 0);
      onRevenueProgress?.({ current: 0, total: metersWithTariffs.length });

      const meterRevenues = new Map();
      let gridSupplyCost = 0;
      let solarCost = 0;
      let tenantCost = 0;
      let totalKwhWithTariffs = 0;
      let totalCostCalculated = 0;

      for (const meter of meterData) {
        const meterMaxKva = Object.entries(meter.columnMaxValues || {})
          .filter(([key]) => key.toLowerCase().includes('kva') || key.toLowerCase() === 's (kva)')
          .reduce((max, [, value]) => Math.max(max, Number(value) || 0), 0);

        if (meter.assigned_tariff_name && meter.totalKwhPositive > 0) {
          const costResult = await calculateMeterCostAcrossPeriods(
            meter.id,
            siteData.supply_authority_id,
            meter.assigned_tariff_name,
            new Date(startDateTime),
            new Date(endDateTime),
            meter.totalKwhPositive,
            meterMaxKva
          );

          meterRevenues.set(meter.id, costResult);
          onRevenueProgress?.({ current: meterRevenues.size, total: metersWithTariffs.length });

          const assignment = meterAssignments.get(meter.id);
          if (assignment === "grid_supply") {
            gridSupplyCost += costResult.totalCost;
          } else if (assignment === "solar_energy") {
            solarCost += costResult.totalCost;
          } else if (meter.meter_type === "tenant_meter") {
            tenantCost += costResult.totalCost;
          }

          totalKwhWithTariffs += meter.totalKwh;
          totalCostCalculated += costResult.totalCost;
        } else if (meter.tariff_structure_id && meter.totalKwhPositive > 0) {
          const costResult = await calculateMeterCost(
            meter.id,
            meter.tariff_structure_id,
            new Date(startDateTime),
            new Date(endDateTime),
            meter.totalKwhPositive,
            meterMaxKva
          );

          meterRevenues.set(meter.id, costResult);
          onRevenueProgress?.({ current: meterRevenues.size, total: metersWithTariffs.length });

          const assignment = meterAssignments.get(meter.id);
          if (assignment === "grid_supply") {
            gridSupplyCost += costResult.totalCost;
          } else if (assignment === "solar_energy") {
            solarCost += costResult.totalCost;
          } else if (meter.meter_type === "tenant_meter") {
            tenantCost += costResult.totalCost;
          }

          totalKwhWithTariffs += meter.totalKwh;
          totalCostCalculated += costResult.totalCost;
        }
      }

      const avgCostPerKwh = totalKwhWithTariffs > 0 ? totalCostCalculated / totalKwhWithTariffs : 0;
      const totalRevenue = gridSupplyCost + solarCost + tenantCost;

      revenueData = {
        meterRevenues,
        gridSupplyCost,
        solarCost,
        tenantCost,
        totalRevenue,
        avgCostPerKwh
      };
    }

    return {
      meterData: safeMeters,
      errors,
      reconciliationData: {
        bulkMeters: gridSupplyMeters,
        checkMeters,
        otherMeters: [...solarEnergyMeters, ...unassignedMeters],
        tenantMeters,
        councilBulk: gridSupplyMeters,
        solarMeters: solarEnergyMeters,
        distribution: tenantMeters,
        distributionMeters: tenantMeters,
        unassignedMeters,
        bulkTotal,
        councilTotal: bulkTotal,
        otherTotal,
        solarTotal: otherTotal,
        tenantTotal,
        distributionTotal: tenantTotal,
        totalSupply,
        recoveryRate,
        discrepancy,
        revenueData,
      },
      leafCorrectionsByMeter
    };
  }, [siteId, meterAssignments, processMeterBatches, onRevenueProgress, setIsCalculatingRevenue]);

  /**
   * Generate hierarchical CSV for a parent meter
   */
  const generateHierarchicalCsvForMeter = useCallback(async (
    parentMeter: { id: string; meter_number: string },
    fullDateTimeFrom: string,
    fullDateTimeTo: string,
    childMeterIds: string[]
  ): Promise<HierarchicalCsvGenerationResult | null> => {
    if (childMeterIds.length === 0) return null;

    try {
      const allColumns = previewDataRef.current?.availableColumns || [];
      const dataColumns = allColumns.filter((col: string) => {
        const colLower = col.toLowerCase();
        return colLower !== 'time' && colLower !== 'timestamp' && colLower !== 'date' && colLower !== 'datetime';
      });

      const { data, error } = await supabase.functions.invoke('generate-hierarchical-csv', {
        body: {
          parentMeterId: parentMeter.id,
          parentMeterNumber: parentMeter.meter_number,
          siteId,
          dateFrom: fullDateTimeFrom,
          dateTo: fullDateTimeTo,
          childMeterIds,
          columns: dataColumns,
          meterAssociations: Object.fromEntries(meterAssignments)
        }
      });

      if (error) {
        console.error(`Failed to generate CSV for ${parentMeter.meter_number}:`, error);
        return null;
      }

      if (data) {
        const corrections = data.corrections || [];
        console.log(`✓ Generated hierarchical CSV for ${parentMeter.meter_number}`, {
          totalKwh: data.totalKwh,
          columns: data.columns,
          rowCount: data.rowCount,
          correctionsCount: corrections.length
        });
        return {
          totalKwh: data.totalKwh,
          columnTotals: data.columnTotals || {},
          columnMaxValues: data.columnMaxValues || {},
          rowCount: data.rowCount || 0,
          corrections,
          requiresParsing: data.requiresParsing,
          csvFileId: data.csvFileId,
          columnMapping: data.columnMapping
        };
      }
      return null;
    } catch (error) {
      console.error(`Error generating CSV for ${parentMeter.meter_number}:`, error);
      return null;
    }
  }, [siteId, meterAssignments, previewDataRef]);

  /**
   * Run hierarchy generation - copy leaf meters and generate parent CSVs
   */
  const runHierarchyGeneration = useCallback(async (
    dateFrom: Date,
    dateTo: Date,
    timeFrom: string,
    timeTo: string,
    availableMeters: Array<{ id: string; meter_number: string }>
  ): Promise<boolean> => {
    if (!previewDataRef.current) {
      toast.error("Please preview data first");
      return false;
    }

    if (selectedColumnsRef.current.size === 0) {
      toast.error("Please select at least one column to calculate");
      return false;
    }

    onCsvGenerationProgress?.({ current: 0, total: 0 });
    onMeterCorrections?.(new Map());

    try {
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // ===== STEP 0: Fetch fresh meter connections from database =====
      console.log('Fetching fresh meter connections from database...');
      const { data: freshConnections, error: connError } = await supabase
        .from('meter_connections')
        .select(`
          id,
          parent_meter_id,
          child_meter_id,
          parent:meters!meter_connections_parent_meter_id_fkey(id, site_id),
          child:meters!meter_connections_child_meter_id_fkey(id, site_id)
        `);

      if (connError) {
        console.error('Error fetching meter connections:', connError);
        throw new Error('Failed to fetch meter connections');
      }

      // Filter to only connections where BOTH meters are in the current site
      const siteConnections = freshConnections?.filter(conn => 
        conn.parent?.site_id === siteId && conn.child?.site_id === siteId
      ) || [];

      // Build fresh connections map
      const freshConnectionsMap = new Map<string, string[]>();
      siteConnections.forEach(conn => {
        if (!freshConnectionsMap.has(conn.parent_meter_id)) {
          freshConnectionsMap.set(conn.parent_meter_id, []);
        }
        freshConnectionsMap.get(conn.parent_meter_id)!.push(conn.child_meter_id);
      });

      // Update state with fresh connections
      onMeterConnectionsMapUpdate?.(freshConnectionsMap);

      console.log(`Fresh meter connections loaded: ${freshConnectionsMap.size} parent meters`);
      
      // ===== STEP 0.5: Clear ALL hierarchical_meter_readings for this site =====
      console.log('Clearing ALL hierarchical_meter_readings for site...');
      const siteMetersIds = availableMeters.map(m => m.id);
      
      const { error: clearError } = await supabase
        .from('hierarchical_meter_readings')
        .delete()
        .in('meter_id', siteMetersIds)
        .gte('reading_timestamp', fullDateTimeFrom)
        .lte('reading_timestamp', fullDateTimeTo);
      
      if (clearError) {
        console.warn('Failed to clear hierarchical_meter_readings:', clearError);
      } else {
        console.log('Cleared hierarchical_meter_readings for date range');
      }

      // ===== STEP 1: Copy ALL leaf meters upfront =====
      console.log('STEP 1: Copying ALL leaf meters to hierarchical_meter_readings...');
      const copyBody = {
        siteId,
        dateFrom: fullDateTimeFrom,
        dateTo: fullDateTimeTo,
        copyLeafMetersOnly: true
      };
      toast.info('Copying leaf meter data...');
      
      const { data: copyResult, error: copyError } = await supabase.functions.invoke('generate-hierarchical-csv', {
        body: copyBody
      });
      
      if (copyError) {
        throw new Error(`Failed to copy leaf meters: ${copyError.message}`);
      }
      
      if (!copyResult?.success) {
        throw new Error(copyResult?.error || 'Failed to copy leaf meters');
      }
      
      console.log(`✅ Copied ${copyResult.leafMetersCopied} leaf meters (${copyResult.totalReadingsCopied} readings)`);
      toast.success(`Copied ${copyResult.totalReadingsCopied} leaf meter readings`);

      // ===== STEP 2: Generate hierarchical CSVs for parent meters =====
      const parentMetersForCsv = availableMeters.filter(meter => {
        const children = freshConnectionsMap.get(meter.id);
        return children && children.length > 0;
      });

      console.log(`Detected ${parentMetersForCsv.length} parent meters for CSV generation`);

      const csvResults = new Map<string, { totalKwh: number; columnTotals: Record<string, number>; columnMaxValues: Record<string, number>; rowCount: number }>();
      const allCorrections = new Map<string, CorrectedReading[]>();

      if (parentMetersForCsv.length > 0) {
        const sortedParentMeters = sortParentMetersByDepth(parentMetersForCsv, freshConnectionsMap);
        console.log(`Generating ${sortedParentMeters.length} hierarchical CSV file(s)...`);
        console.log('Processing order:', sortedParentMeters.map(m => m.meter_number));
        toast.info(`Generating ${sortedParentMeters.length} hierarchical profile(s)...`);
        
        onCsvGenerationProgress?.({ current: 0, total: sortedParentMeters.length });

        // Delete old generated CSVs to ensure fresh data
        const { error: deleteError } = await supabase
          .from('meter_csv_files')
          .delete()
          .eq('site_id', siteId)
          .ilike('file_name', '%Hierarchical%');
        
        if (deleteError) {
          console.warn('Failed to delete old generated CSVs:', deleteError);
        }
        
        // Generate CSVs sequentially in bottom-up order
        for (let i = 0; i < sortedParentMeters.length; i++) {
          if (cancelRef.current) {
            throw new Error('Hierarchy generation cancelled by user');
          }
          
          const parentMeter = sortedParentMeters[i];
          const childMeterIds = freshConnectionsMap.get(parentMeter.id) || [];
          
          const result = await generateHierarchicalCsvForMeter(
            parentMeter,
            fullDateTimeFrom,
            fullDateTimeTo,
            childMeterIds
          );
          
          if (result) {
            csvResults.set(parentMeter.id, {
              totalKwh: result.totalKwh,
              columnTotals: result.columnTotals,
              columnMaxValues: result.columnMaxValues,
              rowCount: result.rowCount
            });
            
            if (result.corrections && result.corrections.length > 0) {
              allCorrections.set(parentMeter.id, result.corrections);
              console.log(`📝 ${result.corrections.length} corrections for ${parentMeter.meter_number}`);
            }

            // Parse the generated CSV into hierarchical_meter_readings table
            if (result.requiresParsing && result.csvFileId) {
              console.log(`Parsing generated CSV for ${parentMeter.meter_number} into hierarchical_meter_readings...`);
              
              try {
                const { error: parseError, data: parseData } = await supabase.functions.invoke('process-meter-csv', {
                  body: {
                    csvFileId: result.csvFileId,
                    meterId: parentMeter.id,
                    separator: ',',
                    headerRowNumber: 2,
                    columnMapping: result.columnMapping,
                    targetTable: 'hierarchical_meter_readings'
                  }
                });
                
                if (parseError) {
                  console.error(`Failed to parse generated CSV for ${parentMeter.meter_number}:`, parseError);
                  toast.error(`Failed to parse CSV for ${parentMeter.meter_number}`);
                } else {
                  console.log(`✅ Parsed generated CSV for ${parentMeter.meter_number}: ${parseData?.readingsInserted || 0} readings`);
                }
              } catch (parseErr) {
                console.error(`Exception parsing CSV for ${parentMeter.meter_number}:`, parseErr);
              }
            }
          }
          
          onCsvGenerationProgress?.({ current: i + 1, total: sortedParentMeters.length });
        }
        
        console.log('Hierarchy generation complete');
        
        // Propagate corrections to parents using fresh connections
        const getAllDescendantCorrections = (meterId: string): CorrectedReading[] => {
          const childIds = freshConnectionsMap.get(meterId) || [];
          let descendantCorrections: CorrectedReading[] = [];
          
          for (const childId of childIds) {
            const childCorrections = allCorrections.get(childId) || [];
            const grandchildCorrections = getAllDescendantCorrections(childId);
            descendantCorrections.push(...childCorrections, ...grandchildCorrections);
          }
          
          return descendantCorrections;
        };
        
        // Update allCorrections for each parent meter
        for (const parentMeter of sortedParentMeters) {
          const existingCorrections = allCorrections.get(parentMeter.id) || [];
          const descendantCorrections = getAllDescendantCorrections(parentMeter.id);
          
          // Deduplicate
          const uniqueCorrections = [...existingCorrections];
          for (const correction of descendantCorrections) {
            const isDuplicate = uniqueCorrections.some(c =>
              c.timestamp === correction.timestamp &&
              c.originalSourceMeterId === correction.originalSourceMeterId &&
              c.fieldName === correction.fieldName
            );
            if (!isDuplicate) {
              uniqueCorrections.push(correction);
            }
          }
          
          if (uniqueCorrections.length > 0) {
            allCorrections.set(parentMeter.id, uniqueCorrections);
            console.log(`📊 ${parentMeter.meter_number} now has ${uniqueCorrections.length} corrections (propagated)`);
          }
        }
        
        onMeterCorrections?.(allCorrections);
        onHierarchyCsvData?.(csvResults);
        onHierarchyGenerated?.(true);
        toast.success(`Generated ${sortedParentMeters.length} hierarchical CSV file(s)`);
      } else {
        toast.info("No parent meters found - no hierarchical CSVs needed");
        onHierarchyGenerated?.(true);
      }
      
      return true;
    } catch (error: any) {
      console.error("Error generating hierarchy:", error);
      if (!cancelRef.current) {
        toast.error(`Failed to generate hierarchy: ${error.message}`);
      } else {
        toast.info("Hierarchy generation cancelled");
      }
      onHierarchyGenerated?.(false);
      onHierarchyCsvData?.(new Map());
      return false;
    } finally {
      onCsvGenerationProgress?.({ current: 0, total: 0 });
    }
  }, [
    siteId,
    previewDataRef,
    selectedColumnsRef,
    cancelRef,
    generateHierarchicalCsvForMeter,
    onCsvGenerationProgress,
    onMeterCorrections,
    onMeterConnectionsMapUpdate,
    onHierarchyCsvData,
    onHierarchyGenerated,
  ]);

  /**
   * Run preview - fetch meter data and extract available columns
   */
  const runPreview = useCallback(async (
    dateFrom: Date,
    dateTo: Date,
    timeFrom: string,
    timeTo: string,
    selectedMeterId: string,
    meterDateRange: { earliest: Date | null; latest: Date | null },
    loadFullMeterHierarchy: () => Promise<void>,
    metersFullyLoaded: boolean
  ): Promise<boolean> => {
    try {
      // Load full meter hierarchy if not already loaded
      if (!metersFullyLoaded) {
        toast.info("Loading meter hierarchy...");
        await loadFullMeterHierarchy();
      }

      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // First check if there's any data in the selected range
      const { count, error: countError } = await supabase
        .from("meter_readings")
        .select("*", { count: "exact", head: true })
        .eq("meter_id", selectedMeterId)
        .gte("reading_timestamp", fullDateTimeFrom)
        .lte("reading_timestamp", fullDateTimeTo);

      if (countError) throw countError;

      if (count === 0) {
        toast.error(
          `No data found for the selected date range. This meter has data from ${
            meterDateRange.earliest ? format(meterDateRange.earliest, "MMM dd, yyyy") : "N/A"
          } to ${
            meterDateRange.latest ? format(meterDateRange.latest, "MMM dd, yyyy") : "N/A"
          }`
        );
        return false;
      }

      // Fetch the selected meter
      const { data: meterData, error: meterError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("id", selectedMeterId)
        .single();

      if (meterError || !meterData) {
        toast.error("Failed to fetch selected meter");
        return false;
      }

      const selectedMeter = meterData;

      // Fetch column mapping from CSV file
      const { data: csvFile, error: csvError } = await supabase
        .from("meter_csv_files")
        .select("column_mapping")
        .eq("meter_id", selectedMeter.id)
        .not("column_mapping", "is", null)
        .order("parsed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (csvError) {
        console.error("Error fetching column mapping:", csvError);
      }

      const columnMapping = csvFile?.column_mapping as any;

      // Fetch ALL readings using pagination
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error: readingsError } = await supabase
          .from("meter_readings")
          .select("*")
          .eq("meter_id", selectedMeter.id)
          .gte("reading_timestamp", fullDateTimeFrom)
          .lte("reading_timestamp", fullDateTimeTo)
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (readingsError) {
          toast.error(`Failed to fetch readings: ${readingsError.message}`);
          return false;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      const readings = allReadings;

      if (!readings || readings.length === 0) {
        toast.error("No readings found in selected date range");
        return false;
      }

      console.log(`Preview: Fetched ${readings.length} readings for meter ${selectedMeter.meter_number}`);

      // Extract available columns from actual meter readings data (authoritative source)
      const availableColumns = new Set<string>();
      readings.forEach(reading => {
        const metadata = reading.metadata as any;
        if (metadata && metadata.imported_fields) {
          Object.keys(metadata.imported_fields).forEach(key => {
            availableColumns.add(key);
          });
        }
      });

      console.log('Column Mapping:', columnMapping);
      console.log('Available Columns:', Array.from(availableColumns));

      // Auto-select all columns initially
      onSelectedColumns?.(new Set(availableColumns));

      // Calculate totals and store raw values for operations
      const totalKwh = readings.reduce((sum, r) => sum + Number(r.kwh_value || 0), 0);
      const columnTotals: Record<string, number> = {};
      const columnValues: Record<string, number[]> = {};
      
      readings.forEach(reading => {
        const metadata = reading.metadata as any;
        const importedFields = metadata?.imported_fields || {};
        Object.entries(importedFields).forEach(([key, value]) => {
          const numValue = Number(value);
          if (!isNaN(numValue) && value !== null && value !== '') {
            columnTotals[key] = (columnTotals[key] || 0) + numValue;
            if (!columnValues[key]) {
              columnValues[key] = [];
            }
            columnValues[key].push(numValue);
          }
        });
      });

      onPreviewData?.({
        meterNumber: selectedMeter.meter_number,
        meterType: selectedMeter.meter_type,
        totalReadings: readings.length,
        firstReading: readings[0],
        lastReading: readings[readings.length - 1],
        sampleReadings: readings.slice(0, 5),
        availableColumns: Array.from(availableColumns),
        totalKwh,
        columnTotals,
        columnValues
      });

      // Restore saved settings if available
      try {
        const preLoadedSettings = (window as any).__savedColumnSettings;
        
        if (preLoadedSettings) {
          if (preLoadedSettings.selected_columns && preLoadedSettings.selected_columns.length > 0) {
            const validSelectedColumns = preLoadedSettings.selected_columns.filter((col: string) => 
              availableColumns.has(col)
            );
            if (validSelectedColumns.length > 0) {
              onSelectedColumns?.(new Set(validSelectedColumns));
            }
          }

          if (preLoadedSettings.column_operations) {
            const operations = new Map(Object.entries(preLoadedSettings.column_operations || {}) as [string, string][]);
            onColumnOperations?.(operations);
          }

          if (preLoadedSettings.column_factors) {
            const factors = new Map(Object.entries(preLoadedSettings.column_factors || {}) as [string, string][]);
            onColumnFactors?.(factors);
          }

          delete (window as any).__savedColumnSettings;
          toast.success("Restored previous column settings");
        } else {
          const { data: savedSettings } = await supabase
            .from('site_reconciliation_settings')
            .select('*')
            .eq('site_id', siteId)
            .maybeSingle();

          if (savedSettings) {
            if (savedSettings.selected_columns && savedSettings.selected_columns.length > 0) {
              const validSelectedColumns = savedSettings.selected_columns.filter((col: string) => 
                availableColumns.has(col)
              );
              if (validSelectedColumns.length > 0) {
                onSelectedColumns?.(new Set(validSelectedColumns));
              }
            }

            if (savedSettings.column_operations) {
              const operations = new Map(Object.entries(savedSettings.column_operations || {}) as [string, string][]);
              onColumnOperations?.(operations);
            }

            if (savedSettings.column_factors) {
              const factors = new Map(Object.entries(savedSettings.column_factors || {}) as [string, string][]);
              onColumnFactors?.(factors);
            }

            toast.success("Restored previous settings");
          }
        }
      } catch (error) {
        console.error("Error restoring settings:", error);
      }

      toast.success("Preview loaded successfully");
      return true;
    } catch (error) {
      console.error("Preview error:", error);
      toast.error("Failed to load preview");
      return false;
    }
  }, [siteId, onPreviewData, onSelectedColumns, onColumnOperations, onColumnFactors]);

  /**
   * Run full reconciliation with hierarchical data fetching
   */
  const runReconciliation = useCallback(async (options: RunReconciliationOptions) => {
    const {
      dateFrom,
      dateTo,
      timeFrom,
      timeTo,
      enableRevenue,
      availableMeters,
      meterConnectionsMap,
      hierarchyGenerated,
      meterCorrections,
      getMetersWithUploadedCsvs,
      updateMeterCategoryWithHierarchy,
      saveReconciliationSettings,
      setIsLoading,
      setFailedMeters,
      setHierarchicalCsvResults,
      setReconciliationData,
      setAvailableMeters,
      setIsColumnsOpen,
      setIsMetersOpen,
      setIsCancelling,
      setIsGeneratingCsvs,
    } = options;

    setIsColumnsOpen(false);
    setIsMetersOpen(false);
    cancelRef.current = false;
    
    setIsLoading(true);
    onEnergyProgress?.({ current: 0, total: 0 });
    onRevenueProgress?.({ current: 0, total: 0 });
    setFailedMeters(new Map());
    setHierarchicalCsvResults(new Map());
    
    if (!hierarchyGenerated) {
      onMeterCorrections?.(new Map());
    }

    try {
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch existing hierarchical data
      let csvResults = new Map<string, { totalKwh: number; columnTotals: Record<string, number>; columnMaxValues: Record<string, number>; rowCount: number }>();
      const allCorrections = new Map(meterCorrections);

      const parentMetersForCsv = availableMeters.filter(meter => {
        const children = meterConnectionsMap.get(meter.id);
        return children && children.length > 0;
      });

      if (parentMetersForCsv.length > 0) {
        const parentMeterIds = parentMetersForCsv.map(m => m.id);
        
        console.log(`STEP 1: Fetching existing hierarchical data for ${parentMeterIds.length} parent meters...`);
        
        // Paginated fetch from hierarchical_meter_readings
        for (const meterId of parentMeterIds) {
          let allReadings: any[] = [];
          let start = 0;
          const pageSize = 1000;
          let hasMore = true;
          
          while (hasMore) {
            const { data: pageData } = await supabase
              .from('hierarchical_meter_readings')
              .select('kwh_value, kva_value, metadata')
              .eq('meter_id', meterId)
              .gte('reading_timestamp', fullDateTimeFrom)
              .lte('reading_timestamp', fullDateTimeTo)
              .eq('metadata->>source', 'hierarchical_aggregation')
              .order('reading_timestamp', { ascending: true })
              .range(start, start + pageSize - 1);
            
            if (pageData && pageData.length > 0) {
              allReadings = allReadings.concat(pageData);
              start += pageSize;
              hasMore = pageData.length === pageSize;
            } else {
              hasMore = false;
            }
          }
          
          if (allReadings.length > 0) {
            let totalKwh = 0;
            const columnTotals: Record<string, number> = {};
            const columnMaxValues: Record<string, number> = {};
            
            allReadings.forEach(r => {
              totalKwh += r.kwh_value || 0;
              const metadata = r.metadata as any;
              const imported = metadata?.imported_fields || {};
              Object.entries(imported).forEach(([key, value]) => {
                const numValue = Number(value) || 0;
                const operation = columnOperationsRef.current.get(key) || 'sum';
                
                if (operation === 'max') {
                  columnMaxValues[key] = Math.max(columnMaxValues[key] || 0, numValue);
                } else {
                  columnTotals[key] = (columnTotals[key] || 0) + numValue;
                }
              });
            });
            
            csvResults.set(meterId, {
              totalKwh,
              columnTotals,
              columnMaxValues,
              rowCount: allReadings.length
            });
          }
        }
        
        console.log(`STEP 1 COMPLETE: Using hierarchical data for ${csvResults.size} parent meter(s)`);
      }

      const parentMeterIds = parentMetersForCsv.map(m => m.id);
      const metersWithUploadedCsvs = await getMetersWithUploadedCsvs(parentMeterIds);

      console.log('STEP 2: Performing energy/revenue reconciliation...');
      
      const { meterData, errors, reconciliationData, leafCorrectionsByMeter } = await performReconciliationCalculation(
        fullDateTimeFrom,
        fullDateTimeTo,
        enableRevenue
      );

      setFailedMeters(errors);
      
      if (enableRevenue) {
        setIsCalculatingRevenue?.(false);
        toast.success("Revenue calculation complete");
      }

      // Merge corrections
      for (const [meterId, corrections] of leafCorrectionsByMeter.entries()) {
        if (allCorrections.has(meterId)) {
          allCorrections.get(meterId)!.push(...corrections);
        } else {
          allCorrections.set(meterId, corrections);
        }
      }
      
      // Propagate corrections from children to parents
      const getAllDescendantCorrections = (meterId: string): CorrectedReading[] => {
        const childIds = meterConnectionsMap.get(meterId) || [];
        let descendantCorrections: CorrectedReading[] = [];
        
        for (const childId of childIds) {
          const childCorrections = allCorrections.get(childId) || [];
          const leafCorrections = leafCorrectionsByMeter.get(childId) || [];
          const grandchildCorrections = getAllDescendantCorrections(childId);
          descendantCorrections.push(...childCorrections, ...leafCorrections, ...grandchildCorrections);
        }
        
        return descendantCorrections;
      };
      
      const parentMeters = meterData.filter(meter => {
        const children = meterConnectionsMap.get(meter.id);
        return children && children.length > 0;
      });
      
      for (const parentMeter of parentMeters) {
        const existingCorrections = allCorrections.get(parentMeter.id) || [];
        const descendantCorrections = getAllDescendantCorrections(parentMeter.id);
        
        const uniqueCorrections = [...existingCorrections];
        for (const correction of descendantCorrections) {
          const isDuplicate = uniqueCorrections.some(c =>
            c.timestamp === correction.timestamp &&
            c.originalSourceMeterId === correction.originalSourceMeterId &&
            c.fieldName === correction.fieldName
          );
          if (!isDuplicate) {
            uniqueCorrections.push(correction);
          }
        }
        
        if (uniqueCorrections.length > 0) {
          allCorrections.set(parentMeter.id, uniqueCorrections);
        }
      }
      
      onMeterCorrections?.(allCorrections);

      // Update meters with hierarchical values
      reconciliationData.councilBulk = updateMeterCategoryWithHierarchy(reconciliationData.councilBulk || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.bulkMeters = updateMeterCategoryWithHierarchy(reconciliationData.bulkMeters || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.solarMeters = updateMeterCategoryWithHierarchy(reconciliationData.solarMeters || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.checkMeters = updateMeterCategoryWithHierarchy(reconciliationData.checkMeters || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.tenantMeters = updateMeterCategoryWithHierarchy(reconciliationData.tenantMeters || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.distribution = updateMeterCategoryWithHierarchy(reconciliationData.distribution || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.distributionMeters = updateMeterCategoryWithHierarchy(reconciliationData.distributionMeters || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.otherMeters = updateMeterCategoryWithHierarchy(reconciliationData.otherMeters || [], csvResults, metersWithUploadedCsvs);
      reconciliationData.unassignedMeters = updateMeterCategoryWithHierarchy(reconciliationData.unassignedMeters || [], csvResults, metersWithUploadedCsvs);

      setHierarchicalCsvResults(csvResults);
      await saveReconciliationSettings();
      setReconciliationData(reconciliationData);

      setAvailableMeters(prevMeters => 
        prevMeters.map(meter => {
          const meterReadings = meterData.find(m => m.id === meter.id);
          return {
            ...meter,
            hasData: meterReadings ? meterReadings.readingsCount > 0 : false
          };
        })
      );

      if (errors.size > 0) {
        toast.warning(`Reconciliation complete with ${errors.size} meter failure${errors.size > 1 ? 's' : ''}`);
      } else {
        toast.success("Reconciliation complete");
      }

      return { success: true, reconciliationData };
    } catch (error: any) {
      console.error("Reconciliation error:", error);
      
      if (error.message === 'Reconciliation cancelled by user') {
        toast.info("Reconciliation cancelled");
      } else {
        toast.error("Failed to complete reconciliation");
      }
      
      return { success: false, error };
    } finally {
      setIsLoading(false);
      setIsCalculatingRevenue?.(false);
      setIsCancelling(false);
      setIsGeneratingCsvs(false);
      onCsvGenerationProgress?.({ current: 0, total: 0 });
      cancelRef.current = false;
    }
  }, [cancelRef, columnOperationsRef, performReconciliationCalculation, onEnergyProgress, onRevenueProgress, onMeterCorrections, onCsvGenerationProgress, setIsCalculatingRevenue]);

  /**
   * Run bulk reconciliation for multiple document periods
   * Calls edge function to run in background - persists even if browser closes
   */
  const runBulkReconcile = useCallback(async (options: BulkReconcileOptions) => {
    const {
      selectedDocumentIds,
      documentDateRanges,
      availableMeters,
      enableRevenue,
      selectedColumns,
      columnOperations,
      columnFactors,
      meterAssignments,
      meterOrder,
      setIsBulkProcessing,
      setBulkProgress,
      setCurrentJobId,
    } = options;

    if (selectedDocumentIds.length === 0) {
      toast.error("Please select at least one period to reconcile");
      return;
    }

    setIsBulkProcessing(true);
    setBulkProgress({
      currentDocument: 'Starting...',
      current: 0,
      total: selectedDocumentIds.length
    });

    try {
      // Call edge function to start background processing
      const { data, error } = await supabase.functions.invoke('run-bulk-reconciliation', {
        body: {
          siteId,
          documentPeriodIds: selectedDocumentIds,
          documentDateRanges: documentDateRanges.filter(d => selectedDocumentIds.includes(d.id)),
          enableRevenue,
          meterConfig: {
            selectedColumns,
            columnOperations,
            columnFactors,
            meterAssignments,
            meterOrder
          }
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.jobId) {
        throw new Error('No job ID returned from edge function');
      }

      const jobId = data.jobId;
      setCurrentJobId(jobId);
      
      console.log('Bulk reconciliation job started:', jobId);
      toast.success("Bulk reconciliation started in background - you can close this page", {
        duration: 5000,
        description: "Progress will be tracked and you can check results later"
      });

      // Set up realtime subscription to track progress
      const channel = supabase
        .channel(`bulk-job-${jobId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'bulk_reconciliation_jobs',
            filter: `id=eq.${jobId}`
          },
          (payload: any) => {
            const job = payload.new;
            console.log('Job update received:', job);
            
            setBulkProgress({
              currentDocument: job.current_period || '',
              current: job.completed_periods || 0,
              total: job.total_periods || selectedDocumentIds.length
            });

            if (job.status === 'complete') {
              setIsBulkProcessing(false);
              setCurrentJobId(null);
              toast.success(`Bulk reconciliation complete! ${job.completed_periods} reconciliation(s) saved.`);
              supabase.removeChannel(channel);
            } else if (job.status === 'failed') {
              setIsBulkProcessing(false);
              setCurrentJobId(null);
              toast.error(`Bulk reconciliation failed: ${job.error_message || 'Unknown error'}`);
              supabase.removeChannel(channel);
            } else if (job.status === 'cancelled') {
              setIsBulkProcessing(false);
              setCurrentJobId(null);
              toast.info('Bulk reconciliation was cancelled');
              supabase.removeChannel(channel);
            }
          }
        )
        .subscribe();

    } catch (error: any) {
      console.error("Bulk reconciliation error:", error);
      toast.error(`Failed to start bulk reconciliation: ${error.message}`);
      setIsBulkProcessing(false);
      setCurrentJobId(null);
    }
  }, [siteId]);

  return {
    runHierarchyGeneration,
    runPreview,
    runReconciliation,
    runBulkReconcile,
  };
}

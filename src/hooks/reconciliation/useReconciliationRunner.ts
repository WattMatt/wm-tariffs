import { useCallback, RefObject } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { calculateMeterCost, calculateMeterCostAcrossPeriods } from '@/lib/costCalculation';
import { isValueCorrupt, type CorrectedReading } from '@/lib/dataValidation';
import type { ReconciliationResult, RevenueData, MeterResult } from './useReconciliationExecution';

export interface UseReconciliationRunnerOptions {
  siteId: string;
  selectedColumnsRef: RefObject<Set<string>>;
  columnOperationsRef: RefObject<Map<string, string>>;
  columnFactorsRef: RefObject<Map<string, string>>;
  meterAssignments: Map<string, string>;
  cancelRef: RefObject<boolean>;
  previewDataRef: RefObject<{ availableColumns: string[] } | null>;
  onEnergyProgress?: (progress: { current: number; total: number }) => void;
  onRevenueProgress?: (progress: { current: number; total: number }) => void;
  setIsCalculatingRevenue?: (value: boolean) => void;
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

  return {
    processSingleMeter,
    processMeterBatches,
    performReconciliationCalculation,
    generateHierarchicalCsvForMeter,
  };
}

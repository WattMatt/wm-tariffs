import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== CORRUPTION DETECTION THRESHOLDS (copied from generate-hierarchical-csv) =====
const CORRUPTION_THRESHOLDS = {
  maxKwhPer30Min: 10000,    // Max kWh for a single 30-min reading
  maxKvaPer30Min: 50000,    // Max kVA for a single 30-min reading
  maxMetadataValue: 100000, // Max for any metadata column (P1, P2, S, etc.)
};

interface CorruptionCorrection {
  meterId: string;
  meterNumber: string;
  timestamp: string;
  fieldName: string;
  originalValue: number;
  correctedValue: number;
  reason: string;
}

function isValueCorrupt(value: number, fieldName: string): boolean {
  const absValue = Math.abs(value);
  const fieldLower = fieldName.toLowerCase();
  
  if (fieldLower === 'kwh_value' || fieldLower.includes('kwh') || /^p\d+$/i.test(fieldLower)) {
    return absValue > CORRUPTION_THRESHOLDS.maxKwhPer30Min;
  }
  
  if (fieldLower.includes('kva') || fieldLower === 's') {
    return absValue > CORRUPTION_THRESHOLDS.maxKvaPer30Min;
  }
  
  return absValue > CORRUPTION_THRESHOLDS.maxMetadataValue;
}

function validateAndCorrectValue(
  value: number,
  fieldName: string,
  meterId: string,
  meterNumber: string,
  timestamp: string,
  prevValue: number | null = null,
  nextValue: number | null = null,
  corrections: CorruptionCorrection[] = []
): number {
  if (!isValueCorrupt(value, fieldName)) {
    return value;
  }
  
  let correctedValue = 0;
  let reason = '';
  
  if (prevValue !== null && nextValue !== null && !isValueCorrupt(prevValue, fieldName) && !isValueCorrupt(nextValue, fieldName)) {
    correctedValue = (prevValue + nextValue) / 2;
    reason = `Interpolated from neighbors (${prevValue.toFixed(2)}, ${nextValue.toFixed(2)})`;
  } else if (prevValue !== null && !isValueCorrupt(prevValue, fieldName)) {
    correctedValue = prevValue;
    reason = `Used previous value (${prevValue.toFixed(2)})`;
  } else if (nextValue !== null && !isValueCorrupt(nextValue, fieldName)) {
    correctedValue = nextValue;
    reason = `Used next value (${nextValue.toFixed(2)})`;
  } else {
    correctedValue = 0;
    reason = 'Zeroed out (no valid neighbors)';
  }
  
  console.warn(`⚠️ CORRUPT VALUE DETECTED: ${meterNumber} @ ${timestamp} - ${fieldName}: ${value.toLocaleString()} → ${correctedValue.toFixed(2)} (${reason})`);
  
  corrections.push({
    meterId,
    meterNumber,
    timestamp,
    fieldName,
    originalValue: value,
    correctedValue,
    reason
  });
  
  return correctedValue;
}

interface BulkReconciliationRequest {
  siteId: string;
  documentPeriodIds: string[];
  documentDateRanges: Array<{
    id: string;
    file_name: string;
    period_start: string;
    period_end: string;
  }>;
  enableRevenue: boolean;
  meterConfig: {
    selectedColumns: string[];
    columnOperations: Record<string, string>;
    columnFactors: Record<string, string>;
    meterAssignments: Record<string, string>;
    meterOrder: string[];
  };
}

// UPDATED: Full MeterResult interface matching frontend
interface MeterResult {
  id: string;
  meter_number: string;
  meter_type: string;
  name: string | null;
  location: string | null;
  assignment: string;
  
  // Legacy fields (for backward compatibility - these represent "main" values)
  totalKwh: number;
  totalKwhPositive: number;
  totalKwhNegative: number;
  columnTotals: Record<string, number>;
  columnMaxValues: Record<string, number>;
  readingsCount: number;
  
  // Direct data (from meter_readings table - uploaded CSVs)
  directTotalKwh: number;
  directColumnTotals: Record<string, number>;
  directColumnMaxValues: Record<string, number>;
  directReadingsCount: number;
  
  // Hierarchical data (from hierarchical_meter_readings table - generated CSVs)
  hierarchicalTotalKwh: number;
  hierarchicalColumnTotals: Record<string, number>;
  hierarchicalColumnMaxValues: Record<string, number>;
  hierarchicalReadingsCount: number;
  
  // Direct revenue
  directEnergyCost: number;
  directFixedCharges: number;
  directDemandCharges: number;
  directTotalCost: number;
  directAvgCostPerKwh: number;
  
  // Hierarchical revenue
  hierarchicalEnergyCost: number;
  hierarchicalFixedCharges: number;
  hierarchicalDemandCharges: number;
  hierarchicalTotalCost: number;
  hierarchicalAvgCostPerKwh: number;
  
  hasData: boolean;
  hasError: boolean;
  errorMessage?: string;
  tariff_structure_id?: string;
  assigned_tariff_name?: string;
  costCalculationError?: string;
}

interface CostResult {
  energyCost: number;
  fixedCharges: number;
  demandCharges: number;
  totalCost: number;
  avgCostPerKwh: number;
  hasError: boolean;
  errorMessage?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const requestBody = await req.json() as BulkReconciliationRequest;
    const {
      siteId,
      documentPeriodIds,
      documentDateRanges,
      enableRevenue,
      meterConfig
    } = requestBody;

    console.log('=== BULK RECONCILIATION REQUEST ===');
    console.log('Site ID:', siteId);
    console.log('Periods to process:', documentPeriodIds.length);
    console.log('Enable revenue:', enableRevenue);

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('bulk_reconciliation_jobs')
      .insert({
        site_id: siteId,
        status: 'running',
        total_periods: documentPeriodIds.length,
        completed_periods: 0,
        current_period: null,
        document_period_ids: documentPeriodIds,
        enable_revenue: enableRevenue,
        meter_config: meterConfig
      })
      .select()
      .single();

    if (jobError) {
      throw new Error(`Failed to create job: ${jobError.message}`);
    }

    console.log('Created job:', job.id);

    // Start background processing using EdgeRuntime.waitUntil
    const backgroundTask = processBulkReconciliation(
      supabase,
      job.id,
      siteId,
      documentPeriodIds,
      documentDateRanges,
      enableRevenue,
      meterConfig
    );

    // Use waitUntil to keep function running in background
    (globalThis as any).EdgeRuntime?.waitUntil?.(backgroundTask);

    // Return immediately with job ID
    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        message: 'Bulk reconciliation started in background'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error starting bulk reconciliation:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

async function processBulkReconciliation(
  supabase: any,
  jobId: string,
  siteId: string,
  documentPeriodIds: string[],
  documentDateRanges: Array<{ id: string; file_name: string; period_start: string; period_end: string }>,
  enableRevenue: boolean,
  meterConfig: any
) {
  console.log(`=== BACKGROUND PROCESSING STARTED FOR JOB ${jobId} ===`);
  
  let completedPeriods = 0;
  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  try {
    // Fetch all meters for this site
    const { data: allMeters, error: metersError } = await supabase
      .from('meters')
      .select('id, meter_number, meter_type, name, location, tariff_structure_id, assigned_tariff_name')
      .eq('site_id', siteId);

    if (metersError) {
      throw new Error(`Failed to fetch meters: ${metersError.message}`);
    }

    // Fetch meter connections
    const meterIds = allMeters?.map((m: any) => m.id) || [];
    const { data: connections } = await supabase
      .from('meter_connections')
      .select('parent_meter_id, child_meter_id')
      .in('parent_meter_id', meterIds);

    // Build connections map
    const meterConnectionsMap = new Map<string, string[]>();
    connections?.forEach((c: any) => {
      const existing = meterConnectionsMap.get(c.parent_meter_id) || [];
      existing.push(c.child_meter_id);
      meterConnectionsMap.set(c.parent_meter_id, existing);
    });

    // Fetch site's supply authority for revenue calculation
    const { data: site } = await supabase
      .from('sites')
      .select('supply_authority_id')
      .eq('id', siteId)
      .single();

    const supplyAuthorityId = site?.supply_authority_id;

    // Process each document period
    for (let i = 0; i < documentPeriodIds.length; i++) {
      const docId = documentPeriodIds[i];
      const doc = documentDateRanges.find(d => d.id === docId);
      
      if (!doc) {
        console.warn(`Document ${docId} not found in date ranges, skipping...`);
        continue;
      }

      // Check if job was cancelled
      const { data: jobStatus } = await supabase
        .from('bulk_reconciliation_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (jobStatus?.status === 'cancelled') {
        console.log(`Job ${jobId} was cancelled, stopping processing`);
        break;
      }

      // Update progress
      await supabase
        .from('bulk_reconciliation_jobs')
        .update({
          current_period: doc.file_name,
          completed_periods: completedPeriods
        })
        .eq('id', jobId);

      console.log(`Processing period ${i + 1}/${documentPeriodIds.length}: ${doc.file_name}`);

      try {
        // Calculate date range
        const startDate = new Date(doc.period_start);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(doc.period_end);
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(23, 59, 0, 0);

        const dateFrom = formatDateTimeForQuery(startDate, '00:00');
        const dateTo = formatDateTimeForQuery(endDate, '23:59');

        // STEP 1: Generate hierarchy by calling generate-hierarchical-csv edge function
        console.log(`Step 1: Generating hierarchy for ${doc.file_name}...`);
        
        // Copy leaf meters first
        const copyResponse = await supabase.functions.invoke('generate-hierarchical-csv', {
          body: {
            siteId,
            dateFrom,
            dateTo,
            copyLeafMetersOnly: true,
            meterAssociations: meterConfig.meterAssignments
          }
        });

        if (copyResponse.error) {
          console.warn(`Leaf meter copy failed: ${copyResponse.error.message}`);
        } else {
          console.log(`Leaf meters copied: ${copyResponse.data?.totalReadingsCopied || 0} readings`);
        }

        // Generate parent meter hierarchies
        const parentMeters = allMeters?.filter((m: any) => meterConnectionsMap.has(m.id)) || [];
        const sortedParents = sortParentMetersByDepth(parentMeters, meterConnectionsMap);

        for (const parentMeter of sortedParents) {
          const childIds = meterConnectionsMap.get(parentMeter.id) || [];
          
          const hierarchyResponse = await supabase.functions.invoke('generate-hierarchical-csv', {
            body: {
              parentMeterId: parentMeter.id,
              parentMeterNumber: parentMeter.meter_number,
              siteId,
              dateFrom,
              dateTo,
              childMeterIds: childIds,
              columns: meterConfig.selectedColumns,
              meterAssociations: meterConfig.meterAssignments
            }
          });

          if (hierarchyResponse.error) {
            console.warn(`Hierarchy generation failed for ${parentMeter.meter_number}: ${hierarchyResponse.error.message}`);
          }
        }

        // STEP 2: Calculate energy reconciliation (BOTH direct and hierarchical)
        console.log(`Step 2: Calculating energy for ${doc.file_name}...`);
        
        const { meterResults, reconciliationData } = await calculateReconciliation(
          supabase,
          siteId,
          dateFrom,
          dateTo,
          allMeters,
          meterConnectionsMap,
          meterConfig
        );

        // STEP 3: Calculate revenue for BOTH direct and hierarchical (if enabled)
        if (enableRevenue && supplyAuthorityId) {
          console.log(`Step 3: Calculating revenue for ${doc.file_name}...`);
          
          await calculateRevenueForAllMeters(
            supabase,
            meterResults,
            supplyAuthorityId,
            startDate,
            endDate
          );
        }

        // STEP 4: Save reconciliation run with ALL fields
        console.log(`Step 4: Saving reconciliation for ${doc.file_name}...`);
        
        const runName = `${doc.file_name}`;
        
        await saveReconciliationRun(
          supabase,
          siteId,
          runName,
          dateFrom,
          dateTo,
          reconciliationData,
          meterResults,
          enableRevenue
        );

        successCount++;
        completedPeriods++;
        console.log(`Completed period ${completedPeriods}/${documentPeriodIds.length}: ${doc.file_name}`);

      } catch (periodError: any) {
        console.error(`Error processing ${doc.file_name}:`, periodError);
        errorCount++;
        errors.push(doc.file_name);
        completedPeriods++;
      }
    }

    // Mark job complete
    await supabase
      .from('bulk_reconciliation_jobs')
      .update({
        status: errorCount === documentPeriodIds.length ? 'failed' : 'complete',
        completed_periods: completedPeriods,
        current_period: null,
        error_message: errors.length > 0 ? `Failed periods: ${errors.join(', ')}` : null
      })
      .eq('id', jobId);

    console.log(`=== JOB ${jobId} COMPLETE ===`);
    console.log(`Success: ${successCount}, Errors: ${errorCount}`);

  } catch (error: any) {
    console.error(`Fatal error in job ${jobId}:`, error);
    
    await supabase
      .from('bulk_reconciliation_jobs')
      .update({
        status: 'failed',
        error_message: error.message
      })
      .eq('id', jobId);
  }
}

// Helper to format date for query
function formatDateTimeForQuery(date: Date, time: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} ${time}:00`;
}

// Sort parent meters by depth (deepest first for bottom-up processing)
function sortParentMetersByDepth(
  parentMeters: any[],
  connectionsMap: Map<string, string[]>
): any[] {
  const getDepth = (meterId: string, visited = new Set<string>()): number => {
    if (visited.has(meterId)) return 0;
    visited.add(meterId);
    
    const children = connectionsMap.get(meterId) || [];
    if (children.length === 0) return 0;
    
    let maxChildDepth = 0;
    for (const childId of children) {
      const childDepth = getDepth(childId, visited);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }
    
    return maxChildDepth + 1;
  };

  return [...parentMeters].sort((a, b) => {
    const depthA = getDepth(a.id);
    const depthB = getDepth(b.id);
    return depthA - depthB; // Lower depth first (bottom-up)
  });
}

// Paginated fetch helper
async function fetchPaginatedReadings(
  supabase: any,
  tableName: string,
  meterId: string,
  dateFrom: string,
  dateTo: string,
  sourceFilter?: { key: string; value: string } | null
): Promise<any[]> {
  let readings: any[] = [];
  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;
  
  while (hasMore) {
    let query = supabase
      .from(tableName)
      .select('reading_timestamp, kwh_value, kva_value, metadata')
      .eq('meter_id', meterId)
      .gte('reading_timestamp', dateFrom)
      .lte('reading_timestamp', dateTo)
      .order('reading_timestamp', { ascending: true })
      .range(offset, offset + pageSize - 1);
    
    // Apply source filter if specified
    if (sourceFilter) {
      query = query.contains('metadata', { [sourceFilter.key]: sourceFilter.value });
    }
    
    const { data: pageData, error } = await query;
    
    if (error) {
      console.error(`Error fetching readings from ${tableName} for meter ${meterId}:`, error);
      break;
    }
    
    if (pageData && pageData.length > 0) {
      readings = readings.concat(pageData);
      offset += pageSize;
      hasMore = pageData.length === pageSize;
    } else {
      hasMore = false;
    }
  }
  
  return readings;
}

// Process readings and calculate totals with corruption detection
function processReadings(
  readings: any[],
  meter: any,
  meterConfig: any,
  corrections: CorruptionCorrection[]
): { totalKwh: number; columnTotals: Record<string, number>; columnMaxValues: Record<string, number> } {
  let totalKwh = 0;
  const columnTotals: Record<string, number> = {};
  const columnMaxValues: Record<string, number> = {};
  
  readings.forEach((r, index) => {
    const prevReading = index > 0 ? readings[index - 1] : null;
    const nextReading = index < readings.length - 1 ? readings[index + 1] : null;
    const timestamp = r.reading_timestamp || 'unknown';
    
    // Validate kwh_value
    const rawKwh = r.kwh_value || 0;
    const validatedKwh = validateAndCorrectValue(
      rawKwh, 'kwh_value', meter.id, meter.meter_number, timestamp,
      prevReading?.kwh_value ?? null,
      nextReading?.kwh_value ?? null,
      corrections
    );
    totalKwh += validatedKwh;
    
    const metadata = r.metadata as any;
    const imported = metadata?.imported_fields || {};
    
    Object.entries(imported).forEach(([key, value]) => {
      const rawValue = Number(value) || 0;
      
      const prevMeta = prevReading?.metadata as any;
      const nextMeta = nextReading?.metadata as any;
      const prevValue = prevMeta?.imported_fields?.[key] !== undefined ? Number(prevMeta.imported_fields[key]) : null;
      const nextValue = nextMeta?.imported_fields?.[key] !== undefined ? Number(nextMeta.imported_fields[key]) : null;
      
      const validatedValue = validateAndCorrectValue(
        rawValue, key, meter.id, meter.meter_number, timestamp,
        prevValue, nextValue, corrections
      );
      
      const factor = Number(meterConfig.columnFactors?.[key] || 1);
      const operation = meterConfig.columnOperations?.[key] || 'sum';
      
      const adjustedValue = validatedValue * factor;
      
      if (operation === 'max' || key.toLowerCase().includes('kva') || key.toLowerCase() === 's') {
        columnMaxValues[key] = Math.max(columnMaxValues[key] || 0, adjustedValue);
      } else {
        columnTotals[key] = (columnTotals[key] || 0) + adjustedValue;
      }
    });
  });
  
  // Calculate total from selected columns
  const selectedCols = meterConfig.selectedColumns || [];
  let calculatedTotal = 0;
  selectedCols.forEach((col: string) => {
    if (!col.toLowerCase().includes('kva') && !col.toLowerCase().includes('s')) {
      calculatedTotal += columnTotals[col] || 0;
    }
  });
  
  return {
    totalKwh: calculatedTotal || totalKwh,
    columnTotals,
    columnMaxValues
  };
}

// UPDATED: Calculate reconciliation - fetch from BOTH tables for ALL meters
async function calculateReconciliation(
  supabase: any,
  siteId: string,
  dateFrom: string,
  dateTo: string,
  allMeters: any[],
  meterConnectionsMap: Map<string, string[]>,
  meterConfig: any
): Promise<{ meterResults: MeterResult[]; reconciliationData: any }> {
  const meterResults: MeterResult[] = [];
  const parentMeterIds = new Set(meterConnectionsMap.keys());
  const corrections: CorruptionCorrection[] = [];

  for (const meter of allMeters) {
    const isParent = parentMeterIds.has(meter.id);
    const assignment = meterConfig.meterAssignments?.[meter.id] || 'unassigned';
    
    // ALWAYS fetch from BOTH tables for ALL meters
    
    // 1. Fetch DIRECT data from meter_readings (uploaded CSVs)
    // Filter: source is 'Parsed' or null (legacy data without source field)
    const directReadings = await fetchPaginatedReadings(
      supabase,
      'meter_readings',
      meter.id,
      dateFrom,
      dateTo,
      null // No filter - get all readings from meter_readings
    );
    
    // 2. Fetch HIERARCHICAL data from hierarchical_meter_readings
    // For parent meters: get hierarchical_aggregation source
    // For leaf meters: get Copied source
    const hierarchicalReadings = await fetchPaginatedReadings(
      supabase,
      'hierarchical_meter_readings',
      meter.id,
      dateFrom,
      dateTo,
      isParent 
        ? { key: 'source', value: 'hierarchical_aggregation' }
        : { key: 'source', value: 'Copied' }
    );
    
    console.log(`Meter ${meter.meter_number}: Direct=${directReadings.length}, Hierarchical=${hierarchicalReadings.length}`);
    
    // Process DIRECT readings
    const directData = processReadings(directReadings, meter, meterConfig, corrections);
    
    // Process HIERARCHICAL readings
    const hierarchicalData = processReadings(hierarchicalReadings, meter, meterConfig, corrections);
    
    // Build MeterResult with BOTH direct and hierarchical values
    const result: MeterResult = {
      id: meter.id,
      meter_number: meter.meter_number,
      meter_type: meter.meter_type,
      name: meter.name,
      location: meter.location,
      assignment,
      
      // Legacy fields - use hierarchical for parents, direct for leaf
      totalKwh: isParent ? hierarchicalData.totalKwh : directData.totalKwh,
      totalKwhPositive: Math.max(0, isParent ? hierarchicalData.totalKwh : directData.totalKwh),
      totalKwhNegative: Math.min(0, isParent ? hierarchicalData.totalKwh : directData.totalKwh),
      columnTotals: isParent ? hierarchicalData.columnTotals : directData.columnTotals,
      columnMaxValues: isParent ? hierarchicalData.columnMaxValues : directData.columnMaxValues,
      readingsCount: isParent ? hierarchicalReadings.length : directReadings.length,
      
      // DIRECT values (from meter_readings - uploaded CSVs)
      directTotalKwh: directData.totalKwh,
      directColumnTotals: directData.columnTotals,
      directColumnMaxValues: directData.columnMaxValues,
      directReadingsCount: directReadings.length,
      
      // HIERARCHICAL values (from hierarchical_meter_readings - generated CSVs)
      hierarchicalTotalKwh: hierarchicalData.totalKwh,
      hierarchicalColumnTotals: hierarchicalData.columnTotals,
      hierarchicalColumnMaxValues: hierarchicalData.columnMaxValues,
      hierarchicalReadingsCount: hierarchicalReadings.length,
      
      // Revenue fields - initialized to 0, will be populated by calculateRevenueForAllMeters
      directEnergyCost: 0,
      directFixedCharges: 0,
      directDemandCharges: 0,
      directTotalCost: 0,
      directAvgCostPerKwh: 0,
      
      hierarchicalEnergyCost: 0,
      hierarchicalFixedCharges: 0,
      hierarchicalDemandCharges: 0,
      hierarchicalTotalCost: 0,
      hierarchicalAvgCostPerKwh: 0,
      
      hasData: directReadings.length > 0 || hierarchicalReadings.length > 0,
      hasError: false,
      tariff_structure_id: meter.tariff_structure_id,
      assigned_tariff_name: meter.assigned_tariff_name
    };
    
    meterResults.push(result);
  }
  
  if (corrections.length > 0) {
    console.log(`Total corruption corrections: ${corrections.length}`);
  }

  // Build reconciliation data structure
  const reconciliationData = buildReconciliationData(meterResults);
  
  return { meterResults, reconciliationData };
}

// Calculate revenue for all meters - BOTH direct and hierarchical
async function calculateRevenueForAllMeters(
  supabase: any,
  meterResults: MeterResult[],
  supplyAuthorityId: string,
  dateFrom: Date,
  dateTo: Date
) {
  for (const meter of meterResults) {
    if (!meter.assigned_tariff_name && !meter.tariff_structure_id) {
      continue; // No tariff assigned, skip revenue calculation
    }
    
    try {
      // Get tariff for this meter
      const tariffId = await findTariffForMeter(
        supabase,
        meter,
        supplyAuthorityId,
        dateFrom,
        dateTo
      );
      
      if (!tariffId) {
        meter.costCalculationError = 'No matching tariff found';
        continue;
      }
      
      // Calculate DIRECT revenue (from meter_readings data)
      if (meter.directTotalKwh > 0) {
        const directMaxKva = getMaxKvaFromColumns(meter.directColumnMaxValues);
        const directCost = await calculateCostForMeter(
          supabase,
          tariffId,
          dateFrom,
          dateTo,
          meter.directTotalKwh,
          directMaxKva
        );
        
        meter.directEnergyCost = directCost.energyCost;
        meter.directFixedCharges = directCost.fixedCharges;
        meter.directDemandCharges = directCost.demandCharges;
        meter.directTotalCost = directCost.totalCost;
        meter.directAvgCostPerKwh = meter.directTotalKwh > 0 
          ? directCost.totalCost / meter.directTotalKwh 
          : 0;
        
        if (directCost.hasError) {
          meter.costCalculationError = directCost.errorMessage;
        }
      }
      
      // Calculate HIERARCHICAL revenue (from hierarchical_meter_readings data)
      if (meter.hierarchicalTotalKwh > 0) {
        const hierarchicalMaxKva = getMaxKvaFromColumns(meter.hierarchicalColumnMaxValues);
        const hierarchicalCost = await calculateCostForMeter(
          supabase,
          tariffId,
          dateFrom,
          dateTo,
          meter.hierarchicalTotalKwh,
          hierarchicalMaxKva
        );
        
        meter.hierarchicalEnergyCost = hierarchicalCost.energyCost;
        meter.hierarchicalFixedCharges = hierarchicalCost.fixedCharges;
        meter.hierarchicalDemandCharges = hierarchicalCost.demandCharges;
        meter.hierarchicalTotalCost = hierarchicalCost.totalCost;
        meter.hierarchicalAvgCostPerKwh = meter.hierarchicalTotalKwh > 0 
          ? hierarchicalCost.totalCost / meter.hierarchicalTotalKwh 
          : 0;
        
        if (hierarchicalCost.hasError && !meter.costCalculationError) {
          meter.costCalculationError = hierarchicalCost.errorMessage;
        }
      }
      
      console.log(`Revenue calculated for ${meter.meter_number}: Direct=$${meter.directTotalCost.toFixed(2)}, Hierarchical=$${meter.hierarchicalTotalCost.toFixed(2)}`);
      
    } catch (error: any) {
      console.error(`Revenue calculation error for ${meter.meter_number}:`, error);
      meter.costCalculationError = error.message;
    }
  }
}

// Find applicable tariff for a meter
async function findTariffForMeter(
  supabase: any,
  meter: MeterResult,
  supplyAuthorityId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<string | null> {
  // If meter has a specific tariff_structure_id, use that
  if (meter.tariff_structure_id) {
    return meter.tariff_structure_id;
  }
  
  // Otherwise, look up by tariff name and supply authority
  if (meter.assigned_tariff_name) {
    const { data: periods } = await supabase.rpc('get_applicable_tariff_periods', {
      p_supply_authority_id: supplyAuthorityId,
      p_tariff_name: meter.assigned_tariff_name,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString()
    });
    
    if (periods && periods.length > 0) {
      return periods[0].tariff_id;
    }
  }
  
  return null;
}

// Get max kVA from column max values (look for S or kVA columns)
function getMaxKvaFromColumns(columnMaxValues: Record<string, number>): number {
  let maxKva = 0;
  
  for (const [key, value] of Object.entries(columnMaxValues)) {
    const keyLower = key.toLowerCase();
    if (keyLower === 's' || keyLower.includes('kva')) {
      maxKva = Math.max(maxKva, value);
    }
  }
  
  return maxKva;
}

// Calculate cost for a meter using tariff - ported from frontend costCalculation.ts
async function calculateCostForMeter(
  supabase: any,
  tariffId: string,
  dateFrom: Date,
  dateTo: Date,
  totalKwh: number,
  maxKva: number
): Promise<CostResult> {
  try {
    // Fetch tariff structure with all related data
    const { data: tariff, error: tariffError } = await supabase
      .from('tariff_structures')
      .select('*, tariff_blocks(*), tariff_charges(*), tariff_time_periods(*)')
      .eq('id', tariffId)
      .single();
    
    if (tariffError || !tariff) {
      return {
        energyCost: 0,
        fixedCharges: 0,
        demandCharges: 0,
        totalCost: 0,
        avgCostPerKwh: 0,
        hasError: true,
        errorMessage: 'Tariff structure not found'
      };
    }
    
    let energyCost = 0;
    
    // Calculate energy cost based on tariff type
    if (tariff.tariff_blocks && tariff.tariff_blocks.length > 0) {
      // Block-based tariff
      let remainingKwh = totalKwh;
      const sortedBlocks = [...tariff.tariff_blocks].sort(
        (a: any, b: any) => a.block_number - b.block_number
      );
      
      for (const block of sortedBlocks) {
        const blockSize = block.kwh_to ? block.kwh_to - block.kwh_from : Infinity;
        const kwhInBlock = Math.min(remainingKwh, blockSize);
        
        if (kwhInBlock > 0) {
          energyCost += (kwhInBlock * block.energy_charge_cents) / 100;
          remainingKwh -= kwhInBlock;
        }
        
        if (remainingKwh <= 0) break;
      }
    } else if (tariff.tariff_charges && tariff.tariff_charges.length > 0) {
      // Check for both_seasons charge first
      const bothSeasonsCharge = tariff.tariff_charges.find(
        (c: any) => c.charge_type === 'energy_both_seasons'
      );
      
      if (bothSeasonsCharge) {
        energyCost = (totalKwh * Number(bothSeasonsCharge.charge_amount)) / 100;
      } else {
        // Seasonal flat-rate
        const seasonalCharges = {
          low_season: tariff.tariff_charges.find(
            (c: any) => c.charge_type === 'energy_low_season'
          ),
          high_season: tariff.tariff_charges.find(
            (c: any) => c.charge_type === 'energy_high_season'
          ),
        };
        
        if (seasonalCharges.low_season || seasonalCharges.high_season) {
          const startMonth = dateFrom.getMonth() + 1;
          const endMonth = dateTo.getMonth() + 1;
          
          const entirelyHighSeason = startMonth >= 6 && startMonth <= 8 && endMonth >= 6 && endMonth <= 8;
          
          const applicableCharge = entirelyHighSeason && seasonalCharges.high_season
            ? seasonalCharges.high_season
            : (seasonalCharges.low_season || seasonalCharges.high_season);
          
          if (applicableCharge) {
            energyCost = (totalKwh * Number(applicableCharge.charge_amount)) / 100;
          }
        }
      }
    }
    
    // Calculate fixed charges (prorated by calendar month days)
    let fixedCharges = 0;
    if (tariff.tariff_charges) {
      const monthlyCharge = tariff.tariff_charges.reduce((sum: number, charge: any) => {
        if (charge.charge_type === 'basic_monthly' || charge.charge_type === 'basic_charge') {
          return sum + Number(charge.charge_amount);
        }
        return sum;
      }, 0);
      
      fixedCharges = calculateProratedBasicCharges(dateFrom, dateTo, monthlyCharge);
    }
    
    // Calculate demand charges (kVA-based)
    let demandCharges = 0;
    if (tariff.tariff_charges && maxKva > 0) {
      const startMonth = dateFrom.getMonth() + 1;
      const endMonth = dateTo.getMonth() + 1;
      const isHighSeason = (startMonth >= 6 && startMonth <= 8) || (endMonth >= 6 && endMonth <= 8);
      
      const demandChargeType = isHighSeason ? 'demand_high_season' : 'demand_low_season';
      const demandCharge = tariff.tariff_charges.find(
        (c: any) => c.charge_type === demandChargeType
      );
      
      if (demandCharge) {
        demandCharges = maxKva * Number(demandCharge.charge_amount);
      }
    }
    
    const totalCost = energyCost + fixedCharges + demandCharges;
    const avgCostPerKwh = totalKwh > 0 ? totalCost / totalKwh : 0;
    
    return {
      energyCost,
      fixedCharges,
      demandCharges,
      totalCost,
      avgCostPerKwh,
      hasError: false
    };
    
  } catch (error: any) {
    return {
      energyCost: 0,
      fixedCharges: 0,
      demandCharges: 0,
      totalCost: 0,
      avgCostPerKwh: 0,
      hasError: true,
      errorMessage: error.message
    };
  }
}

// Calculate prorated basic charges (same as frontend)
function calculateProratedBasicCharges(
  dateFrom: Date,
  dateTo: Date,
  monthlyCharge: number
): number {
  let totalCharges = 0;
  let current = new Date(dateFrom);
  
  while (current <= dateTo) {
    const year = current.getFullYear();
    const month = current.getMonth();
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, daysInMonth);
    
    const periodStartInMonth = new Date(Math.max(current.getTime(), monthStart.getTime()));
    const periodEndInMonth = new Date(Math.min(dateTo.getTime(), monthEnd.getTime()));
    
    const daysInPeriod = Math.floor(
      (periodEndInMonth.getTime() - periodStartInMonth.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
    
    const proratedCharge = (monthlyCharge * daysInPeriod) / daysInMonth;
    totalCharges += proratedCharge;
    
    current = new Date(year, month + 1, 1);
  }
  
  return totalCharges;
}

// Build reconciliation data from meter results
function buildReconciliationData(meterResults: MeterResult[]) {
  const councilBulk: MeterResult[] = [];
  const bulkMeters: MeterResult[] = [];
  const solarMeters: MeterResult[] = [];
  const checkMeters: MeterResult[] = [];
  const tenantMeters: MeterResult[] = [];
  const distributionMeters: MeterResult[] = [];
  const otherMeters: MeterResult[] = [];
  const unassignedMeters: MeterResult[] = [];

  meterResults.forEach(meter => {
    const assignment = meter.assignment?.toLowerCase() || '';
    const meterType = meter.meter_type?.toLowerCase() || '';

    if (assignment === 'grid_supply' || meterType === 'council' || meterType === 'council_meter') {
      councilBulk.push(meter);
    } else if (assignment === 'bulk' || meterType === 'bulk' || meterType === 'bulk_meter') {
      bulkMeters.push(meter);
    } else if (assignment === 'solar_energy' || meterType === 'solar' || meterType === 'solar_meter') {
      solarMeters.push(meter);
    } else if (assignment === 'check' || meterType === 'check' || meterType === 'check_meter') {
      checkMeters.push(meter);
    } else if (assignment === 'tenant' || meterType === 'tenant' || meterType === 'tenant_meter') {
      tenantMeters.push(meter);
    } else if (assignment === 'distribution' || meterType === 'distribution') {
      distributionMeters.push(meter);
    } else if (assignment === 'unassigned' || !assignment) {
      unassignedMeters.push(meter);
    } else {
      otherMeters.push(meter);
    }
  });

  // Calculate totals with validation
  const safeSum = (meters: MeterResult[]) => {
    return meters.reduce((sum, m) => {
      const value = m.hierarchicalTotalKwh || m.totalKwh || 0;
      if (!isFinite(value) || Math.abs(value) > 1e12) {
        console.warn(`Skipping corrupt value for meter ${m.meter_number}: ${value}`);
        return sum;
      }
      return sum + value;
    }, 0);
  };

  const gridSupplyTotal = safeSum(councilBulk);
  const bulkMeterTotal = safeSum(bulkMeters);
  const solarTotal = solarMeters.reduce((sum, m) => {
    const value = Math.abs(m.hierarchicalTotalKwh || m.totalKwh || 0);
    if (!isFinite(value) || value > 1e12) return sum;
    return sum + value;
  }, 0);
  const tenantTotal = safeSum(tenantMeters);
  const checkTotal = safeSum(checkMeters);

  const totalSupply = gridSupplyTotal + Math.max(0, solarTotal);
  const distributionTotal = bulkMeterTotal + tenantTotal + checkTotal;
  const discrepancy = totalSupply - tenantTotal;
  
  let recoveryRate = totalSupply > 0 ? (tenantTotal / totalSupply) * 100 : 0;
  
  if (!isFinite(recoveryRate)) {
    recoveryRate = 0;
  } else if (recoveryRate < -1000 || recoveryRate > 1000) {
    recoveryRate = Math.max(-1000, Math.min(1000, recoveryRate));
  }

  // Calculate revenue totals
  const gridSupplyCost = councilBulk.reduce((sum, m) => sum + (m.hierarchicalTotalCost || m.directTotalCost || 0), 0);
  const solarCost = solarMeters.reduce((sum, m) => sum + (m.hierarchicalTotalCost || m.directTotalCost || 0), 0);
  const tenantCost = tenantMeters.reduce((sum, m) => sum + (m.hierarchicalTotalCost || m.directTotalCost || 0), 0);
  const totalRevenue = tenantCost;
  const avgCostPerKwh = tenantTotal > 0 ? tenantCost / tenantTotal : 0;

  console.log(`=== RECONCILIATION TOTALS ===`);
  console.log(`Grid Supply: ${gridSupplyTotal.toFixed(2)} kWh, Cost: R${gridSupplyCost.toFixed(2)}`);
  console.log(`Solar: ${solarTotal.toFixed(2)} kWh, Cost: R${solarCost.toFixed(2)}`);
  console.log(`Tenant: ${tenantTotal.toFixed(2)} kWh, Cost: R${tenantCost.toFixed(2)}`);
  console.log(`Recovery Rate: ${recoveryRate.toFixed(2)}%`);

  return {
    councilBulk,
    bulkMeters,
    solarMeters,
    checkMeters,
    tenantMeters,
    distributionMeters,
    distribution: [...bulkMeters, ...checkMeters, ...tenantMeters],
    otherMeters,
    unassignedMeters,
    bulkTotal: gridSupplyTotal,
    councilTotal: gridSupplyTotal,
    solarTotal,
    tenantTotal,
    checkTotal,
    totalSupply,
    distributionTotal,
    discrepancy,
    recoveryRate,
    // Revenue totals
    gridSupplyCost,
    solarCost,
    tenantCost,
    totalRevenue,
    avgCostPerKwh,
    revenueEnabled: true
  };
}

// UPDATED: Save reconciliation run with ALL direct/hierarchical fields
async function saveReconciliationRun(
  supabase: any,
  siteId: string,
  runName: string,
  dateFrom: string,
  dateTo: string,
  reconciliationData: any,
  meterResults: MeterResult[],
  enableRevenue: boolean
) {
  const validateNumber = (value: any, fallback = 0): number => {
    const num = Number(value);
    if (!isFinite(num)) return fallback;
    return num;
  };

  const bulkTotal = validateNumber(reconciliationData.bulkTotal);
  const solarTotal = validateNumber(reconciliationData.solarTotal);
  const tenantTotal = validateNumber(reconciliationData.tenantTotal);
  const totalSupply = validateNumber(reconciliationData.totalSupply);
  const recoveryRate = validateNumber(reconciliationData.recoveryRate);
  const discrepancy = validateNumber(reconciliationData.discrepancy);
  const gridSupplyCost = validateNumber(reconciliationData.gridSupplyCost);
  const solarCost = validateNumber(reconciliationData.solarCost);
  const tenantCost = validateNumber(reconciliationData.tenantCost);
  const totalRevenue = validateNumber(reconciliationData.totalRevenue);
  const avgCostPerKwh = validateNumber(reconciliationData.avgCostPerKwh);

  console.log(`Saving run: bulk=${bulkTotal.toFixed(2)} kWh, tenant=${tenantTotal.toFixed(2)} kWh, revenue=R${totalRevenue.toFixed(2)}`);

  // Insert reconciliation run with revenue fields
  const { data: run, error: runError } = await supabase
    .from('reconciliation_runs')
    .insert({
      site_id: siteId,
      run_name: runName,
      date_from: dateFrom,
      date_to: dateTo,
      bulk_total: bulkTotal,
      solar_total: solarTotal,
      tenant_total: tenantTotal,
      total_supply: totalSupply,
      recovery_rate: recoveryRate,
      discrepancy: discrepancy,
      revenue_enabled: enableRevenue,
      grid_supply_cost: gridSupplyCost,
      solar_cost: solarCost,
      tenant_cost: tenantCost,
      total_revenue: totalRevenue,
      avg_cost_per_kwh: avgCostPerKwh
    })
    .select()
    .single();

  if (runError) {
    throw new Error(`Failed to save reconciliation run: ${runError.message}`);
  }

  // Save meter results with ALL direct/hierarchical fields
  const meterResultsToInsert = meterResults.map((meter: MeterResult) => ({
    reconciliation_run_id: run.id,
    meter_id: meter.id,
    meter_number: meter.meter_number,
    meter_type: meter.meter_type,
    meter_name: meter.name,
    location: meter.location,
    assignment: meter.assignment,
    
    // Legacy fields
    total_kwh: meter.totalKwh || 0,
    total_kwh_positive: meter.totalKwhPositive || 0,
    total_kwh_negative: meter.totalKwhNegative || 0,
    column_totals: meter.columnTotals || {},
    column_max_values: meter.columnMaxValues || {},
    readings_count: meter.readingsCount || 0,
    
    // Direct kWh columns (from meter_readings - uploaded CSVs)
    direct_total_kwh: meter.directTotalKwh || 0,
    direct_readings_count: meter.directReadingsCount || 0,
    direct_column_totals: meter.directColumnTotals || {},
    direct_column_max_values: meter.directColumnMaxValues || {},
    
    // Hierarchical kWh columns (from hierarchical_meter_readings - generated CSVs)
    hierarchical_total: meter.hierarchicalTotalKwh || 0,
    hierarchical_readings_count: meter.hierarchicalReadingsCount || 0,
    hierarchical_column_totals: meter.hierarchicalColumnTotals || {},
    hierarchical_column_max_values: meter.hierarchicalColumnMaxValues || {},
    
    // Direct revenue columns
    direct_total_cost: meter.directTotalCost || 0,
    direct_energy_cost: meter.directEnergyCost || 0,
    direct_fixed_charges: meter.directFixedCharges || 0,
    direct_demand_charges: meter.directDemandCharges || 0,
    direct_avg_cost_per_kwh: meter.directAvgCostPerKwh || 0,
    
    // Hierarchical revenue columns
    hierarchical_total_cost: meter.hierarchicalTotalCost || 0,
    hierarchical_energy_cost: meter.hierarchicalEnergyCost || 0,
    hierarchical_fixed_charges: meter.hierarchicalFixedCharges || 0,
    hierarchical_demand_charges: meter.hierarchicalDemandCharges || 0,
    hierarchical_avg_cost_per_kwh: meter.hierarchicalAvgCostPerKwh || 0,
    
    // Error tracking
    has_error: meter.hasError || false,
    error_message: meter.errorMessage,
    tariff_structure_id: meter.tariff_structure_id,
    tariff_name: meter.assigned_tariff_name,
    cost_calculation_error: meter.costCalculationError
  }));

  if (meterResultsToInsert.length > 0) {
    const { error: resultsError } = await supabase
      .from('reconciliation_meter_results')
      .insert(meterResultsToInsert);

    if (resultsError) {
      console.error('Failed to save meter results:', resultsError);
    }
  }

  console.log(`Saved reconciliation run ${run.id} with ${meterResultsToInsert.length} meter results (incl. direct+hierarchical kWh & revenue)`);
  return run.id;
}

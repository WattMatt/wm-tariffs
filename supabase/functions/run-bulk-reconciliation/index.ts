import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

interface MeterResult {
  id: string;
  meter_number: string;
  meter_type: string;
  name: string | null;
  location: string | null;
  assignment: string;
  totalKwh: number;
  totalKwhPositive: number;
  totalKwhNegative: number;
  columnTotals: Record<string, number>;
  columnMaxValues: Record<string, number>;
  readingsCount: number;
  hasData: boolean;
  hasError: boolean;
  errorMessage?: string;
  hierarchicalTotalKwh?: number;
  tariff_structure_id?: string;
  assigned_tariff_name?: string;
  energyCost?: number;
  fixedCharges?: number;
  demandCharges?: number;
  totalCost?: number;
  avgCostPerKwh?: number;
  costCalculationError?: string;
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

        // STEP 2: Calculate energy reconciliation
        console.log(`Step 2: Calculating energy for ${doc.file_name}...`);
        
        const reconciliationData = await calculateReconciliation(
          supabase,
          siteId,
          dateFrom,
          dateTo,
          allMeters,
          meterConnectionsMap,
          meterConfig,
          enableRevenue
        );

        // STEP 3: Save reconciliation run
        console.log(`Step 3: Saving reconciliation for ${doc.file_name}...`);
        
        const runName = `${doc.file_name}`;
        
        await saveReconciliationRun(
          supabase,
          siteId,
          runName,
          dateFrom,
          dateTo,
          reconciliationData,
          allMeters,
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

// Calculate reconciliation for a period
async function calculateReconciliation(
  supabase: any,
  siteId: string,
  dateFrom: string,
  dateTo: string,
  allMeters: any[],
  meterConnectionsMap: Map<string, string[]>,
  meterConfig: any,
  enableRevenue: boolean
): Promise<any> {
  const meterResults: MeterResult[] = [];
  const parentMeterIds = new Set(meterConnectionsMap.keys());

  for (const meter of allMeters) {
    const isParent = parentMeterIds.has(meter.id);
    const assignment = meterConfig.meterAssignments?.[meter.id] || 'unassigned';
    
    let readings: any[] = [];
    const tableName = isParent ? 'hierarchical_meter_readings' : 'meter_readings';
    
    // Paginated fetch
    let offset = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      let query = supabase
        .from(tableName)
        .select('kwh_value, kva_value, metadata')
        .eq('meter_id', meter.id)
        .gte('reading_timestamp', dateFrom)
        .lte('reading_timestamp', dateTo)
        .order('reading_timestamp', { ascending: true })
        .range(offset, offset + pageSize - 1);
      
      if (isParent) {
        query = query.eq('metadata->>source', 'hierarchical_aggregation');
      }
      
      const { data: pageData, error } = await query;
      
      if (error) {
        console.error(`Error fetching readings for ${meter.meter_number}:`, error);
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

    // Calculate totals
    let totalKwh = 0;
    const columnTotals: Record<string, number> = {};
    const columnMaxValues: Record<string, number> = {};
    
    readings.forEach(r => {
      totalKwh += r.kwh_value || 0;
      const metadata = r.metadata as any;
      const imported = metadata?.imported_fields || {};
      
      Object.entries(imported).forEach(([key, value]) => {
        const numValue = Number(value) || 0;
        const factor = Number(meterConfig.columnFactors?.[key] || 1);
        const operation = meterConfig.columnOperations?.[key] || 'sum';
        
        const adjustedValue = numValue * factor;
        
        if (operation === 'max' || key.toLowerCase().includes('kva')) {
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
      if (!col.toLowerCase().includes('kva')) {
        calculatedTotal += columnTotals[col] || 0;
      }
    });

    meterResults.push({
      id: meter.id,
      meter_number: meter.meter_number,
      meter_type: meter.meter_type,
      name: meter.name,
      location: meter.location,
      assignment,
      totalKwh: calculatedTotal || totalKwh,
      totalKwhPositive: Math.max(0, calculatedTotal || totalKwh),
      totalKwhNegative: Math.min(0, calculatedTotal || totalKwh),
      columnTotals,
      columnMaxValues,
      readingsCount: readings.length,
      hasData: readings.length > 0,
      hasError: false,
      hierarchicalTotalKwh: isParent ? (calculatedTotal || totalKwh) : undefined,
      tariff_structure_id: meter.tariff_structure_id,
      assigned_tariff_name: meter.assigned_tariff_name
    });
  }

  // Build reconciliation data structure
  const reconciliationData = buildReconciliationData(meterResults);
  
  return reconciliationData;
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

  // Calculate totals
  const councilTotal = councilBulk.reduce((sum, m) => sum + (m.hierarchicalTotalKwh || m.totalKwh), 0);
  const bulkTotal = bulkMeters.reduce((sum, m) => sum + (m.hierarchicalTotalKwh || m.totalKwh), 0);
  const solarTotal = solarMeters.reduce((sum, m) => sum + Math.abs(m.hierarchicalTotalKwh || m.totalKwh), 0);
  const tenantTotal = tenantMeters.reduce((sum, m) => sum + (m.hierarchicalTotalKwh || m.totalKwh), 0);
  const checkTotal = checkMeters.reduce((sum, m) => sum + (m.hierarchicalTotalKwh || m.totalKwh), 0);

  const totalSupply = councilTotal + solarTotal;
  const distributionTotal = bulkTotal + tenantTotal + checkTotal;
  const discrepancy = totalSupply - distributionTotal;
  const recoveryRate = totalSupply !== 0 ? (distributionTotal / totalSupply) * 100 : 0;

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
    councilTotal,
    bulkTotal,
    solarTotal,
    tenantTotal,
    checkTotal,
    totalSupply,
    distributionTotal,
    discrepancy,
    recoveryRate,
    revenueEnabled: false
  };
}

// Save reconciliation run to database
async function saveReconciliationRun(
  supabase: any,
  siteId: string,
  runName: string,
  dateFrom: string,
  dateTo: string,
  reconciliationData: any,
  allMeters: any[],
  enableRevenue: boolean
) {
  // Insert reconciliation run
  const { data: run, error: runError } = await supabase
    .from('reconciliation_runs')
    .insert({
      site_id: siteId,
      run_name: runName,
      date_from: dateFrom,
      date_to: dateTo,
      bulk_total: reconciliationData.bulkTotal || 0,
      solar_total: reconciliationData.solarTotal || 0,
      tenant_total: reconciliationData.tenantTotal || 0,
      total_supply: reconciliationData.totalSupply || 0,
      recovery_rate: reconciliationData.recoveryRate || 0,
      discrepancy: reconciliationData.discrepancy || 0,
      revenue_enabled: enableRevenue
    })
    .select()
    .single();

  if (runError) {
    throw new Error(`Failed to save reconciliation run: ${runError.message}`);
  }

  // Save meter results
  const allMeterResults = [
    ...(reconciliationData.councilBulk || []),
    ...(reconciliationData.bulkMeters || []),
    ...(reconciliationData.solarMeters || []),
    ...(reconciliationData.checkMeters || []),
    ...(reconciliationData.tenantMeters || []),
    ...(reconciliationData.distributionMeters || []),
    ...(reconciliationData.otherMeters || []),
    ...(reconciliationData.unassignedMeters || [])
  ];

  // Remove duplicates by meter ID
  const uniqueMeters = new Map<string, any>();
  allMeterResults.forEach(m => {
    if (!uniqueMeters.has(m.id)) {
      uniqueMeters.set(m.id, m);
    }
  });

  const meterResultsToInsert = Array.from(uniqueMeters.values()).map((meter: any) => ({
    reconciliation_run_id: run.id,
    meter_id: meter.id,
    meter_number: meter.meter_number,
    meter_type: meter.meter_type,
    meter_name: meter.name,
    location: meter.location,
    assignment: meter.assignment,
    total_kwh: meter.hierarchicalTotalKwh || meter.totalKwh || 0,
    total_kwh_positive: meter.totalKwhPositive || 0,
    total_kwh_negative: meter.totalKwhNegative || 0,
    column_totals: meter.columnTotals || {},
    column_max_values: meter.columnMaxValues || {},
    readings_count: meter.readingsCount || 0,
    has_error: meter.hasError || false,
    error_message: meter.errorMessage,
    hierarchical_total: meter.hierarchicalTotalKwh,
    tariff_structure_id: meter.tariff_structure_id,
    tariff_name: meter.assigned_tariff_name,
    energy_cost: meter.energyCost || 0,
    fixed_charges: meter.fixedCharges || 0,
    demand_charges: meter.demandCharges || 0,
    total_cost: meter.totalCost || 0,
    avg_cost_per_kwh: meter.avgCostPerKwh || 0,
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

  console.log(`Saved reconciliation run ${run.id} with ${meterResultsToInsert.length} meter results`);
  return run.id;
}

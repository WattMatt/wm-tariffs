import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HierarchicalCSVRequest {
  parentMeterId: string;
  parentMeterNumber: string;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  childMeterIds: string[];
  columns: string[]; // Columns from site_reconciliation_settings (e.g., "P1 (kWh)", "P2 (kWh)", "S (kVA)")
}

interface AggregatedData {
  [column: string]: number;
}

// Helper to round timestamp to nearest 30-min slot
const roundToSlot = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    console.warn(`Invalid timestamp for rounding: ${timestamp}`);
    return timestamp;
  }
  const minutes = date.getMinutes();
  if (minutes < 15) {
    date.setMinutes(0);
  } else if (minutes < 45) {
    date.setMinutes(30);
  } else {
    date.setHours(date.getHours() + 1);
    date.setMinutes(0);
  }
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date.toISOString();
};

// Helper to sanitize names for storage paths
const sanitizeName = (name: string): string => {
  return name.trim().replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, ' ');
};

// Helper to generate content hash
const generateHash = async (content: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      parentMeterId,
      parentMeterNumber,
      siteId,
      dateFrom,
      dateTo,
      childMeterIds,
      columns: passedColumns
    } = await req.json() as HierarchicalCSVRequest;

    console.log('=== GENERATING HIERARCHICAL CSV FROM DATABASE ===');
    console.log('Parent meter:', parentMeterNumber, '(', parentMeterId, ')');
    console.log('Child meter IDs:', childMeterIds);
    console.log('Date range:', dateFrom, 'to', dateTo);
    console.log('Columns to aggregate:', passedColumns);

    if (!childMeterIds || childMeterIds.length === 0) {
      throw new Error('No child meter IDs provided');
    }

    // Get meter number mapping for logging
    const { data: meterInfo } = await supabase
      .from('meters')
      .select('id, meter_number')
      .in('id', childMeterIds);
    
    const meterNumberMap = new Map<string, string>();
    meterInfo?.forEach(m => meterNumberMap.set(m.id, m.meter_number));
    console.log('Child meters:', Array.from(meterNumberMap.entries()).map(([id, num]) => num).join(', '));

    // Fetch meter associations and column factors for sign inversion
    const { data: reconcSettings } = await supabase
      .from('site_reconciliation_settings')
      .select('meter_associations, column_factors')
      .eq('site_id', siteId)
      .maybeSingle();

    const solarMeterIds = new Set<string>();
    if (reconcSettings?.meter_associations) {
      const associations = reconcSettings.meter_associations as Record<string, string>;
      Object.entries(associations).forEach(([meterId, assignment]) => {
        if (assignment === 'solar_energy') {
          solarMeterIds.add(meterId);
          console.log(`Solar meter identified: ${meterNumberMap.get(meterId) || meterId}`);
        }
      });
    }
    console.log(`Found ${solarMeterIds.size} solar meters`);

    // Get column factors (default to 1 for any unspecified columns)
    const columnFactors = (reconcSettings?.column_factors as Record<string, number>) || {};
    console.log('Column factors:', columnFactors);

    // ===== STEP 1: Query meter_readings for ALL child meters within date range =====
    console.log('Fetching readings from meter_readings table...');
    
    const PAGE_SIZE = 1000;
    let allReadings: Array<{
      reading_timestamp: string;
      kwh_value: number;
      kva_value: number | null;
      metadata: Record<string, any> | null;
      meter_id: string;
    }> = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: pageData, error: readingsError } = await supabase
        .from('meter_readings')
        .select('reading_timestamp, kwh_value, kva_value, metadata, meter_id')
        .in('meter_id', childMeterIds)
        .gte('reading_timestamp', dateFrom)
        .lte('reading_timestamp', dateTo)
        .order('reading_timestamp', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (readingsError) {
        throw new Error(`Failed to fetch readings: ${readingsError.message}`);
      }

      if (pageData && pageData.length > 0) {
        allReadings = allReadings.concat(pageData);
        offset += pageData.length;
        hasMore = pageData.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    console.log(`Fetched ${allReadings.length} total readings from ${childMeterIds.length} child meters`);

    if (allReadings.length === 0) {
      console.warn('No readings found for child meters in date range');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No readings found for child meters in the specified date range',
          totalKwh: 0,
          columnTotals: {},
          columnMaxValues: {}
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== STEP 2: Aggregate readings by timestamp =====
    console.log('Aggregating readings by timestamp...');
    
    const columns = passedColumns || [];
    const groupedData = new Map<string, AggregatedData>();

    allReadings.forEach(reading => {
      const slot = roundToSlot(reading.reading_timestamp);
      
      if (!groupedData.has(slot)) {
        groupedData.set(slot, {});
      }
      
      const group = groupedData.get(slot)!;
      const isSolarMeter = solarMeterIds.has(reading.meter_id);

      // Aggregate imported_fields from metadata
      if (reading.metadata?.imported_fields) {
        const importedFields = reading.metadata.imported_fields as Record<string, any>;
        
        columns.forEach(col => {
          const value = importedFields[col];
          if (value !== null && value !== undefined) {
            const numValue = Number(value);
            if (!isNaN(numValue)) {
              // Get column factor (default to 1 if not specified)
              const columnFactor = columnFactors[col] ?? 1;
              // For solar meters, invert the factor; for normal meters, use as-is
              const multiplier = isSolarMeter ? -columnFactor : columnFactor;
              group[col] = (group[col] || 0) + (numValue * multiplier);
            }
          }
        });
      }
    });

    console.log(`Aggregated data into ${groupedData.size} time slots`);

    // ===== STEP 3: Generate CSV content =====
    console.log('Generating CSV content...');
    
    const csvRows: string[] = [];
    
    // Header row: Timestamp followed by columns
    const headerColumns = ['Timestamp', ...columns];
    csvRows.push(headerColumns.join(','));

    // Sort timestamps and create data rows
    const sortedTimestamps = Array.from(groupedData.keys()).sort((a, b) => a.localeCompare(b));
    
    sortedTimestamps.forEach(timestamp => {
      const data = groupedData.get(timestamp)!;
      const row = [
        timestamp,
        ...columns.map(col => (data[col] || 0).toFixed(4))
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    console.log(`Generated CSV with ${csvRows.length - 1} data rows and ${columns.length} columns`);

    // Calculate summary statistics
    const columnTotals: Record<string, number> = {};
    const columnMaxValues: Record<string, number> = {};
    
    columns.forEach(col => {
      const colLower = col.toLowerCase();
      const isKvaColumn = colLower.includes('kva') || colLower === 's';
      
      if (isKvaColumn) {
        // For kVA columns, track max value
        const values = Array.from(groupedData.values()).map(d => d[col] || 0);
        columnMaxValues[col] = values.length > 0 ? Math.max(...values) : 0;
      } else {
        // For kWh columns, track sum
        columnTotals[col] = Array.from(groupedData.values())
          .reduce((sum, d) => sum + (d[col] || 0), 0);
      }
    });

    // Calculate total kWh from kWh-related columns
    const kwhColumns = columns.filter(c => 
      c.toLowerCase().includes('kwh') || /^P\d+/.test(c)
    );
    const totalKwh = kwhColumns.reduce((sum, col) => sum + (columnTotals[col] || 0), 0);

    console.log('Total kWh:', totalKwh);
    console.log('Column totals:', columnTotals);
    console.log('Column max values:', columnMaxValues);

    // ===== STEP 4: Upload CSV to storage =====
    console.log('Uploading CSV to storage...');
    
    // Get site and client info for storage path
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .select('name, clients(name)')
      .eq('id', siteId)
      .single();

    if (siteError || !siteData) {
      throw new Error(`Failed to fetch site data: ${siteError?.message || 'Site not found'}`);
    }

    const clientName = sanitizeName((siteData.clients as any).name);
    const siteName = sanitizeName(siteData.name);
    const sanitizedMeterNumber = sanitizeName(parentMeterNumber);

    const fileName = `${sanitizedMeterNumber}_Hierarchical_Energy_Profile.csv`;
    const filePath = `${clientName}/${siteName}/Metering/Reconciliations/${fileName}`;

    // Upload CSV to storage (upsert)
    const csvBlob = new Blob([csvContent], { type: 'text/csv' });
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(filePath, csvBlob, { 
        upsert: true,
        contentType: 'text/csv'
      });

    if (uploadError) {
      throw new Error(`Failed to upload CSV: ${uploadError.message}`);
    }

    console.log(`CSV uploaded to: ${filePath}`);

    // ===== STEP 5: Delete existing HIERARCHICAL readings for parent meter in date range =====
    // IMPORTANT: Only delete readings with source='hierarchical_aggregation' to preserve uploaded CSV data
    console.log('Deleting existing HIERARCHICAL readings for parent meter in date range...');
    
    const { error: deleteError } = await supabase
      .from('meter_readings')
      .delete()
      .eq('meter_id', parentMeterId)
      .gte('reading_timestamp', dateFrom)
      .lte('reading_timestamp', dateTo)
      .eq('metadata->>source', 'hierarchical_aggregation');

    if (deleteError) {
      console.warn(`Failed to delete existing hierarchical readings: ${deleteError.message}`);
    } else {
      console.log(`Deleted existing hierarchical readings for parent meter (preserved uploaded CSV data)`);
    }

    // ===== STEP 6: Insert aggregated data directly into meter_readings =====
    console.log('Inserting aggregated data into meter_readings...');
    
    const readingsToInsert = sortedTimestamps.map(timestamp => {
      const data = groupedData.get(timestamp)!;
      
      // Calculate kwh_value from kWh columns (sum of P1, P2, etc.)
      const kwhValue = kwhColumns.reduce((sum, col) => sum + (data[col] || 0), 0);
      
      // Get kVA value from kVA columns (take max)
      const kvaColumns = columns.filter(c => 
        c.toLowerCase().includes('kva') || c.toLowerCase() === 's'
      );
      const kvaValue = kvaColumns.length > 0 
        ? Math.max(...kvaColumns.map(col => data[col] || 0))
        : null;
      
      return {
        meter_id: parentMeterId,
        reading_timestamp: timestamp,
        kwh_value: kwhValue,
        kva_value: kvaValue,
        metadata: {
          source: 'hierarchical_aggregation',
          source_file: fileName,
          imported_at: new Date().toISOString(),
          child_meter_count: childMeterIds.length,
          imported_fields: data // Store all column values
        }
      };
    });

    // Batch insert in chunks of 500
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    let insertErrors = 0;

    for (let i = 0; i < readingsToInsert.length; i += BATCH_SIZE) {
      const batch = readingsToInsert.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('meter_readings')
        .insert(batch);

      if (insertError) {
        console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, insertError.message);
        insertErrors++;
      } else {
        totalInserted += batch.length;
      }
    }

    console.log(`Inserted ${totalInserted} readings for parent meter`);

    // ===== STEP 7: Create/Update meter_csv_files record =====
    console.log('Creating/updating meter_csv_files record...');
    
    const contentHash = await generateHash(csvContent);

    // Build column mapping for the generated CSV
    const columnMapping: Record<string, any> = {
      dateColumn: '0',
      timeColumn: '-1',
      valueColumn: '1',
      kvaColumn: '-1',
      dateTimeFormat: 'YYYY-MM-DDTHH:mm:ss.sssZ',
      renamedHeaders: {} as Record<number, string>,
      columnDataTypes: {} as Record<string, string>
    };

    columns.forEach((col, idx) => {
      const colIdx = idx + 1;
      columnMapping.renamedHeaders[colIdx] = col;
      columnMapping.columnDataTypes[colIdx.toString()] = 'float';
      
      const colLower = col.toLowerCase();
      if ((colLower.includes('kva') || colLower === 's') && columnMapping.kvaColumn === '-1') {
        columnMapping.kvaColumn = colIdx.toString();
      }
    });

    // Check if record already exists for this meter
    const { data: existingRecord } = await supabase
      .from('meter_csv_files')
      .select('id')
      .eq('meter_id', parentMeterId)
      .eq('file_name', fileName)
      .maybeSingle();

    let csvFileId: string;

    if (existingRecord) {
      const { data: updatedRecord, error: updateError } = await supabase
        .from('meter_csv_files')
        .update({
          file_path: filePath,
          content_hash: contentHash,
          file_size: csvContent.length,
          upload_status: 'uploaded',
          parse_status: 'generated',
          parsed_at: new Date().toISOString(),
          separator: ',',
          header_row_number: 1,
          column_mapping: columnMapping,
          updated_at: new Date().toISOString(),
          error_message: insertErrors > 0 ? `${insertErrors} batch insert errors` : null,
          readings_inserted: totalInserted,
          duplicates_skipped: 0,
          parse_errors: insertErrors
        })
        .eq('id', existingRecord.id)
        .select('id')
        .single();

      if (updateError) {
        throw new Error(`Failed to update meter_csv_files: ${updateError.message}`);
      }
      
      csvFileId = updatedRecord.id;
      console.log(`Updated existing meter_csv_files record: ${csvFileId}`);
    } else {
      const { data: newRecord, error: insertError } = await supabase
        .from('meter_csv_files')
        .insert({
          site_id: siteId,
          meter_id: parentMeterId,
          file_name: fileName,
          file_path: filePath,
          content_hash: contentHash,
          file_size: csvContent.length,
          upload_status: 'uploaded',
          parse_status: 'generated',
          parsed_at: new Date().toISOString(),
          separator: ',',
          header_row_number: 1,
          column_mapping: columnMapping,
          readings_inserted: totalInserted,
          duplicates_skipped: 0,
          parse_errors: insertErrors
        })
        .select('id')
        .single();

      if (insertError) {
        throw new Error(`Failed to insert meter_csv_files: ${insertError.message}`);
      }
      
      csvFileId = newRecord.id;
      console.log(`Created new meter_csv_files record: ${csvFileId}`);
    }

    console.log('=== HIERARCHICAL CSV GENERATION COMPLETE ===');

    return new Response(
      JSON.stringify({
        success: true,
        filePath,
        fileName,
        csvFileId,
        totalKwh,
        columnTotals,
        columnMaxValues,
        rowCount: sortedTimestamps.length,
        readingsInserted: totalInserted,
        insertErrors
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating hierarchical CSV:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

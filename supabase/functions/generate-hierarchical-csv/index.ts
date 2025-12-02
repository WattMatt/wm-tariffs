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
  const mins = date.getMinutes();
  if (mins < 15) {
    date.setMinutes(0);
  } else if (mins < 45) {
    date.setMinutes(30);
  } else {
    date.setHours(date.getHours() + 1);
    date.setMinutes(0);
  }
  date.setSeconds(0);
  date.setMilliseconds(0);
  // Format as YYYY-MM-DD HH:MM:SS to match uploaded CSV format
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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

    // ===== STEP 0: Prepare hierarchical_meter_readings table =====
    // IMPORTANT: Only delete the parent meter's aggregated readings.
    // Child "Copied" readings are preserved and upserted (not deleted).
    // This prevents data loss when running hierarchy generation multiple times.
    console.log('STEP 0: Preparing hierarchical_meter_readings table...');
    
    // Delete ONLY the current parent meter's readings (to replace with new aggregation)
    const { error: deleteParentError } = await supabase
      .from('hierarchical_meter_readings')
      .delete()
      .eq('meter_id', parentMeterId)
      .gte('reading_timestamp', dateFrom)
      .lte('reading_timestamp', dateTo);
    
    if (deleteParentError) {
      console.warn(`Failed to clear parent readings: ${deleteParentError.message}`);
    } else {
      console.log(`Cleared existing readings for parent meter ${parentMeterNumber}`);
    }

    // ===== STEP 1: Query meter_readings for ALL child meters within date range =====
    console.log('STEP 1: Fetching readings from meter_readings table...');
    
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
        .or('metadata->>source.eq.Parsed,metadata->>source.is.null')
        .not('metadata->>source_file', 'ilike', '%Hierarchical%')
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

    // ===== STEP 1.5: Copy child readings to hierarchical_meter_readings =====
    console.log('STEP 1.5: Copying child readings to hierarchical_meter_readings...');
    
    const COPY_BATCH_SIZE = 1000;
    let copiedCount = 0;

    for (let i = 0; i < allReadings.length; i += COPY_BATCH_SIZE) {
      const batch = allReadings.slice(i, i + COPY_BATCH_SIZE).map(reading => ({
        meter_id: reading.meter_id,
        reading_timestamp: reading.reading_timestamp,
        kwh_value: reading.kwh_value,
        kva_value: reading.kva_value,
        metadata: {
          ...reading.metadata,
          source: 'Copied',
          copied_from: 'meter_readings',
          copied_at: new Date().toISOString()
        }
      }));
      
      // Use upsert to preserve existing copied data and only update if changed
      const { error: insertError } = await supabase
        .from('hierarchical_meter_readings')
        .upsert(batch, {
          onConflict: 'meter_id,reading_timestamp',
          ignoreDuplicates: false
        });

      if (insertError) {
        console.error(`Failed to copy readings batch ${i}: ${insertError.message}`);
        // Continue with next batch instead of throwing
      } else {
        copiedCount += batch.length;
      }
    }

    console.log(`Copied ${copiedCount} child readings to hierarchical_meter_readings`);

    // ===== STEP 2: Aggregate readings by timestamp =====
    console.log('STEP 2: Aggregating readings by timestamp...');
    
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

    console.log(`Aggregated new data into ${groupedData.size} time slots`);

    // ===== STEP 2.5: Fetch existing CSV and merge with new data =====
    console.log('STEP 2.5: Checking for existing hierarchical CSV to merge...');
    
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

    // Try to fetch existing CSV
    const { data: existingCsvRecord } = await supabase
      .from('meter_csv_files')
      .select('file_path')
      .eq('meter_id', parentMeterId)
      .eq('file_name', fileName)
      .maybeSingle();

    if (existingCsvRecord?.file_path) {
      console.log('Found existing hierarchical CSV, downloading and merging...');
      
      const { data: existingFile } = await supabase.storage
        .from('client-files')
        .download(existingCsvRecord.file_path);
      
      if (existingFile) {
        try {
          const existingContent = await existingFile.text();
          const existingLines = existingContent.split('\n');
          
          // Skip header rows (first 2 rows: meter identifier and column headers)
          for (let i = 2; i < existingLines.length; i++) {
            const row = existingLines[i].trim();
            if (!row) continue;
            
            const values = row.split(',');
            const timestamp = values[0];
            
            // Only add if not already in new data (new data takes precedence)
            if (timestamp && !groupedData.has(timestamp)) {
              const data: AggregatedData = {};
              columns.forEach((col, idx) => {
                const value = parseFloat(values[idx + 1]) || 0;
                data[col] = value;
              });
              groupedData.set(timestamp, data);
            }
          }
          
          console.log(`Merged with existing data. Total time slots: ${groupedData.size}`);
        } catch (mergeError) {
          console.warn('Failed to parse existing CSV for merge:', mergeError);
        }
      }
    }

    // ===== STEP 3: Generate CSV content =====
    console.log('STEP 3: Generating CSV content...');
    
    const csvRows: string[] = [];
    
    // Row 1: Meter identifier row - exactly "pnpscada.com,Virtual" with no additional empty cells
    csvRows.push('pnpscada.com,Virtual');
    
    // Row 2: Column headers with 'Time' (not 'Timestamp') to match uploaded CSV format
    const headerColumns = ['Time', ...columns];
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
    console.log(`Generated CSV with ${csvRows.length - 2} data rows and ${columns.length} columns`);

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
    console.log('STEP 4: Uploading CSV to storage...');

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

    // ===== STEP 5: Create/Update meter_csv_files record =====
    console.log('STEP 5: Creating/updating meter_csv_files record...');
    
    const contentHash = await generateHash(csvContent);

    // Build column mapping for the generated CSV
    const columnMapping: Record<string, any> = {
      dateColumn: '0',
      timeColumn: '-1',
      valueColumn: '1',
      kvaColumn: '-1',
      dateTimeFormat: 'YYYY-MM-DD HH:mm:ss',
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
          parse_status: 'pending',
          parsed_at: null,
          separator: ',',
          header_row_number: 2,  // Headers are now on row 2 (row 1 is meter identifier)
          column_mapping: columnMapping,
          updated_at: new Date().toISOString(),
          error_message: null,
          readings_inserted: 0,
          duplicates_skipped: 0,
          parse_errors: 0,
          generated_date_from: dateFrom,
          generated_date_to: dateTo,
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
          parse_status: 'pending',
          parsed_at: null,
          separator: ',',
          header_row_number: 2,  // Headers are now on row 2 (row 1 is meter identifier)
          column_mapping: columnMapping,
          readings_inserted: 0,
          duplicates_skipped: 0,
          parse_errors: 0,
          generated_date_from: dateFrom,
          generated_date_to: dateTo,
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
        requiresParsing: true,
        columnMapping,
        copiedChildReadings: copiedCount
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

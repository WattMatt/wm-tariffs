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

    // ===== IDENTIFY LEAF VS PARENT CHILD METERS =====
    // Check which child meters have their own children (are parent meters in the hierarchy)
    const { data: childrenOfChildren } = await supabase
      .from('meter_connections')
      .select('parent_meter_id')
      .in('parent_meter_id', childMeterIds);

    const parentChildMeterIds = new Set<string>(
      childrenOfChildren?.map(c => c.parent_meter_id) || []
    );
    const leafChildMeterIds = childMeterIds.filter(id => !parentChildMeterIds.has(id));

    console.log(`Child meters breakdown: ${leafChildMeterIds.length} leaf, ${parentChildMeterIds.size} parent`);
    console.log('Leaf meters:', leafChildMeterIds.map(id => meterNumberMap.get(id) || id).join(', '));
    console.log('Parent meters (already have aggregated data):', Array.from(parentChildMeterIds).map(id => meterNumberMap.get(id) || id).join(', '));

    // NOTE: Column factors are NOT applied during hierarchical CSV generation
    // They are applied during reconciliation in the frontend for BOTH regular and hierarchical data
    console.log('NOTE: Column factors will be applied during reconciliation, not during CSV generation');

    // ===== STEP 0: Prepare hierarchical_meter_readings table =====
    // Delete ONLY the current parent meter's AGGREGATED readings (source='hierarchical_aggregation')
    // This prevents accidentally deleting leaf meter Copied data
    console.log('STEP 0: Preparing hierarchical_meter_readings table...');
    
    const { data: deletedData, error: deleteParentError } = await supabase
      .from('hierarchical_meter_readings')
      .delete()
      .eq('meter_id', parentMeterId)
      .gte('reading_timestamp', dateFrom)
      .lte('reading_timestamp', dateTo)
      .select('id');
    
    if (deleteParentError) {
      console.warn(`Failed to clear parent readings: ${deleteParentError.message}`);
    } else {
      console.log(`Cleared ${deletedData?.length || 0} existing readings for parent meter ${parentMeterNumber}`);
    }

    // ===== STEP 1: COPY LEAF METER READINGS FIRST =====
    // This MUST happen before fetching for aggregation so that leaf data exists in hierarchical_meter_readings
    console.log('STEP 1: Copying LEAF meter readings from meter_readings to hierarchical_meter_readings...');
    
    const PAGE_SIZE = 1000;
    const COPY_BATCH_SIZE = 1000;
    let copiedCount = 0;
    const leafReadingCountsByMeter = new Map<string, number>();

    if (leafChildMeterIds.length > 0) {
      // First, count readings per leaf meter in meter_readings for validation
      for (const leafMeterId of leafChildMeterIds) {
        const { count, error: countError } = await supabase
          .from('meter_readings')
          .select('*', { count: 'exact', head: true })
          .eq('meter_id', leafMeterId)
          .gte('reading_timestamp', dateFrom)
          .lte('reading_timestamp', dateTo)
          .or('metadata->>source.eq.Parsed,metadata->>source.is.null')
          .not('metadata->>source_file', 'ilike', '%Hierarchical%');
        
        if (countError) {
          console.warn(`Failed to count readings for ${meterNumberMap.get(leafMeterId)}: ${countError.message}`);
        } else {
          leafReadingCountsByMeter.set(leafMeterId, count || 0);
          console.log(`Leaf meter ${meterNumberMap.get(leafMeterId)}: ${count || 0} readings in meter_readings`);
        }
      }

      // Fetch leaf meter readings from meter_readings
      let offset = 0;
      let hasMore = true;
      let leafReadingsFromSource: Array<{
        reading_timestamp: string;
        kwh_value: number;
        kva_value: number | null;
        metadata: Record<string, any> | null;
        meter_id: string;
      }> = [];

      while (hasMore) {
        const { data: pageData, error: readingsError } = await supabase
          .from('meter_readings')
          .select('reading_timestamp, kwh_value, kva_value, metadata, meter_id')
          .in('meter_id', leafChildMeterIds)
          .gte('reading_timestamp', dateFrom)
          .lte('reading_timestamp', dateTo)
          .or('metadata->>source.eq.Parsed,metadata->>source.is.null')
          .not('metadata->>source_file', 'ilike', '%Hierarchical%')
          .order('reading_timestamp', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (readingsError) {
          throw new Error(`Failed to fetch leaf readings from meter_readings: ${readingsError.message}`);
        }

        if (pageData && pageData.length > 0) {
          leafReadingsFromSource = leafReadingsFromSource.concat(pageData);
          offset += pageData.length;
          hasMore = pageData.length === PAGE_SIZE;
          console.log(`Fetched page: ${offset} readings so far...`);
        } else {
          hasMore = false;
        }
      }

      console.log(`Fetched total ${leafReadingsFromSource.length} leaf meter readings from meter_readings`);
      
      // Log breakdown by meter
      const fetchedByMeter = new Map<string, number>();
      leafReadingsFromSource.forEach(r => {
        fetchedByMeter.set(r.meter_id, (fetchedByMeter.get(r.meter_id) || 0) + 1);
      });
      fetchedByMeter.forEach((count, meterId) => {
        console.log(`  ${meterNumberMap.get(meterId)}: ${count} readings fetched`);
      });

      // Copy to hierarchical_meter_readings using upsert
      let copyErrors = 0;
      for (let i = 0; i < leafReadingsFromSource.length; i += COPY_BATCH_SIZE) {
        const batch = leafReadingsFromSource.slice(i, i + COPY_BATCH_SIZE).map(reading => ({
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
        
        const { error: insertError } = await supabase
          .from('hierarchical_meter_readings')
          .upsert(batch, {
            onConflict: 'meter_id,reading_timestamp',
            ignoreDuplicates: false
          });

        if (insertError) {
          console.error(`Failed to copy readings batch ${Math.floor(i / COPY_BATCH_SIZE) + 1}: ${insertError.message}`);
          copyErrors++;
        } else {
          copiedCount += batch.length;
          console.log(`Copied batch ${Math.floor(i / COPY_BATCH_SIZE) + 1}: ${copiedCount}/${leafReadingsFromSource.length}`);
        }
      }

      console.log(`Copied ${copiedCount} leaf meter readings to hierarchical_meter_readings (${copyErrors} batch errors)`);
      
      // ===== VALIDATION: Verify leaf meter readings were actually copied =====
      console.log('STEP 1.5: VALIDATING leaf meter readings in hierarchical_meter_readings...');
      
      const validationErrors: string[] = [];
      const copiedCountsByMeter = new Map<string, number>();
      
      for (const leafMeterId of leafChildMeterIds) {
        const { count, error: valError } = await supabase
          .from('hierarchical_meter_readings')
          .select('*', { count: 'exact', head: true })
          .eq('meter_id', leafMeterId)
          .gte('reading_timestamp', dateFrom)
          .lte('reading_timestamp', dateTo);
        
        if (valError) {
          console.error(`Validation query failed for ${meterNumberMap.get(leafMeterId)}: ${valError.message}`);
          validationErrors.push(`Query failed for ${meterNumberMap.get(leafMeterId)}`);
        } else {
          copiedCountsByMeter.set(leafMeterId, count || 0);
          const sourceCount = leafReadingCountsByMeter.get(leafMeterId) || 0;
          const meterNum = meterNumberMap.get(leafMeterId) || leafMeterId;
          
          if (count === 0 && sourceCount > 0) {
            console.error(`VALIDATION FAILED: ${meterNum} has ${sourceCount} readings in meter_readings but 0 in hierarchical_meter_readings!`);
            validationErrors.push(`${meterNum}: Expected ${sourceCount} readings, got 0`);
          } else if (count !== sourceCount) {
            console.warn(`VALIDATION WARNING: ${meterNum} has ${sourceCount} in meter_readings but ${count} in hierarchical_meter_readings`);
          } else {
            console.log(`VALIDATED: ${meterNum} has ${count} readings in hierarchical_meter_readings`);
          }
        }
      }
      
      if (validationErrors.length > 0) {
        const errorMsg = `Leaf meter copy validation failed:\n${validationErrors.join('\n')}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log('VALIDATION PASSED: All leaf meter readings successfully copied');
      
    } else {
      console.log('No leaf meters to copy - all children are parent meters');
    }

    // ===== STEP 2: FETCH ALL CHILD DATA FROM hierarchical_meter_readings ONLY =====
    // Now that leaf data is copied, fetch ALL child meters from the SAME table
    console.log('STEP 2: Fetching ALL child meter data from hierarchical_meter_readings...');
    
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
      // Fetch ALL child meters from hierarchical_meter_readings
      // This includes:
      // - Leaf meters with source='Copied' (just copied above)
      // - Parent meters with source='hierarchical_aggregation' (from their own hierarchy generation)
      const { data: pageData, error: fetchError } = await supabase
        .from('hierarchical_meter_readings')
        .select('reading_timestamp, kwh_value, kva_value, metadata, meter_id')
        .in('meter_id', childMeterIds) // ALL children - both leaf and parent
        .gte('reading_timestamp', dateFrom)
        .lte('reading_timestamp', dateTo)
        .order('reading_timestamp', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (fetchError) {
        throw new Error(`Failed to fetch from hierarchical_meter_readings: ${fetchError.message}`);
      }

      if (pageData && pageData.length > 0) {
        allReadings = allReadings.concat(pageData);
        offset += pageData.length;
        hasMore = pageData.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    // Log breakdown by source and meter
    const copiedCount2 = allReadings.filter(r => r.metadata?.source === 'Copied').length;
    const aggregatedCount = allReadings.filter(r => r.metadata?.source === 'hierarchical_aggregation').length;
    console.log(`Fetched ${allReadings.length} total readings from hierarchical_meter_readings`);
    console.log(`  - ${copiedCount2} from Copied (leaf meters)`);
    console.log(`  - ${aggregatedCount} from hierarchical_aggregation (parent meters)`);
    
    // Log per-meter breakdown
    const readingsByMeter = new Map<string, number>();
    allReadings.forEach(r => {
      readingsByMeter.set(r.meter_id, (readingsByMeter.get(r.meter_id) || 0) + 1);
    });
    console.log('Readings by meter:');
    childMeterIds.forEach(id => {
      const count = readingsByMeter.get(id) || 0;
      const meterNum = meterNumberMap.get(id) || id;
      const isLeaf = leafChildMeterIds.includes(id);
      console.log(`  ${meterNum} (${isLeaf ? 'leaf' : 'parent'}): ${count} readings`);
    });

    if (allReadings.length === 0) {
      console.error('CRITICAL: No readings found in hierarchical_meter_readings for child meters');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No readings found for child meters in hierarchical_meter_readings. Leaf meter copy may have failed.',
          totalKwh: 0,
          columnTotals: {},
          columnMaxValues: {}
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Additional validation: ensure we have readings from ALL child meters
    const missingMeters = childMeterIds.filter(id => !readingsByMeter.has(id) || readingsByMeter.get(id) === 0);
    if (missingMeters.length > 0) {
      const missingNames = missingMeters.map(id => meterNumberMap.get(id) || id);
      console.error(`WARNING: Missing readings for ${missingMeters.length} child meters: ${missingNames.join(', ')}`);
    }

    // ===== STEP 3: Aggregate readings by timestamp =====
    console.log('STEP 3: Aggregating readings by timestamp...');
    
    const columns = passedColumns || [];
    const groupedData = new Map<string, AggregatedData>();

    allReadings.forEach(reading => {
      const slot = roundToSlot(reading.reading_timestamp);
      
      if (!groupedData.has(slot)) {
        groupedData.set(slot, {});
      }
      
      const group = groupedData.get(slot)!;

      // Aggregate imported_fields from metadata
      // PURE SUMMING - NO COLUMN FACTORS
      // Column factors are applied during reconciliation in the frontend, not here
      if (reading.metadata?.imported_fields) {
        const importedFields = reading.metadata.imported_fields as Record<string, any>;
        
        columns.forEach(col => {
          const value = importedFields[col];
          if (value !== null && value !== undefined) {
            const numValue = Number(value);
            if (!isNaN(numValue)) {
              // Simple raw sum - no factors applied
              group[col] = (group[col] || 0) + numValue;
            }
          }
        });
      }
    });

    console.log(`Aggregated data into ${groupedData.size} time slots`);

    // ===== STEP 3.5: Fetch existing CSV and merge with new data =====
    console.log('STEP 3.5: Checking for existing hierarchical CSV to merge...');
    
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

    // ===== STEP 4: Generate CSV content =====
    console.log('STEP 4: Generating CSV content...');
    
    const csvRows: string[] = [];
    
    // Row 1: Meter identifier row
    csvRows.push('pnpscada.com,Virtual');
    
    // Row 2: Column headers
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

    // ===== STEP 5: Upload CSV to storage =====
    console.log('STEP 5: Uploading CSV to storage...');

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

    // ===== STEP 6: Create/update meter_csv_files record =====
    console.log('STEP 6: Creating/updating meter_csv_files record...');

    const contentHash = await generateHash(csvContent);
    const dateRange = sortedTimestamps.length > 0 ? {
      from: sortedTimestamps[0],
      to: sortedTimestamps[sortedTimestamps.length - 1]
    } : { from: dateFrom, to: dateTo };

    // Check if record exists
    const { data: existingRecord } = await supabase
      .from('meter_csv_files')
      .select('id')
      .eq('meter_id', parentMeterId)
      .eq('file_name', fileName)
      .maybeSingle();

    const csvRecord = {
      site_id: siteId,
      meter_id: parentMeterId,
      file_name: fileName,
      file_path: filePath,
      content_hash: contentHash,
      file_size: csvContent.length,
      upload_status: 'uploaded',
      parse_status: 'generated',
      readings_inserted: csvRows.length - 2,
      generated_date_from: dateRange.from,
      generated_date_to: dateRange.to,
      header_row_number: 2,
      separator: ',',
      column_mapping: {
        dateColumn: '0',
        timeColumn: '-1',
        valueColumn: '1',
        kvaColumn: columns.findIndex(c => c.toLowerCase().includes('kva') || c.toLowerCase().includes('s (kva')).toString(),
        dateTimeFormat: 'YYYY-MM-DD HH:mm:ss',
        renamedHeaders: Object.fromEntries(columns.map((col, idx) => [(idx + 1).toString(), col])),
        columnDataTypes: Object.fromEntries(columns.map((_, idx) => [(idx + 1).toString(), 'float']))
      },
      updated_at: new Date().toISOString()
    };

    if (existingRecord) {
      const { error: updateError } = await supabase
        .from('meter_csv_files')
        .update(csvRecord)
        .eq('id', existingRecord.id);

      if (updateError) {
        console.error(`Failed to update meter_csv_files: ${updateError.message}`);
      } else {
        console.log(`Updated existing meter_csv_files record: ${existingRecord.id}`);
      }
    } else {
      const { data: newRecord, error: insertError } = await supabase
        .from('meter_csv_files')
        .insert(csvRecord)
        .select('id')
        .single();

      if (insertError) {
        console.error(`Failed to insert meter_csv_files: ${insertError.message}`);
      } else {
        console.log(`Created new meter_csv_files record: ${newRecord.id}`);
      }
    }

    // ===== STEP 7: Insert parent meter's aggregated readings =====
    console.log('STEP 7: Inserting aggregated readings for parent meter...');

    const parentReadings = sortedTimestamps.map(timestamp => {
      const data = groupedData.get(timestamp)!;
      
      // Calculate kwh_value from actual aggregated P1 + P2 columns for THIS timestamp
      const p1Value = data['P1 (kWh)'] || data['P1'] || 0;
      const p2Value = data['P2 (kWh)'] || data['P2'] || 0;
      const timestampKwh = p1Value + p2Value;
      
      // Get kva_value from aggregated S (kVA) column
      const kvaValue = data['S (kVA)'] || data['S'] || null;
      
      return {
        meter_id: parentMeterId,
        reading_timestamp: timestamp,
        kwh_value: timestampKwh,
        kva_value: kvaValue,
        metadata: {
          source: 'hierarchical_aggregation',
          generated_at: new Date().toISOString(),
          child_meters: childMeterIds.map(id => meterNumberMap.get(id) || id),
          imported_fields: data
        }
      };
    });

    // Insert in batches
    const INSERT_BATCH_SIZE = 1000;
    let insertedCount = 0;

    for (let i = 0; i < parentReadings.length; i += INSERT_BATCH_SIZE) {
      const batch = parentReadings.slice(i, i + INSERT_BATCH_SIZE);
      
      const { error: insertError } = await supabase
        .from('hierarchical_meter_readings')
        .upsert(batch, {
          onConflict: 'meter_id,reading_timestamp',
          ignoreDuplicates: false
        });

      if (insertError) {
        console.error(`Failed to insert parent readings batch: ${insertError.message}`);
      } else {
        insertedCount += batch.length;
        console.log(`Inserted batch: ${insertedCount}/${parentReadings.length} into hierarchical_meter_readings`);
      }
    }

    console.log('=== HIERARCHICAL CSV GENERATION COMPLETE ===');

    return new Response(
      JSON.stringify({
        success: true,
        filePath,
        fileName,
        totalKwh,
        columnTotals,
        columnMaxValues,
        rowCount: csvRows.length - 2,
        dateRange
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error generating hierarchical CSV:', errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

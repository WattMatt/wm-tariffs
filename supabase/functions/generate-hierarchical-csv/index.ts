import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HierarchicalCSVRequest {
  parentMeterId?: string;
  parentMeterNumber?: string;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  childMeterIds?: string[];
  columns?: string[];
  copyLeafMetersOnly?: boolean; // NEW: Mode to copy all leaf meters upfront
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

    const requestBody = await req.json() as HierarchicalCSVRequest;
    const {
      parentMeterId,
      parentMeterNumber,
      siteId,
      dateFrom,
      dateTo,
      childMeterIds,
      columns: passedColumns,
      copyLeafMetersOnly
    } = requestBody;

    // ===== MODE 1: COPY ALL LEAF METERS FOR SITE =====
    if (copyLeafMetersOnly) {
      console.log('=== COPY LEAF METERS ONLY MODE ===');
      console.log('Site ID:', siteId);
      console.log('Date range:', dateFrom, 'to', dateTo);

      // Step 1: Get ALL meters for this site
      const { data: allMeters, error: metersError } = await supabase
        .from('meters')
        .select('id, meter_number')
        .eq('site_id', siteId);

      if (metersError) {
        throw new Error(`Failed to fetch meters: ${metersError.message}`);
      }

      const meterIds = allMeters?.map(m => m.id) || [];
      const meterNumberMap = new Map<string, string>();
      allMeters?.forEach(m => meterNumberMap.set(m.id, m.meter_number));
      
      console.log(`Found ${meterIds.length} meters in site`);

      // Step 2: Get all meter connections to identify which meters are parents
      const { data: connections } = await supabase
        .from('meter_connections')
        .select('parent_meter_id, child_meter_id')
        .in('parent_meter_id', meterIds);

      const parentMeterIds = new Set<string>(connections?.map(c => c.parent_meter_id) || []);
      
      // Leaf meters = meters that have NO children (are NOT parents)
      const leafMeterIds = meterIds.filter(id => !parentMeterIds.has(id));
      
      console.log(`Identified ${leafMeterIds.length} leaf meters (no children):`);
      leafMeterIds.forEach(id => console.log(`  - ${meterNumberMap.get(id)}`));
      console.log(`Skipping ${parentMeterIds.size} parent meters`);

      if (leafMeterIds.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            mode: 'copyLeafMetersOnly',
            leafMetersCopied: 0,
            totalReadingsCopied: 0,
            message: 'No leaf meters found'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Step 3: Fetch all leaf meter readings from meter_readings
      const PAGE_SIZE = 1000;
      let allLeafReadings: Array<{
        reading_timestamp: string;
        kwh_value: number;
        kva_value: number | null;
        metadata: Record<string, any> | null;
        meter_id: string;
      }> = [];

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        // Fetch ALL readings for leaf meters - no source filter restriction
        // Only exclude Hierarchical source_files to prevent recursion
        const { data: pageData, error: readingsError } = await supabase
          .from('meter_readings')
          .select('reading_timestamp, kwh_value, kva_value, metadata, meter_id')
          .in('meter_id', leafMeterIds)
          .gte('reading_timestamp', dateFrom)
          .lte('reading_timestamp', dateTo)
          .order('reading_timestamp', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (readingsError) {
          throw new Error(`Failed to fetch leaf readings: ${readingsError.message}`);
        }

        if (pageData && pageData.length > 0) {
          allLeafReadings = allLeafReadings.concat(pageData);
          offset += pageData.length;
          hasMore = pageData.length === PAGE_SIZE;
          console.log(`Fetched ${offset} readings so far...`);
        } else {
          hasMore = false;
        }
      }

      console.log(`Total leaf meter readings fetched: ${allLeafReadings.length}`);
      
      // Log breakdown by meter
      const readingsByMeter = new Map<string, number>();
      allLeafReadings.forEach(r => {
        readingsByMeter.set(r.meter_id, (readingsByMeter.get(r.meter_id) || 0) + 1);
      });
      console.log('Readings per leaf meter:');
      leafMeterIds.forEach(id => {
        console.log(`  ${meterNumberMap.get(id)}: ${readingsByMeter.get(id) || 0} readings`);
      });

      // Step 4: Copy to hierarchical_meter_readings using upsert
      const COPY_BATCH_SIZE = 1000;
      let copiedCount = 0;
      let copyErrors = 0;

      for (let i = 0; i < allLeafReadings.length; i += COPY_BATCH_SIZE) {
        const batch = allLeafReadings.slice(i, i + COPY_BATCH_SIZE).map(reading => ({
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
          console.error(`Failed to copy batch ${Math.floor(i / COPY_BATCH_SIZE) + 1}: ${insertError.message}`);
          copyErrors++;
        } else {
          copiedCount += batch.length;
          console.log(`Copied batch: ${copiedCount}/${allLeafReadings.length}`);
        }
      }

      // Step 5: Validate the copy
      console.log('Validating copy...');
      const validationResults: { meter: string; expected: number; actual: number }[] = [];
      
      for (const leafMeterId of leafMeterIds) {
        const { count } = await supabase
          .from('hierarchical_meter_readings')
          .select('*', { count: 'exact', head: true })
          .eq('meter_id', leafMeterId)
          .gte('reading_timestamp', dateFrom)
          .lte('reading_timestamp', dateTo);
        
        const expected = readingsByMeter.get(leafMeterId) || 0;
        const actual = count || 0;
        const meterNum = meterNumberMap.get(leafMeterId) || leafMeterId;
        
        validationResults.push({ meter: meterNum, expected, actual });
        
        if (actual !== expected) {
          console.warn(`VALIDATION: ${meterNum} - expected ${expected}, got ${actual}`);
        } else {
          console.log(`VALIDATED: ${meterNum} - ${actual} readings`);
        }
      }

      console.log('=== LEAF METER COPY COMPLETE ===');

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'copyLeafMetersOnly',
          leafMetersCopied: leafMeterIds.length,
          totalReadingsCopied: copiedCount,
          copyErrors,
          validationResults
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== MODE 2: GENERATE HIERARCHICAL CSV FOR PARENT METER =====
    // (Leaf data is already in hierarchical_meter_readings from copyLeafMetersOnly call)
    
    console.log('=== GENERATING HIERARCHICAL CSV FOR PARENT ===');
    console.log('Parent meter:', parentMeterNumber, '(', parentMeterId, ')');
    console.log('Child meter IDs:', childMeterIds);
    console.log('Date range:', dateFrom, 'to', dateTo);
    console.log('Columns to aggregate:', passedColumns);

    if (!parentMeterId || !childMeterIds || childMeterIds.length === 0) {
      throw new Error('parentMeterId and childMeterIds are required for parent aggregation mode');
    }

    // Get meter number mapping for logging
    const { data: meterInfo } = await supabase
      .from('meters')
      .select('id, meter_number')
      .in('id', childMeterIds);
    
    const meterNumberMap = new Map<string, string>();
    meterInfo?.forEach(m => meterNumberMap.set(m.id, m.meter_number));
    console.log('Child meters:', Array.from(meterNumberMap.entries()).map(([id, num]) => num).join(', '));

    // Identify leaf vs parent child meters
    const { data: childrenOfChildren } = await supabase
      .from('meter_connections')
      .select('parent_meter_id')
      .in('parent_meter_id', childMeterIds);

    const parentChildMeterIds = new Set<string>(
      childrenOfChildren?.map(c => c.parent_meter_id) || []
    );
    const leafChildMeterIds = childMeterIds.filter(id => !parentChildMeterIds.has(id));

    console.log(`Child meters breakdown: ${leafChildMeterIds.length} leaf, ${parentChildMeterIds.size} parent`);
    console.log('Leaf children:', leafChildMeterIds.map(id => meterNumberMap.get(id) || id).join(', '));
    console.log('Parent children:', Array.from(parentChildMeterIds).map(id => meterNumberMap.get(id) || id).join(', '));

    // Clear existing aggregated readings for this parent meter
    console.log('Clearing existing aggregated readings for parent meter...');
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
      console.log(`Cleared ${deletedData?.length || 0} existing readings for parent`);
    }

    // ===== FETCH ALL CHILD DATA FROM hierarchical_meter_readings =====
    // Leaf data should already be there from copyLeafMetersOnly call
    console.log('Fetching ALL child meter data from hierarchical_meter_readings...');
    
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
      const { data: pageData, error: fetchError } = await supabase
        .from('hierarchical_meter_readings')
        .select('reading_timestamp, kwh_value, kva_value, metadata, meter_id')
        .in('meter_id', childMeterIds)
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

    // Log breakdown
    const copiedCount = allReadings.filter(r => r.metadata?.source === 'Copied').length;
    const aggregatedCount = allReadings.filter(r => r.metadata?.source === 'hierarchical_aggregation').length;
    console.log(`Fetched ${allReadings.length} total readings from hierarchical_meter_readings`);
    console.log(`  - ${copiedCount} from Copied (leaf meters)`);
    console.log(`  - ${aggregatedCount} from hierarchical_aggregation (parent meters)`);
    
    const readingsByMeter = new Map<string, number>();
    allReadings.forEach(r => {
      readingsByMeter.set(r.meter_id, (readingsByMeter.get(r.meter_id) || 0) + 1);
    });
    console.log('Readings by child meter:');
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
          error: 'No readings found for child meters. Make sure to call with copyLeafMetersOnly=true first.',
          totalKwh: 0,
          columnTotals: {},
          columnMaxValues: {}
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Aggregate readings by timestamp
    console.log('Aggregating readings by timestamp...');
    const columns = passedColumns || [];
    const groupedData = new Map<string, AggregatedData>();

    allReadings.forEach(reading => {
      const slot = roundToSlot(reading.reading_timestamp);
      
      if (!groupedData.has(slot)) {
        groupedData.set(slot, {});
      }
      
      const group = groupedData.get(slot)!;

      if (reading.metadata?.imported_fields) {
        const importedFields = reading.metadata.imported_fields as Record<string, any>;
        
        columns.forEach(col => {
          const value = importedFields[col];
          if (value !== null && value !== undefined) {
            const numValue = Number(value);
            if (!isNaN(numValue)) {
              group[col] = (group[col] || 0) + numValue;
            }
          }
        });
      }
    });

    console.log(`Aggregated data into ${groupedData.size} time slots`);

    // Merge with existing CSV if present
    console.log('Checking for existing hierarchical CSV to merge...');
    
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
    const sanitizedMeterNumber = sanitizeName(parentMeterNumber || '');
    const fileName = `${sanitizedMeterNumber}_Hierarchical_Energy_Profile.csv`;
    const filePath = `${clientName}/${siteName}/Metering/Reconciliations/${fileName}`;

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
          
          for (let i = 2; i < existingLines.length; i++) {
            const row = existingLines[i].trim();
            if (!row) continue;
            
            const values = row.split(',');
            const timestamp = values[0];
            
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

    // Generate CSV content
    console.log('Generating CSV content...');
    const csvRows: string[] = [];
    csvRows.push('pnpscada.com,Virtual');
    
    const headerColumns = ['Time', ...columns];
    csvRows.push(headerColumns.join(','));

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
    console.log(`Generated CSV with ${csvRows.length - 2} data rows`);

    // Calculate summary statistics
    const columnTotals: Record<string, number> = {};
    const columnMaxValues: Record<string, number> = {};
    
    columns.forEach(col => {
      const colLower = col.toLowerCase();
      const isKvaColumn = colLower.includes('kva') || colLower === 's';
      
      if (isKvaColumn) {
        const values = Array.from(groupedData.values()).map(d => d[col] || 0);
        columnMaxValues[col] = values.length > 0 ? Math.max(...values) : 0;
      } else {
        columnTotals[col] = Array.from(groupedData.values())
          .reduce((sum, d) => sum + (d[col] || 0), 0);
      }
    });

    const kwhColumns = columns.filter(c => 
      c.toLowerCase().includes('kwh') || /^P\d+/.test(c)
    );
    const totalKwh = kwhColumns.reduce((sum, col) => sum + (columnTotals[col] || 0), 0);

    console.log('Total kWh:', totalKwh);
    console.log('Column totals:', columnTotals);
    console.log('Column max values:', columnMaxValues);

    // Upload CSV to storage
    console.log('Uploading CSV to storage...');
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

    // Create/update meter_csv_files record
    console.log('Creating/updating meter_csv_files record...');
    const contentHash = await generateHash(csvContent);
    const dateRange = sortedTimestamps.length > 0 ? {
      from: sortedTimestamps[0],
      to: sortedTimestamps[sortedTimestamps.length - 1]
    } : { from: dateFrom, to: dateTo };

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
      }
    } else {
      const { error: insertError } = await supabase
        .from('meter_csv_files')
        .insert(csvRecord);

      if (insertError) {
        console.error(`Failed to insert meter_csv_files: ${insertError.message}`);
      }
    }

    // Insert parent meter's aggregated readings
    console.log('Inserting aggregated readings for parent meter...');
    const parentReadings = sortedTimestamps.map(timestamp => {
      const data = groupedData.get(timestamp)!;
      
      const p1Value = data['P1 (kWh)'] || data['P1'] || 0;
      const p2Value = data['P2 (kWh)'] || data['P2'] || 0;
      const timestampKwh = p1Value + p2Value;
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
      }
    }

    console.log(`Inserted ${insertedCount} readings for parent meter`);
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
    console.error('Error in generate-hierarchical-csv:', errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

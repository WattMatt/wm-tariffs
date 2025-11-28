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
  childMeterIds: string[]; // Immediate children only
  columns: string[]; // Columns from site_reconciliation_settings
}

interface CorrectedReading {
  timestamp: string;
  meterId: string;
  meterNumber: string;
  originalValue: number;
  correctedValue: number;
  fieldName: string;
  reason: string;
  originalSourceMeterId: string;
  originalSourceMeterNumber: string;
}

// Corruption detection thresholds
const THRESHOLDS = {
  maxKwhPer30Min: 10000,
  maxKvaPer30Min: 50000,
  maxMetadataValue: 100000,
};

// Helper to normalize timestamps to consistent ISO format
const normalizeTimestamp = (ts: string): string => {
  try {
    return new Date(ts).toISOString();
  } catch {
    return ts;
  }
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

    console.log('Generating hierarchical CSV for parent meter:', parentMeterNumber);
    console.log('Immediate child meter IDs:', childMeterIds);
    console.log('Date range:', dateFrom, 'to', dateTo);
    console.log('Passed columns:', passedColumns);

    // Track all corrections made during processing
    const corrections: CorrectedReading[] = [];
    
    // Get meter number mapping for all children
    const { data: meterInfo } = await supabase
      .from('meters')
      .select('id, meter_number')
      .in('id', childMeterIds);
    
    const meterNumberMap = new Map<string, string>();
    meterInfo?.forEach(m => meterNumberMap.set(m.id, m.meter_number));

    // Fetch meter associations to identify solar meters
    const { data: reconcSettings } = await supabase
      .from('site_reconciliation_settings')
      .select('meter_associations')
      .eq('site_id', siteId)
      .maybeSingle();

    const solarMeterIds = new Set<string>();
    if (reconcSettings?.meter_associations) {
      const associations = reconcSettings.meter_associations as Record<string, string>;
      Object.entries(associations).forEach(([meterId, assignment]) => {
        if (assignment === 'solar_energy') {
          solarMeterIds.add(meterId);
          console.log(`Identified solar meter: ${meterId} (${meterNumberMap.get(meterId) || 'unknown'})`);
        }
      });
    }
    console.log(`Found ${solarMeterIds.size} solar meters to invert`);

    // Get CSV files for immediate children (prioritize generated > parsed)
    const { data: childCsvFiles } = await supabase
      .from('meter_csv_files')
      .select('meter_id, file_path, file_name, parse_status')
      .in('meter_id', childMeterIds)
      .in('parse_status', ['generated', 'parsed']);

    const childrenWithCsv = new Map<string, { path: string; isGenerated: boolean }>();
    childCsvFiles?.forEach(f => {
      const isHierarchical = f.file_name.toLowerCase().includes('hierarchical');
      const existing = childrenWithCsv.get(f.meter_id);
      
      if (f.parse_status === 'generated' && isHierarchical) {
        childrenWithCsv.set(f.meter_id, { path: f.file_path, isGenerated: true });
        console.log(`✓ Using GENERATED hierarchical CSV for ${meterNumberMap.get(f.meter_id) || f.meter_id}: ${f.file_name}`);
      } else if (f.parse_status === 'parsed' && !isHierarchical && !existing?.isGenerated) {
        childrenWithCsv.set(f.meter_id, { path: f.file_path, isGenerated: false });
        console.log(`Using UPLOADED CSV for ${meterNumberMap.get(f.meter_id) || f.meter_id}: ${f.file_name}`);
      }
    });
    
    const childrenWithoutCsv = childMeterIds.filter(id => !childrenWithCsv.has(id));
    const metersForRawReadings = childrenWithoutCsv;
    
    console.log(`Children with CSV: ${childrenWithCsv.size}`);
    console.log(`Children without CSV (will use raw readings): ${metersForRawReadings.length}`);

    // Helper to round timestamp to nearest 30-min slot
    const roundToSlot = (timestamp: string): string => {
      const date = new Date(timestamp);
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

    // Use passed columns exactly as provided (NO "Total kWh" column)
    const columns = passedColumns || [];
    console.log(`Using ${columns.length} columns from site settings:`, columns);

    // ===== STEP 1: Find timestamps from the LONGEST child CSV within date range =====
    let masterTimestamps: string[] = [];
    let longestChildId: string | null = null;

    // First, collect all CSV data and find the longest one
    const childCsvData = new Map<string, { headers: string[]; rows: Map<string, string[]> }>();

    for (const [childMeterId, csvInfo] of childrenWithCsv.entries()) {
      try {
        const { data: csvData, error: downloadError } = await supabase.storage
          .from('client-files')
          .download(csvInfo.path);

        if (downloadError || !csvData) {
          console.error(`Failed to download CSV for ${childMeterId}:`, downloadError);
          continue;
        }

        const csvText = await csvData.text();
        const lines = csvText.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) continue;

        const headers = lines[0].split(',').map(h => h.trim());
        const rows = new Map<string, string[]>();
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          const rawTimestamp = values[0]?.trim();
          if (!rawTimestamp) continue;
          
          const slot = roundToSlot(rawTimestamp);
          
          // Filter to only include timestamps within date range
          if (slot >= dateFrom && slot <= dateTo) {
            rows.set(slot, values);
          }
        }

        childCsvData.set(childMeterId, { headers, rows });
        
        const timestamps = Array.from(rows.keys());
        if (timestamps.length > masterTimestamps.length) {
          masterTimestamps = timestamps;
          longestChildId = childMeterId;
        }
        
        console.log(`Read ${rows.size} rows from ${meterNumberMap.get(childMeterId) || childMeterId}`);
      } catch (error) {
        console.error(`Error reading CSV for ${childMeterId}:`, error);
      }
    }

    console.log(`Using timestamps from ${longestChildId ? meterNumberMap.get(longestChildId) || longestChildId : 'none'}, ${masterTimestamps.length} timestamps`);

    // Sort master timestamps
    masterTimestamps.sort((a, b) => a.localeCompare(b));

    // Initialize groupedData with timestamps from longest child
    const groupedData = new Map<string, Record<string, number>>();
    masterTimestamps.forEach(ts => {
      groupedData.set(ts, {});
    });

    // ===== STEP 2: Aggregate data from all child CSVs =====
    for (const [childMeterId, csvDataInfo] of childCsvData.entries()) {
      const { headers, rows } = csvDataInfo;
      const isSolarMeter = solarMeterIds.has(childMeterId);
      const multiplier = isSolarMeter ? -1 : 1;
      
      if (isSolarMeter) {
        console.log(`Applying inversion (multiplier: -1) for solar meter CSV: ${meterNumberMap.get(childMeterId) || childMeterId}`);
      }

      for (const [timestamp, values] of rows.entries()) {
        if (!groupedData.has(timestamp)) continue; // Skip if not in master timestamps

        const group = groupedData.get(timestamp)!;

        // Sum each known column from passed columns
        columns.forEach(col => {
          const headerIdx = headers.findIndex(h => h === col);
          if (headerIdx >= 0 && headerIdx < values.length) {
            const rawValue = parseFloat(values[headerIdx]) || 0;
            group[col] = (group[col] || 0) + (rawValue * multiplier);
          }
        });
      }
    }

    // ===== STEP 3: Fetch raw readings for children without CSVs =====
    if (metersForRawReadings.length > 0) {
      const PAGE_SIZE = 1000;
      let allReadings: Array<{
        reading_timestamp: string;
        kwh_value: number;
        metadata: Record<string, any> | null;
        meter_id: string;
      }> = [];
      let offset = 0;
      let hasMore = true;

      console.log(`Fetching readings from meter_readings for ${metersForRawReadings.length} immediate children without CSVs...`);
      
      while (hasMore) {
        const { data: pageData, error: readingsError } = await supabase
          .from('meter_readings')
          .select('reading_timestamp, kwh_value, metadata, meter_id')
          .in('meter_id', metersForRawReadings)
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

      console.log(`Fetched ${allReadings.length} total readings from ${metersForRawReadings.length} immediate children`);

      // Add raw readings timestamps to master if not already present
      allReadings.forEach(reading => {
        const slot = roundToSlot(reading.reading_timestamp);
        if (!groupedData.has(slot)) {
          groupedData.set(slot, {});
          masterTimestamps.push(slot);
        }
      });
      
      // Re-sort master timestamps after adding new ones
      masterTimestamps.sort((a, b) => a.localeCompare(b));

      // Aggregate raw readings
      allReadings.forEach(reading => {
        const slot = roundToSlot(reading.reading_timestamp);
        const group = groupedData.get(slot)!;
        
        const isSolarMeter = solarMeterIds.has(reading.meter_id);
        const multiplier = isSolarMeter ? -1 : 1;

        // Check kWh value for corruption
        if (Math.abs(reading.kwh_value) > THRESHOLDS.maxKwhPer30Min) {
          corrections.push({
            timestamp: reading.reading_timestamp,
            meterId: reading.meter_id,
            meterNumber: meterNumberMap.get(reading.meter_id) || 'Unknown',
            originalValue: reading.kwh_value,
            correctedValue: 0,
            fieldName: 'kwh_value',
            reason: `Value ${reading.kwh_value.toLocaleString()} exceeds max threshold ${THRESHOLDS.maxKwhPer30Min.toLocaleString()}`,
            originalSourceMeterId: reading.meter_id,
            originalSourceMeterNumber: meterNumberMap.get(reading.meter_id) || 'Unknown'
          });
        }

        // Sum metadata columns
        if (reading.metadata?.imported_fields) {
          columns.forEach(col => {
            const value = reading.metadata?.imported_fields?.[col];
            if (value !== null && value !== undefined) {
              const numValue = Number(value);
              if (!isNaN(numValue) && numValue !== 0) {
                const isKva = col.toLowerCase().includes('kva') || col.toLowerCase() === 's';
                const threshold = isKva ? THRESHOLDS.maxKvaPer30Min : THRESHOLDS.maxMetadataValue;
                
                if (Math.abs(numValue) > threshold) {
                  corrections.push({
                    timestamp: reading.reading_timestamp,
                    meterId: reading.meter_id,
                    meterNumber: meterNumberMap.get(reading.meter_id) || 'Unknown',
                    originalValue: numValue,
                    correctedValue: 0,
                    fieldName: col,
                    reason: `Value ${numValue.toLocaleString()} exceeds max threshold ${threshold.toLocaleString()}`,
                    originalSourceMeterId: reading.meter_id,
                    originalSourceMeterNumber: meterNumberMap.get(reading.meter_id) || 'Unknown'
                  });
                } else {
                  group[col] = (group[col] || 0) + (numValue * multiplier);
                }
              }
            }
          });
        }
      });
    }

    console.log(`Total corrections made: ${corrections.length}`);
    console.log(`GroupedData has ${groupedData.size} timestamps after aggregation`);

    // ===== STEP 4: Generate CSV rows (NO "Total kWh" column) =====
    const csvRows: string[] = [];
    // Header: Timestamp followed by passed columns ONLY
    const headerColumns = ['Timestamp', ...columns];
    csvRows.push(headerColumns.join(','));

    Array.from(groupedData.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([timestamp, data]) => {
        const row = [
          timestamp,
          ...columns.map(col => (data[col] || 0).toFixed(4))
        ];
        csvRows.push(row.join(','));
      });

    const newCsvContent = csvRows.join('\n');
    console.log(`Generated ${csvRows.length - 1} CSV rows with ${columns.length} columns`);

    // Calculate final totals for response (NO "Total kWh")
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

    // Calculate totalKwh from kWh-related columns in columnTotals
    const kwhColumns = columns.filter(c => 
      c.toLowerCase().includes('kwh') || /^P\d+$/.test(c)
    );
    const totalKwh = kwhColumns.reduce((sum, col) => sum + (columnTotals[col] || 0), 0);

    console.log('Total kWh (calculated from kWh columns):', totalKwh);
    console.log('Column totals (sums):', columnTotals);
    console.log('Column max values (kVA):', columnMaxValues);

    // Get site and client info for storage path
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .select('name, clients(name)')
      .eq('id', siteId)
      .single();

    if (siteError || !siteData) {
      throw new Error('Failed to fetch site data');
    }

    const sanitizeName = (name: string) => 
      name.trim().replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, ' ');

    const clientName = sanitizeName((siteData.clients as any).name);
    const siteName = sanitizeName(siteData.name);
    const sanitizedMeterNumber = sanitizeName(parentMeterNumber);

    const fileName = `${sanitizedMeterNumber}_Hierarchical_Energy_Profile.csv`;
    const filePath = `${clientName}/${siteName}/Metering/Reconciliations/${fileName}`;

    // Check if CSV already exists
    const { data: existingFiles } = await supabase.storage
      .from('client-files')
      .list(`${clientName}/${siteName}/Metering/Reconciliations`, {
        search: fileName
      });

    let finalCsvContent = newCsvContent;
    const fileExists = existingFiles && existingFiles.length > 0;

    if (fileExists) {
      console.log('Existing CSV found, checking column structure...');
      
      const { data: existingCsv, error: downloadError } = await supabase.storage
        .from('client-files')
        .download(filePath);

      if (!downloadError && existingCsv) {
        const existingContent = await existingCsv.text();
        const existingLines = existingContent.split('\n').filter(line => line.trim());
        
        if (existingLines.length > 0) {
          const existingHeader = existingLines[0];
          const newHeader = headerColumns.join(',');
          const existingColumnCount = existingHeader.split(',').length;
          const newColumnCount = headerColumns.length;
          
          // If column structure changed, replace entirely instead of merging
          if (existingColumnCount !== newColumnCount || existingHeader !== newHeader) {
            console.log(`Column structure changed (${existingColumnCount} -> ${newColumnCount}), replacing CSV entirely`);
            finalCsvContent = newCsvContent;
          } else {
            // Column structure matches - merge with timestamp normalization
            console.log('Column structure matches, merging data with normalized timestamps...');
            const newLines = csvRows.slice(1);

            // Use normalized timestamps for merging
            const uniqueLines = new Map<string, string>();
            
            // Add existing lines with normalized timestamps
            existingLines.slice(1).forEach(line => {
              const rawTimestamp = line.split(',')[0];
              if (rawTimestamp) {
                const normalizedTs = normalizeTimestamp(rawTimestamp);
                uniqueLines.set(normalizedTs, line);
              }
            });

            // New data replaces existing timestamps (with normalized keys)
            newLines.forEach(line => {
              const rawTimestamp = line.split(',')[0];
              if (rawTimestamp) {
                const normalizedTs = normalizeTimestamp(rawTimestamp);
                uniqueLines.set(normalizedTs, line);
              }
            });

            const sortedLines = Array.from(uniqueLines.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, line]) => line);

            finalCsvContent = [headerColumns.join(','), ...sortedLines].join('\n');
            console.log(`Merged CSV: ${sortedLines.length} total rows`);
          }
        }
      }
    }

    // Upload CSV
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(filePath, finalCsvContent, {
        contentType: 'text/csv',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Failed to upload CSV: ${uploadError.message}`);
    }

    console.log('CSV uploaded successfully to:', filePath);

    // Update meter_csv_files table
    const rowCount = finalCsvContent.split('\n').length - 1;
    const contentHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(finalCsvContent)
    ).then(buf => Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    );

    const { data: existingRecord } = await supabase
      .from('meter_csv_files')
      .select('id')
      .eq('meter_id', parentMeterId)
      .eq('file_name', fileName)
      .single();

    if (existingRecord) {
      const { error: updateError } = await supabase
        .from('meter_csv_files')
        .update({
          content_hash: contentHash,
          readings_inserted: rowCount,
          updated_at: new Date().toISOString(),
          file_size: finalCsvContent.length,
          parse_status: 'generated'
        })
        .eq('id', existingRecord.id);

      if (updateError) {
        console.error('Failed to update meter_csv_files:', updateError);
      }
    } else {
      const { error: insertError } = await supabase
        .from('meter_csv_files')
        .insert({
          site_id: siteId,
          meter_id: parentMeterId,
          file_name: fileName,
          file_path: filePath,
          content_hash: contentHash,
          file_size: finalCsvContent.length,
          upload_status: 'uploaded',
          parse_status: 'generated',
          readings_inserted: rowCount
        });

      if (insertError) {
        console.error('Failed to insert into meter_csv_files:', insertError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        filePath,
        rowCount,
        totalKwh,
        columnTotals,
        columnMaxValues,
        columns,
        corrections,
        message: corrections.length > 0 
          ? `CSV created with ${corrections.length} corrupt value(s) corrected` 
          : fileExists ? 'CSV updated with new data' : 'CSV created successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating hierarchical CSV:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

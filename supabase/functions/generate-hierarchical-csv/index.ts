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
}

interface ReadingRow {
  reading_timestamp: string;
  kwh_value: number;
  metadata: Record<string, any> | null;
  meter_id: string;
}

interface CorrectedReading {
  timestamp: string;
  meterId: string;
  meterNumber: string;
  originalValue: number;
  correctedValue: number;
  fieldName: string;
  reason: string;
  // Track the ORIGINAL source meter through hierarchical layers
  originalSourceMeterId: string;
  originalSourceMeterNumber: string;
}

// Corruption detection thresholds
const THRESHOLDS = {
  maxKwhPer30Min: 10000,    // 10,000 kWh per 30 mins = 20MW sustained
  maxKvaPer30Min: 50000,    // 50,000 kVA per 30 mins
  maxMetadataValue: 100000, // 100,000 for any metadata column
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
      childMeterIds
    } = await req.json() as HierarchicalCSVRequest;

    console.log('Generating hierarchical CSV for parent meter:', parentMeterNumber);
    console.log('Immediate child meter IDs:', childMeterIds);
    console.log('Date range:', dateFrom, 'to', dateTo);

    // Track all corrections made during processing
    const corrections: CorrectedReading[] = [];
    
    // Get meter number mapping for all children (for correction logging)
    const { data: meterInfo } = await supabase
      .from('meters')
      .select('id, meter_number')
      .in('id', childMeterIds);
    
    const meterNumberMap = new Map<string, string>();
    meterInfo?.forEach(m => meterNumberMap.set(m.id, m.meter_number));

    // ===== LAYERED APPROACH: Check which immediate children have generated CSVs =====
    const { data: childCsvFiles } = await supabase
      .from('meter_csv_files')
      .select('meter_id, file_path, file_name')
      .in('meter_id', childMeterIds)
      .eq('parse_status', 'generated');

    const childrenWithCsv = new Map<string, string>();
    childCsvFiles?.forEach(f => childrenWithCsv.set(f.meter_id, f.file_path));
    
    const childrenWithoutCsv = childMeterIds.filter(id => !childrenWithCsv.has(id));
    
    console.log(`Children with generated CSV: ${childrenWithCsv.size}`);
    console.log(`Children without CSV (will find leaf meters): ${childrenWithoutCsv.length}`);

    // Helper function to recursively get all leaf meter IDs (only for children without CSVs)
    const getLeafMeterIds = async (meterIds: string[]): Promise<string[]> => {
      if (meterIds.length === 0) return [];
      
      const { data: connections } = await supabase
        .from('meter_connections')
        .select('parent_meter_id, child_meter_id')
        .in('parent_meter_id', meterIds);
      
      if (!connections || connections.length === 0) {
        return meterIds;
      }
      
      const parentIdsWithChildren = new Set(connections.map(c => c.parent_meter_id));
      const directLeaves = meterIds.filter(id => !parentIdsWithChildren.has(id));
      const childIds = connections.map(c => c.child_meter_id);
      const childLeaves = await getLeafMeterIds(childIds);
      
      return [...new Set([...directLeaves, ...childLeaves])];
    };

    // Get leaf meter IDs only for children that don't have generated CSVs
    let leafMeterIds: string[] = [];
    if (childrenWithoutCsv.length > 0) {
      leafMeterIds = await getLeafMeterIds(childrenWithoutCsv);
      
      // Get meter numbers for leaf meters too (for correction logging)
      if (leafMeterIds.length > 0) {
        const { data: leafMeterInfo } = await supabase
          .from('meters')
          .select('id, meter_number')
          .in('id', leafMeterIds);
        
        leafMeterInfo?.forEach(m => meterNumberMap.set(m.id, m.meter_number));
      }
    }
    
    console.log(`Found ${leafMeterIds.length} leaf meters from ${childrenWithoutCsv.length} children without CSVs`);

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

    // Generate ALL timestamps for the requested period (30-minute intervals)
    const generateAllTimestamps = (fromDate: string, toDate: string): string[] => {
      const timestamps: string[] = [];
      const start = new Date(fromDate);
      const end = new Date(toDate);
      const intervalMs = 30 * 60 * 1000;
      
      let current = new Date(start);
      while (current <= end) {
        timestamps.push(current.toISOString());
        current = new Date(current.getTime() + intervalMs);
      }
      
      return timestamps;
    };

    const allTimestamps = generateAllTimestamps(dateFrom, dateTo);
    console.log(`Generated ${allTimestamps.length} expected timestamps for period`);

    // Initialize groupedData with ALL timestamps (zero values as default)
    const groupedData = new Map<string, {
      totalKwh: number;
      columnSums: Record<string, number>;
    }>();

    allTimestamps.forEach(ts => {
      groupedData.set(ts, {
        totalKwh: 0,
        columnSums: {}
      });
    });

    // Discover all columns
    const allColumns = new Set<string>();

    // ===== PART 1: Read from existing generated CSVs =====
    for (const [childMeterId, filePath] of childrenWithCsv.entries()) {
      console.log(`Reading generated CSV for child ${meterNumberMap.get(childMeterId) || childMeterId}: ${filePath}`);
      
      try {
        const { data: csvData, error: downloadError } = await supabase.storage
          .from('client-files')
          .download(filePath);

        if (downloadError || !csvData) {
          console.error(`Failed to download CSV for ${childMeterId}:`, downloadError);
          continue;
        }

        const csvText = await csvData.text();
        const lines = csvText.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          console.log(`CSV for ${childMeterId} is empty or has no data rows`);
          continue;
        }

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim());
        const timestampIdx = 0;
        const kwhIdx = headers.findIndex(h => h.toLowerCase().includes('kwh'));
        
        // Track columns from this CSV
        headers.forEach((h, idx) => {
          if (idx > 0 && !h.toLowerCase().includes('timestamp')) {
            allColumns.add(h);
          }
        });

        // Parse data rows and merge into groupedData
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          const timestamp = values[timestampIdx]?.trim();
          
          if (!timestamp) continue;
          
          const slot = roundToSlot(timestamp);
          if (!groupedData.has(slot)) {
            groupedData.set(slot, { totalKwh: 0, columnSums: {} });
          }
          
          const group = groupedData.get(slot)!;
          
          // Add kWh value with corruption check
          if (kwhIdx >= 0) {
            const kwhValue = parseFloat(values[kwhIdx]) || 0;
            
            if (Math.abs(kwhValue) > THRESHOLDS.maxKwhPer30Min) {
              corrections.push({
                timestamp: slot,
                meterId: childMeterId,
                meterNumber: meterNumberMap.get(childMeterId) || 'Unknown',
                originalValue: kwhValue,
                correctedValue: 0,
                fieldName: 'Total kWh',
                reason: `Value ${kwhValue.toLocaleString()} exceeds max threshold ${THRESHOLDS.maxKwhPer30Min.toLocaleString()}`,
                originalSourceMeterId: childMeterId,
                originalSourceMeterNumber: meterNumberMap.get(childMeterId) || 'Unknown'
              });
              // Don't add corrupt value
            } else {
              group.totalKwh += kwhValue;
            }
          }
          
          // Add other column values with corruption check
          headers.forEach((header, idx) => {
            if (idx === 0 || idx === kwhIdx) return;
            
            const value = parseFloat(values[idx]) || 0;
            if (value === 0) return;
            
            // Determine threshold based on column type
            const isKva = header.toLowerCase().includes('kva') || header.toLowerCase() === 's';
            const threshold = isKva ? THRESHOLDS.maxKvaPer30Min : THRESHOLDS.maxMetadataValue;
            
            if (Math.abs(value) > threshold) {
              corrections.push({
                timestamp: slot,
                meterId: childMeterId,
                meterNumber: meterNumberMap.get(childMeterId) || 'Unknown',
                originalValue: value,
                correctedValue: 0,
                fieldName: header,
                reason: `Value ${value.toLocaleString()} exceeds max threshold ${threshold.toLocaleString()}`,
                originalSourceMeterId: childMeterId,
                originalSourceMeterNumber: meterNumberMap.get(childMeterId) || 'Unknown'
              });
              // Don't add corrupt value
            } else {
              group.columnSums[header] = (group.columnSums[header] || 0) + value;
            }
          });
        }
        
        console.log(`Merged ${lines.length - 1} rows from ${meterNumberMap.get(childMeterId) || childMeterId}`);
      } catch (error) {
        console.error(`Error reading CSV for ${childMeterId}:`, error);
      }
    }

    // ===== PART 2: Fetch readings from meter_readings for leaf meters =====
    if (leafMeterIds.length > 0) {
      const PAGE_SIZE = 1000;
      let allReadings: ReadingRow[] = [];
      let offset = 0;
      let hasMore = true;

      console.log('Fetching readings from meter_readings for leaf meters...');
      
      while (hasMore) {
        const { data: pageData, error: readingsError } = await supabase
          .from('meter_readings')
          .select('reading_timestamp, kwh_value, metadata, meter_id')
          .in('meter_id', leafMeterIds)
          .gte('reading_timestamp', dateFrom)
          .lte('reading_timestamp', dateTo)
          .order('reading_timestamp', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (readingsError) {
          throw new Error(`Failed to fetch readings: ${readingsError.message}`);
        }

        if (pageData && pageData.length > 0) {
          allReadings = allReadings.concat(pageData as ReadingRow[]);
          offset += pageData.length;
          hasMore = pageData.length === PAGE_SIZE;
          console.log(`Fetched page: ${pageData.length} rows, total so far: ${allReadings.length}`);
        } else {
          hasMore = false;
        }
      }

      console.log(`Fetched ${allReadings.length} total readings from ${leafMeterIds.length} leaf meters`);

      // Discover columns from readings
      allReadings?.forEach((reading: ReadingRow) => {
        if (reading.metadata?.imported_fields) {
          Object.entries(reading.metadata.imported_fields).forEach(([key, value]) => {
            if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
              allColumns.add(key);
            }
          });
        }
      });

      // Populate groupedData with readings (with corruption detection)
      allReadings?.forEach((reading: ReadingRow) => {
        const matchingTs = roundToSlot(reading.reading_timestamp);
        
        if (!groupedData.has(matchingTs)) {
          groupedData.set(matchingTs, { totalKwh: 0, columnSums: {} });
        }

        const group = groupedData.get(matchingTs)!;
        
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
          // Don't add corrupt value
        } else {
          group.totalKwh += reading.kwh_value;
        }

        // Sum all metadata columns with corruption check
        if (reading.metadata?.imported_fields) {
          const columns = Array.from(allColumns);
          columns.forEach(col => {
            const value = reading.metadata?.imported_fields?.[col];
            if (value !== null && value !== undefined) {
              const numValue = Number(value);
              if (!isNaN(numValue) && numValue !== 0) {
                // Determine threshold
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
                  // Don't add corrupt value
                } else {
                  group.columnSums[col] = (group.columnSums[col] || 0) + numValue;
                }
              }
            }
          });
        }
      });
    }

    const columns = Array.from(allColumns).sort();
    console.log(`Discovered ${columns.length} numeric columns:`, columns);
    console.log(`Total corrections made: ${corrections.length}`);

    if (corrections.length > 0) {
      console.log('Corrections summary:');
      const byMeter = corrections.reduce((acc, c) => {
        acc[c.meterNumber] = (acc[c.meterNumber] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log(byMeter);
    }

    console.log(`GroupedData has ${groupedData.size} timestamps after populating`);

    // Generate CSV rows
    const csvRows: string[] = [];
    const headerColumns = ['Timestamp', 'Total kWh', ...columns];
    csvRows.push(headerColumns.join(','));

    Array.from(groupedData.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([timestamp, data]) => {
        const row = [
          timestamp,
          data.totalKwh.toFixed(4),
          ...columns.map(col => (data.columnSums[col] || 0).toFixed(4))
        ];
        csvRows.push(row.join(','));
      });

    const newCsvContent = csvRows.join('\n');
    console.log(`Generated ${csvRows.length - 1} CSV rows`);

    // Calculate final totals for response
    const totalKwh = Array.from(groupedData.values())
      .reduce((sum, d) => sum + d.totalKwh, 0);

    const columnTotals: Record<string, number> = {};
    columns.forEach(col => {
      columnTotals[col] = Array.from(groupedData.values())
        .reduce((sum, d) => sum + (d.columnSums[col] || 0), 0);
    });

    console.log('Total kWh:', totalKwh);
    console.log('Column totals:', columnTotals);

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

    // Check if CSV already exists and merge data
    const { data: existingFiles } = await supabase.storage
      .from('client-files')
      .list(`${clientName}/${siteName}/Metering/Reconciliations`, {
        search: fileName
      });

    let finalCsvContent = newCsvContent;
    const fileExists = existingFiles && existingFiles.length > 0;

    if (fileExists) {
      console.log('Existing CSV found, merging data...');
      
      const { data: existingCsv, error: downloadError } = await supabase.storage
        .from('client-files')
        .download(filePath);

      if (!downloadError && existingCsv) {
        const existingContent = await existingCsv.text();
        const existingLines = existingContent.split('\n').filter(line => line.trim());
        const newLines = csvRows.slice(1);

        const uniqueLines = new Map<string, string>();
        existingLines.slice(1).forEach(line => {
          const timestamp = line.split(',')[0];
          if (timestamp) {
            uniqueLines.set(timestamp, line);
          }
        });

        newLines.forEach(line => {
          const timestamp = line.split(',')[0];
          if (timestamp) {
            uniqueLines.set(timestamp, line);
          }
        });

        const sortedLines = Array.from(uniqueLines.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, line]) => line);

        finalCsvContent = [headerColumns.join(','), ...sortedLines].join('\n');
        console.log(`Merged CSV: ${sortedLines.length} total rows`);
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
          parse_status: 'generated' // CRITICAL: Mark as generated so parent meters can find this CSV
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
        columns,
        corrections, // Return all corrections made
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

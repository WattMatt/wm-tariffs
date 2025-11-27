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
  childMeterIds: string[]; // Immediate children - function will find all leaf meters
}

interface ReadingRow {
  reading_timestamp: string;
  kwh_value: number;
  metadata: Record<string, any> | null;
  meter_id: string;
}

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

    // Helper function to recursively get all leaf meter IDs
    const getLeafMeterIds = async (meterIds: string[]): Promise<string[]> => {
      if (meterIds.length === 0) return [];
      
      const { data: connections } = await supabase
        .from('meter_connections')
        .select('parent_meter_id, child_meter_id')
        .in('parent_meter_id', meterIds);
      
      if (!connections || connections.length === 0) {
        // No children found - these are all leaf meters
        return meterIds;
      }
      
      // Find which meters have children and which don't
      const parentIdsWithChildren = new Set(connections.map(c => c.parent_meter_id));
      const directLeaves = meterIds.filter(id => !parentIdsWithChildren.has(id));
      
      // Get leaf meters for children
      const childIds = connections.map(c => c.child_meter_id);
      const childLeaves = await getLeafMeterIds(childIds);
      
      return [...new Set([...directLeaves, ...childLeaves])];
    };

    // Get all leaf meter IDs from immediate children
    const leafMeterIds = await getLeafMeterIds(childMeterIds);
    console.log(`Found ${leafMeterIds.length} leaf meters from ${childMeterIds.length} immediate children`);

    if (leafMeterIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No leaf meters found for this parent meter'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Fetch all readings from leaf meters in the date range
    const { data: readings, error: readingsError } = await supabase
      .from('meter_readings')
      .select('reading_timestamp, kwh_value, metadata, meter_id')
      .in('meter_id', leafMeterIds)
      .gte('reading_timestamp', dateFrom)
      .lte('reading_timestamp', dateTo)
      .order('reading_timestamp', { ascending: true });

    if (readingsError) {
      throw new Error(`Failed to fetch readings: ${readingsError.message}`);
    }

    console.log(`Fetched ${readings?.length || 0} readings from ${leafMeterIds.length} leaf meters`);

    // 2. Discover all unique numeric columns from the readings metadata
    const allColumns = new Set<string>();
    readings?.forEach((reading: ReadingRow) => {
      if (reading.metadata?.imported_fields) {
        Object.entries(reading.metadata.imported_fields).forEach(([key, value]) => {
          // Only include numeric fields
          if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
            allColumns.add(key);
          }
        });
      }
    });
    const columns = Array.from(allColumns).sort();
    console.log(`Discovered ${columns.length} numeric columns:`, columns);

    // 3. Group readings by timestamp and SUM all values (raw summation, no operations/factors)
    const groupedData = new Map<string, {
      totalKwh: number;
      columnSums: Record<string, number>;
    }>();

    readings?.forEach((reading: ReadingRow) => {
      const timestamp = reading.reading_timestamp;

      if (!groupedData.has(timestamp)) {
        groupedData.set(timestamp, {
          totalKwh: 0,
          columnSums: {}
        });
      }

      const group = groupedData.get(timestamp)!;
      group.totalKwh += reading.kwh_value; // Always sum kWh

      // Sum all metadata columns (raw values, no factors applied)
      if (reading.metadata?.imported_fields) {
        columns.forEach(col => {
          const value = reading.metadata?.imported_fields?.[col];
          if (value !== null && value !== undefined) {
            const numValue = Number(value);
            if (!isNaN(numValue)) {
              group.columnSums[col] = (group.columnSums[col] || 0) + numValue;
            }
          }
        });
      }
    });

    // 4. Generate CSV rows
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

    // 5. Calculate final totals for response (raw sums)
    const totalKwh = Array.from(groupedData.values())
      .reduce((sum, d) => sum + d.totalKwh, 0);

    const columnTotals: Record<string, number> = {};
    columns.forEach(col => {
      columnTotals[col] = Array.from(groupedData.values())
        .reduce((sum, d) => sum + (d.columnSums[col] || 0), 0);
    });

    console.log('Total kWh:', totalKwh);
    console.log('Column totals:', columnTotals);

    // 6. Get site and client info for storage path
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

    // 7. Check if CSV already exists
    const { data: existingFiles } = await supabase.storage
      .from('client-files')
      .list(`${clientName}/${siteName}/Metering/Reconciliations`, {
        search: fileName
      });

    let finalCsvContent = newCsvContent;
    const fileExists = existingFiles && existingFiles.length > 0;

    if (fileExists) {
      console.log('Existing CSV found, appending data...');
      
      // Download existing CSV
      const { data: existingCsv, error: downloadError } = await supabase.storage
        .from('client-files')
        .download(filePath);

      if (!downloadError && existingCsv) {
        const existingContent = await existingCsv.text();
        const existingLines = existingContent.split('\n').filter(line => line.trim());
        const newLines = csvRows.slice(1); // Skip header from new data

        // First, add all existing lines to the map
        const uniqueLines = new Map<string, string>();
        existingLines.slice(1).forEach(line => {
          const timestamp = line.split(',')[0];
          if (timestamp) {
            uniqueLines.set(timestamp, line);
          }
        });

        // Then, overwrite/add with new lines
        // This will REPLACE existing timestamps and APPEND new ones
        newLines.forEach(line => {
          const timestamp = line.split(',')[0];
          if (timestamp) {
            uniqueLines.set(timestamp, line); // Overwrites if timestamp exists
          }
        });

        // Sort by timestamp and rebuild CSV
        const sortedLines = Array.from(uniqueLines.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, line]) => line);

        finalCsvContent = [headerColumns.join(','), ...sortedLines].join('\n');
        console.log(`Merged CSV: ${sortedLines.length} total rows (replaced existing + appended new)`);
      }
    }

    // 8. Upload CSV
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

    // 9. Update meter_csv_files table
    const rowCount = finalCsvContent.split('\n').length - 1;
    const contentHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(finalCsvContent)
    ).then(buf => Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    );

    // Check if record exists
    const { data: existingRecord } = await supabase
      .from('meter_csv_files')
      .select('id')
      .eq('meter_id', parentMeterId)
      .eq('file_name', fileName)
      .single();

    if (existingRecord) {
      // Update existing record
      const { error: updateError } = await supabase
        .from('meter_csv_files')
        .update({
          content_hash: contentHash,
          readings_inserted: rowCount,
          updated_at: new Date().toISOString(),
          file_size: finalCsvContent.length
        })
        .eq('id', existingRecord.id);

      if (updateError) {
        console.error('Failed to update meter_csv_files:', updateError);
      }
    } else {
      // Insert new record
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
        message: fileExists ? 'CSV updated with new data' : 'CSV created successfully'
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

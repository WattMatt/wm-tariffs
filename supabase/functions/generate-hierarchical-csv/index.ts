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
  leafMeterIds: string[];
  selectedColumns: string[];
  columnOperations: Record<string, string>;
  columnFactors: Record<string, number>;
  meterAssignments: Record<string, string>;
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
      leafMeterIds,
      selectedColumns,
      columnOperations,
      columnFactors,
      meterAssignments
    } = await req.json() as HierarchicalCSVRequest;

    console.log('Generating hierarchical CSV for parent meter:', parentMeterNumber);
    console.log('Leaf meter IDs:', leafMeterIds);
    console.log('Date range:', dateFrom, 'to', dateTo);

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

    // 2. Group readings by timestamp and sum values
    const groupedData = new Map<string, {
      totalKwh: number;
      metadataSums: Record<string, number>;
      metadataMaxes: Record<string, number>;
      metadataCounts: Record<string, number>;
    }>();

    readings?.forEach((reading: ReadingRow) => {
      const timestamp = reading.reading_timestamp;
      const isSolar = meterAssignments[reading.meter_id] === 'solar_energy';
      const kwhValue = isSolar ? -reading.kwh_value : reading.kwh_value;

      if (!groupedData.has(timestamp)) {
        groupedData.set(timestamp, {
          totalKwh: 0,
          metadataSums: {},
          metadataMaxes: {},
          metadataCounts: {}
        });
      }

      const group = groupedData.get(timestamp)!;
      group.totalKwh += kwhValue;

      // Process metadata columns
      if (reading.metadata) {
        selectedColumns.forEach(col => {
          const value = reading.metadata?.[col];
          if (value !== null && value !== undefined && !isNaN(Number(value))) {
            const numValue = Number(value) * (columnFactors[col] || 1);
            const operation = columnOperations[col] || 'sum';

            if (operation === 'sum' || operation === 'average') {
              group.metadataSums[col] = (group.metadataSums[col] || 0) + numValue;
              group.metadataCounts[col] = (group.metadataCounts[col] || 0) + 1;
            } else if (operation === 'max') {
              group.metadataMaxes[col] = Math.max(group.metadataMaxes[col] || numValue, numValue);
            } else if (operation === 'min') {
              group.metadataMaxes[col] = Math.min(group.metadataMaxes[col] || numValue, numValue);
            }
          }
        });
      }
    });

    // 3. Generate CSV rows
    const csvRows: string[] = [];
    const headerColumns = ['Timestamp', 'Total kWh', ...selectedColumns];
    csvRows.push(headerColumns.join(','));

    Array.from(groupedData.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([timestamp, data]) => {
        const row = [
          timestamp,
          data.totalKwh.toFixed(4),
          ...selectedColumns.map(col => {
            const operation = columnOperations[col] || 'sum';
            let value: number;

            if (operation === 'average') {
              value = data.metadataCounts[col] > 0
                ? data.metadataSums[col] / data.metadataCounts[col]
                : 0;
            } else if (operation === 'max' || operation === 'min') {
              value = data.metadataMaxes[col] || 0;
            } else {
              value = data.metadataSums[col] || 0;
            }

            return value.toFixed(4);
          })
        ];
        csvRows.push(row.join(','));
      });

    const newCsvContent = csvRows.join('\n');
    console.log(`Generated ${csvRows.length - 1} CSV rows`);

    // 4. Get site and client info for storage path
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

    // 5. Check if CSV already exists
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

        // Combine and remove duplicates by timestamp
        const allDataLines = [...existingLines.slice(1), ...newLines];
        const uniqueLines = new Map<string, string>();
        
        allDataLines.forEach(line => {
          const timestamp = line.split(',')[0];
          if (!uniqueLines.has(timestamp)) {
            uniqueLines.set(timestamp, line);
          }
        });

        // Sort by timestamp and rebuild CSV
        const sortedLines = Array.from(uniqueLines.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, line]) => line);

        finalCsvContent = [headerColumns.join(','), ...sortedLines].join('\n');
        console.log(`Merged CSV: ${sortedLines.length} unique rows`);
      }
    }

    // 6. Upload CSV
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

    // 7. Update meter_csv_files table
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      meterId, 
      filePath, 
      separator = "\t", 
      dateFormat = "auto", 
      timeInterval = 30, 
      headerRowNumber = 1,
      columnMapping = null 
    } = await req.json();

    console.log(`Processing CSV for meter ${meterId} from ${filePath} with separator "${separator}", dateFormat "${dateFormat}", timeInterval ${timeInterval} minutes, headerRowNumber: ${headerRowNumber}`);

    // Extract filename from path
    const fileName = filePath.split('/').pop() || 'unknown.csv';

    // Download CSV from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('meter-csvs')
      .download(filePath);

    if (downloadError) {
      console.error('Download error:', downloadError);
      throw new Error(`Failed to download CSV: ${downloadError.message}`);
    }

    // Parse CSV
    const csvText = await fileData.text();
    const lines = csvText.split('\n');
    
    console.log(`Processing ${lines.length} lines`);
    
    // Log first few lines for debugging
    console.log('First 3 lines:', lines.slice(0, 3));

    // Parse header to identify all columns
    let headerColumns: string[] = [];
    let startLineIndex = 0; // Track where data rows start
    
    if (lines.length > 0 && headerRowNumber > 0) {
      const headerLine = lines[headerRowNumber - 1].trim();
      if (separator === ' ') {
        headerColumns = headerLine.split(/\s+/).filter(col => col.trim());
      } else {
        const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const splitRegex = new RegExp(escapedSeparator + '+');
        headerColumns = headerLine.split(splitRegex).filter(col => col.trim());
      }
      console.log(`Header columns (${headerColumns.length}):`, headerColumns);
      startLineIndex = headerRowNumber; // Skip header row(s) when processing data
    } else {
      console.log('No header row - all rows will be treated as data');
    }

    // Skip duplicate check - users manage their own data cleanup
    const existingTimestamps = new Set();

    // Process rows
    const readings: any[] = [];
    let skipped = 0;
    let parseErrors = 0;
    const errors: string[] = [];
    let rowIndexForInterval = 0; // Track row index for interval-based timestamps

    for (let i = startLineIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split by the specified separator (multiple consecutive separators treated as one)
      let columns: string[];
      if (separator === ' ') {
        // For space: split by one or more spaces
        columns = line.split(/\s+/).filter(col => col.trim());
      } else {
        // For other separators: split by one or more occurrences
        const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const splitRegex = new RegExp(escapedSeparator + '+');
        columns = line.split(splitRegex).filter(col => col.trim());
      }
      
      // Log first data row for debugging
      if (i === startLineIndex) {
        console.log(`First data row columns (${columns.length}):`, columns);
      }
      
      if (columns.length < 2) continue;

      try {
        // Handle different column layouts
        let dateStr, timeStr, valueStr, kvaStr = null;
        const extraFields: Record<string, any> = {};
        
        // Use column mapping if provided
        if (columnMapping) {
          // Helper function to get column value, handling splits
          const getColumnValue = (columnId: string | number): string | null => {
            if (typeof columnId === 'number') {
              // Regular column
              return columns[columnId]?.trim() || null;
            }
            
            // Split column - format: "colIdx_split_partIdx"
            const parts = columnId.toString().split('_');
            if (parts[0] && parts[1] === 'split' && parts[2]) {
              const colIdx = parseInt(parts[0]);
              const partIdx = parseInt(parts[2]);
              const value = columns[colIdx]?.trim();
              
              if (!value) return null;
              
              // Find the split config for this column
              const splitConfig = columnMapping.splitColumns?.[colIdx];
              if (splitConfig) {
                const sepChar = 
                  splitConfig.separator === "space" ? " " :
                  splitConfig.separator === "comma" ? "," :
                  splitConfig.separator === "dash" ? "-" :
                  splitConfig.separator === "slash" ? "/" : ":";
                const splitParts = value.split(sepChar);
                return splitParts[partIdx] || null;
              }
            }
            
            return null;
          };
          
          dateStr = getColumnValue(columnMapping.dateColumn);
          timeStr = columnMapping.timeColumn >= 0 ? getColumnValue(columnMapping.timeColumn) : null;
          valueStr = getColumnValue(columnMapping.valueColumn)?.replace(',', '.');
          kvaStr = columnMapping.kvaColumn >= 0 ? getColumnValue(columnMapping.kvaColumn)?.replace(',', '.') : null;
          
          // Capture extra columns (with renamed headers if provided)
          for (let colIdx = 0; colIdx < columns.length; colIdx++) {
            const splitConfig = columnMapping.splitColumns?.[colIdx];
            
            if (splitConfig) {
              // Handle split columns - each part might be used elsewhere or be metadata
              splitConfig.parts.forEach((part: any, partIdx: number) => {
                const isUsedAsCore = 
                  part.columnId === columnMapping.dateColumn ||
                  part.columnId === columnMapping.timeColumn ||
                  part.columnId === columnMapping.valueColumn ||
                  part.columnId === columnMapping.kvaColumn;
                
                if (!isUsedAsCore) {
                  const colValue = getColumnValue(part.columnId);
                  if (colValue && colValue !== '' && colValue !== '-') {
                    const colName = part.name || `Column_${colIdx}_Part_${partIdx}`;
                    const numValue = parseFloat(colValue.replace(',', '.'));
                    extraFields[colName] = isNaN(numValue) ? colValue : numValue;
                  }
                }
              });
            } else {
              // Regular column - skip if used as a core field
              if (colIdx === columnMapping.dateColumn || 
                  colIdx === columnMapping.timeColumn || 
                  colIdx === columnMapping.valueColumn || 
                  colIdx === columnMapping.kvaColumn) {
                continue;
              }
              
              const colValue = columns[colIdx]?.trim();
              if (colValue && colValue !== '' && colValue !== '-') {
                // Use renamed header if available, otherwise use original header
                const colName = columnMapping.renamedHeaders?.[colIdx] || headerColumns[colIdx] || `Column_${colIdx + 1}`;
                const numValue = parseFloat(colValue.replace(',', '.'));
                extraFields[colName] = isNaN(numValue) ? colValue : numValue;
              }
            }
          }
        } else if (columns.length === 2) {
          // Format: DateTime Value
          dateStr = columns[0]?.trim();
          valueStr = columns[1]?.trim()?.replace(',', '.');
          timeStr = null;
        } else {
          // Format: Date Time Value [Extra Columns...]
          dateStr = columns[0]?.trim();
          timeStr = columns[1]?.trim();
          valueStr = columns[2]?.trim()?.replace(',', '.');
          
          // Capture all extra columns beyond the first 3
          for (let colIdx = 3; colIdx < columns.length; colIdx++) {
            const colValue = columns[colIdx]?.trim();
            if (colValue && colValue !== '' && colValue !== '-') {
              const colName = headerColumns[colIdx] || `Column_${colIdx + 1}`;
              
              // Check if this is the kVA column
              const colNameLower = colName.toLowerCase();
              if (colNameLower.includes('kva') || colNameLower === 's (kva)') {
                kvaStr = colValue.replace(',', '.');
                continue; // Don't add to extraFields, it's a core field
              }
              
              // Try to parse as number, otherwise store as string
              const numValue = parseFloat(colValue.replace(',', '.'));
              extraFields[colName] = isNaN(numValue) ? colValue : numValue;
            }
          }
        }

        if (!dateStr || !valueStr) continue;

        let date: Date;
        
        // Check if dateStr contains both date and time (combined format)
        if (!timeStr && (dateStr.includes(' ') || dateStr.includes('T'))) {
          // Combined DateTime format (e.g., "2025-04-01 12:30:00" or "2025-04-01T12:30:00")
          date = new Date(dateStr.replace(' ', 'T'));
          if (!isNaN(date.getTime())) {
            rowIndexForInterval++; // Increment counter even when time is present
          }
        } else {
          // Separate date and time columns
          const dateParts = dateStr.split(/[\/\- ]/);
          if (dateParts.length < 3) {
            if (errors.length < 5) errors.push(`Line ${i + 1}: Invalid date format "${dateStr}"`);
            parseErrors++;
            continue;
          }

          let year: number, month: number, day: number;
          
          // Determine date format based on user selection
          if (dateFormat === "YYYY-MM-DD") {
            // YYYY/MM/DD or YYYY-MM-DD
            [year, month, day] = dateParts.map(Number);
          } else if (dateFormat === "DD/MM/YYYY") {
            // DD/MM/YYYY
            [day, month, year] = dateParts.map(Number);
          } else if (dateFormat === "MM/DD/YYYY") {
            // MM/DD/YYYY
            [month, day, year] = dateParts.map(Number);
          } else {
            // Auto-detect
            if (parseInt(dateParts[0]) > 31) {
              // YYYY/MM/DD or YYYY-MM-DD
              [year, month, day] = dateParts.map(Number);
            } else if (parseInt(dateParts[1]) > 12) {
              // DD/MM/YYYY (day in second position is > 12, so must be day)
              [day, month, year] = dateParts.map(Number);
            } else {
              // Assume DD/MM/YYYY as default for ambiguous dates
              [day, month, year] = dateParts.map(Number);
            }
          }

          // Parse time - handle both HH:MM:SS and decimal formats, or use interval-based calculation
          let hours = 0, minutes = 0, seconds = 0;
          
          if (timeStr) {
            if (timeStr.includes(':')) {
              // HH:MM:SS or HH:MM format
              const timeParts = timeStr.split(':');
              [hours, minutes, seconds = 0] = timeParts.map(Number);
            } else {
              // Decimal format (e.g., 0.5 = 12 hours, 0.04166667 = 1 hour)
              const decimalTime = parseFloat(timeStr);
              if (isNaN(decimalTime)) {
                if (errors.length < 5) errors.push(`Line ${i + 1}: Invalid time format "${timeStr}"`);
                parseErrors++;
                continue;
              }
              
              // Convert decimal days to hours/minutes/seconds
              const totalSeconds = decimalTime * 24 * 60 * 60;
              hours = Math.floor(totalSeconds / 3600);
              minutes = Math.floor((totalSeconds % 3600) / 60);
              seconds = Math.floor(totalSeconds % 60);
            }
          } else {
            // No time column - use interval-based calculation
            const totalMinutes = rowIndexForInterval * timeInterval;
            hours = Math.floor(totalMinutes / 60);
            minutes = totalMinutes % 60;
            rowIndexForInterval++; // Increment for next row
          }

          // Create date
          date = new Date(year, month - 1, day, hours, minutes, seconds);
        }

        if (isNaN(date.getTime())) {
          if (errors.length < 5) errors.push(`Line ${i + 1}: Invalid date/time`);
          parseErrors++;
          continue;
        }

        const value = parseFloat(valueStr);
        if (isNaN(value)) {
          if (errors.length < 5) errors.push(`Line ${i + 1}: Invalid value "${valueStr}"`);
          parseErrors++;
          continue;
        }

        // Parse kVA value if present
        const kvaValue = kvaStr ? parseFloat(kvaStr) : null;

        const isoTimestamp = date.toISOString();

        // Skip duplicates
        if (existingTimestamps.has(isoTimestamp)) {
          skipped++;
          continue;
        }

        // Build metadata object
        const metadata: any = {
          source_file: fileName,
          imported_at: new Date().toISOString(),
        };
        
        // Only add imported_fields if there are extra columns
        if (Object.keys(extraFields).length > 0) {
          metadata.imported_fields = extraFields;
        }

        readings.push({
          meter_id: meterId,
          reading_timestamp: isoTimestamp,
          kwh_value: value,
          kva_value: kvaValue,
          metadata: metadata,
        });
      } catch (err: any) {
        if (errors.length < 5) errors.push(`Line ${i + 1}: ${err?.message || String(err)}`);
        parseErrors++;
      }
    }

    console.log(`Parsed: ${readings.length} valid, ${skipped} duplicates, ${parseErrors} errors`);
    if (errors.length > 0) {
      console.log('Sample errors:', errors);
    }

    // Insert in batches
    if (readings.length > 0) {
      const batchSize = 1000;
      let inserted = 0;

      for (let i = 0; i < readings.length; i += batchSize) {
        const batch = readings.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('meter_readings')
          .insert(batch);

        if (insertError) {
          console.error('Insert error:', insertError);
          throw new Error(`Insert failed at batch ${i}: ${insertError.message}`);
        }

        inserted += batch.length;
        console.log(`Inserted batch: ${inserted}/${readings.length}`);
      }
    }

    // Update the tracking table with parse results
    const { error: updateError } = await supabase
      .from('meter_csv_files')
      .update({
        parse_status: 'parsed',
        parsed_at: new Date().toISOString(),
        readings_inserted: readings.length,
        duplicates_skipped: skipped,
        parse_errors: parseErrors,
        error_message: errors.length > 0 ? errors.join('; ') : null
      })
      .eq('file_path', filePath);

    if (updateError) {
      console.error('Failed to update file tracking:', updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalLines: lines.length,
        readingsInserted: readings.length,
        duplicatesSkipped: skipped,
        parseErrors,
        sampleErrors: errors,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Function error:', error);
    
    // Update tracking table with error status if we have the filePath
    try {
      const body = await req.clone().json();
      if (body.filePath) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const errorSupabase = createClient(supabaseUrl, supabaseKey);
        
        await errorSupabase
          .from('meter_csv_files')
          .update({
            parse_status: 'error',
            error_message: error?.message || String(error)
          })
          .eq('file_path', body.filePath);
      }
    } catch (updateErr) {
      console.error('Failed to update error status:', updateErr);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

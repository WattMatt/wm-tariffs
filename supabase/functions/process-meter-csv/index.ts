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
      csvFileId,
      meterId, 
      filePath, 
      separator = "\t", 
      dateFormat = "auto", 
      timeInterval = 30, 
      headerRowNumber = 1,
      columnMapping = null 
    } = await req.json();

    // If csvFileId is provided but not filePath, fetch it from the database
    let actualFilePath = filePath;
    if (csvFileId && !actualFilePath) {
      const { data: csvFile, error: fetchError } = await supabase
        .from('meter_csv_files')
        .select('file_path')
        .eq('id', csvFileId)
        .single();
      
      if (fetchError || !csvFile) {
        throw new Error(`Failed to fetch CSV file record: ${fetchError?.message || 'File not found'}`);
      }
      
      actualFilePath = csvFile.file_path;
    }

    if (!actualFilePath) {
      throw new Error('No file path provided and could not fetch from csvFileId');
    }

    console.log(`Processing CSV for meter ${meterId} from ${actualFilePath} with separator "${separator}", dateFormat "${dateFormat}", timeInterval ${timeInterval} minutes, headerRowNumber: ${headerRowNumber}`);
    console.log('Column Mapping:', JSON.stringify(columnMapping, null, 2));

    // Extract filename from path
    const fileName = actualFilePath.split('/').pop() || 'unknown.csv';

    // Download CSV from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('meter-csvs')
      .download(actualFilePath);

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

    // Helper function to parse value based on data type
    const parseByDataType = (value: string, dataType: string): any => {
      if (!value || value.trim() === '' || value === '-') return null;
      
      const cleaned = value.trim().replace(',', '.');
      
      switch (dataType) {
        case 'int':
          const intVal = parseInt(cleaned);
          return isNaN(intVal) ? null : intVal;
        case 'float':
          const floatVal = parseFloat(cleaned);
          return isNaN(floatVal) ? null : floatVal;
        case 'boolean':
          const lowerVal = cleaned.toLowerCase();
          if (lowerVal === 'true' || lowerVal === '1' || lowerVal === 'yes') return true;
          if (lowerVal === 'false' || lowerVal === '0' || lowerVal === 'no') return false;
          return null;
        case 'datetime':
          const dateVal = new Date(cleaned);
          return isNaN(dateVal.getTime()) ? null : dateVal.toISOString();
        case 'string':
        default:
          return value.trim();
      }
    };

    // Helper function to parse datetime according to format
    const parseDateTimeByFormat = (dateTimeStr: string, format: string): Date | null => {
      try {
        // Parse datetime based on format pattern
        const formatPatterns: Record<string, RegExp> = {
          'YYYY-MM-DD HH:mm:ss': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
          'YYYY-MM-DD HH:mm': /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/,
          'DD/MM/YYYY HH:mm:ss': /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
          'DD/MM/YYYY HH:mm': /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/,
          'MM/DD/YYYY HH:mm:ss': /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
          'MM/DD/YYYY HH:mm': /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/,
          'YYYY/MM/DD HH:mm:ss': /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
          'DD-MM-YYYY HH:mm:ss': /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
        };

        const pattern = formatPatterns[format];
        if (!pattern) {
          console.log(`Unknown format: ${format}, falling back to auto-detect`);
          return null;
        }

        const match = dateTimeStr.match(pattern);
        if (!match) {
          console.log(`DateTime string "${dateTimeStr}" doesn't match format "${format}"`);
          return null;
        }

        let year: number, month: number, day: number, hours: number, minutes: number, seconds: number = 0;

        // Extract values based on format
        if (format.startsWith('YYYY-MM-DD') || format.startsWith('YYYY/MM/DD')) {
          [, year, month, day, hours, minutes, seconds = 0] = match.map(Number);
        } else if (format.startsWith('DD/MM/YYYY') || format.startsWith('DD-MM-YYYY')) {
          [, day, month, year, hours, minutes, seconds = 0] = match.map(Number);
        } else if (format.startsWith('MM/DD/YYYY')) {
          [, month, day, year, hours, minutes, seconds = 0] = match.map(Number);
        } else {
          return null;
        }

        // Create date treating input as UTC (no timezone conversion)
        return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
      } catch (err) {
        console.error(`Error parsing datetime: ${(err as Error).message}`);
        return null;
      }
    };

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
            // Handle split columns - format: "colIdx_split_partIdx"
            const colIdStr = columnId.toString();
            const parts = colIdStr.split('_');
            
            if (parts[0] && parts[1] === 'split' && parts[2]) {
              // Split column
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
            } else {
              // Regular column - parse as integer
              const colIdx = typeof columnId === 'number' ? columnId : parseInt(colIdStr);
              if (isNaN(colIdx)) return null;
              return columns[colIdx]?.trim() || null;
            }
            
            return null;
          };
          
          dateStr = getColumnValue(columnMapping.dateColumn);
          timeStr = columnMapping.timeColumn && columnMapping.timeColumn !== "-1" ? getColumnValue(columnMapping.timeColumn) : null;
          valueStr = getColumnValue(columnMapping.valueColumn)?.replace(',', '.');
          kvaStr = columnMapping.kvaColumn && columnMapping.kvaColumn !== "-1" ? getColumnValue(columnMapping.kvaColumn)?.replace(',', '.') : null;
          
          // Log extracted values for first row only
          if (i === startLineIndex) {
            console.log('DIAGNOSTIC - First row extraction:');
            console.log(`  dateColumn: ${columnMapping.dateColumn} -> dateStr: "${dateStr}"`);
            console.log(`  timeColumn: ${columnMapping.timeColumn} -> timeStr: "${timeStr}"`);
            console.log(`  valueColumn: ${columnMapping.valueColumn} -> valueStr: "${valueStr}"`);
            console.log(`  kvaColumn: ${columnMapping.kvaColumn} -> kvaStr: "${kvaStr}"`);
          }
          
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
                    // Get data type for this column, default to auto-detect
                    const dataType = columnMapping.columnDataTypes?.[part.columnId] || 'string';
                    const parsedValue = parseByDataType(colValue, dataType);
                    if (parsedValue !== null) {
                      extraFields[colName] = parsedValue;
                    }
                  }
                }
              });
            } else {
              // Regular column - skip if used as a core field
              const colIdStr = colIdx.toString();
              if (colIdStr === columnMapping.dateColumn || 
                  colIdStr === columnMapping.timeColumn || 
                  colIdStr === columnMapping.valueColumn || 
                  colIdStr === columnMapping.kvaColumn) {
                continue;
              }
              
              const colValue = columns[colIdx]?.trim();
              if (colValue && colValue !== '' && colValue !== '-') {
                // Use renamed header if available, otherwise use original header
                const colName = columnMapping.renamedHeaders?.[colIdx] || headerColumns[colIdx] || `Column_${colIdx + 1}`;
                // Get data type for this column, default to auto-detect
                const dataType = columnMapping.columnDataTypes?.[colIdx.toString()] || 'string';
                const parsedValue = parseByDataType(colValue, dataType);
                if (parsedValue !== null) {
                  extraFields[colName] = parsedValue;
                }
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

        if (!dateStr || !valueStr) {
          if (i === startLineIndex) {
            console.log(`⚠️ SKIPPING FIRST ROW - Missing required fields: dateStr="${dateStr}", valueStr="${valueStr}"`);
          }
          continue;
        }

        let date: Date;
        
        // Check if dateStr contains both date and time (combined format)
        if (!timeStr && (dateStr.includes(' ') || dateStr.includes('T'))) {
          // Combined DateTime format - use user-specified format if available
          const dateTimeFormat = columnMapping?.dateTimeFormat || 'YYYY-MM-DD HH:mm:ss';
          
          // Try parsing with user-specified format first
          const parsedDate = parseDateTimeByFormat(dateStr, dateTimeFormat);
          
          if (parsedDate && !isNaN(parsedDate.getTime())) {
            date = parsedDate;
          } else {
            // Fallback: try ISO format
            const isoDateStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
            date = new Date(isoDateStr);
          }
          
          if (isNaN(date.getTime())) {
            // Fallback: try manual parsing if ISO parse fails
            const dateOnlyStr = dateStr.split(' ')[0] || dateStr.split('T')[0];
            const timeOnlyStr = dateStr.split(' ')[1] || dateStr.split('T')[1] || '00:00:00';
            const dateParts = dateOnlyStr.split(/[\/\-]/);
            const timeParts = timeOnlyStr.split(':');
            
            if (dateParts.length >= 3) {
              let year: number, month: number, day: number;
              
              // Auto-detect date format
              if (parseInt(dateParts[0]) > 31) {
                // YYYY/MM/DD or YYYY-MM-DD
                [year, month, day] = dateParts.map(Number);
              } else if (parseInt(dateParts[1]) > 12) {
                // DD/MM/YYYY
                [day, month, year] = dateParts.map(Number);
              } else {
                // Assume YYYY-MM-DD for ISO format
                [year, month, day] = dateParts.map(Number);
              }
              
              const [hours = 0, minutes = 0, seconds = 0] = timeParts.map(Number);
              
              // Create date treating input as UTC (no timezone conversion)
              date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
            }
          }
          
          rowIndexForInterval++; // Keep counter for logging purposes
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

          // Create date treating input as UTC (no timezone conversion)
          date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
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

        // Add the main value column to extraFields with its renamed header
        if (columnMapping && columnMapping.renamedHeaders && columnMapping.valueColumn) {
          const valueColumnName = columnMapping.renamedHeaders[columnMapping.valueColumn];
          if (valueColumnName) {
            extraFields[valueColumnName] = value;
          }
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

    // Generate and store parsed CSV
    let parsedFilePath: string | null = null;
    try {
      // Create standardized CSV from parsed readings
      const csvHeaders = ['reading_timestamp', 'kwh_value', 'kva_value', 'metadata'];
      const csvRows = readings.map(reading => [
        reading.reading_timestamp,
        reading.kwh_value,
        reading.kva_value || '',
        JSON.stringify(reading.metadata || {})
      ]);
      
      // Generate CSV content
      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(val => {
          // Escape values containing commas or quotes
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(','))
      ].join('\n');
      
      // Generate parsed file path
      const originalFileName = actualFilePath.split('/').pop()?.replace('.csv', '') || 'parsed';
      const parsedFileName = `${originalFileName}_parsed.csv`;
      const tempParsedPath = actualFilePath.replace(fileName, `parsed/${parsedFileName}`);
      
      // Upload parsed CSV to storage
      const { error: uploadError } = await supabase.storage
        .from('meter-csvs')
        .upload(tempParsedPath, new Blob([csvContent], { type: 'text/csv' }), { 
          upsert: true,
          contentType: 'text/csv'
        });
      
      if (uploadError) {
        console.error('Failed to upload parsed CSV:', uploadError);
      } else {
        parsedFilePath = tempParsedPath;
        console.log(`Parsed CSV stored at: ${parsedFilePath}`);
      }
    } catch (parseStoreError) {
      console.error('Error storing parsed CSV:', parseStoreError);
    }

    // Update the tracking table with parse results only if we got here successfully
    const { error: updateError } = await supabase
      .from('meter_csv_files')
      .update({
        parse_status: readings.length > 0 ? 'parsed' : 'error',
        parsed_at: new Date().toISOString(),
        readings_inserted: readings.length,
        duplicates_skipped: skipped,
        parse_errors: parseErrors,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        parsed_file_path: parsedFilePath,
        column_mapping: columnMapping
      })
      .eq('file_path', actualFilePath);

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
    
    // Update tracking table with error status
    try {
      const body = await req.clone().json();
      const pathToUpdate = body.csvFileId ? body.csvFileId : body.filePath;
      if (pathToUpdate) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const errorSupabase = createClient(supabaseUrl, supabaseKey);
        
        const updateQuery = body.csvFileId 
          ? errorSupabase.from('meter_csv_files').update({
              parse_status: 'error',
              error_message: error?.message || String(error)
            }).eq('id', body.csvFileId)
          : errorSupabase.from('meter_csv_files').update({
              parse_status: 'error',
              error_message: error?.message || String(error)
            }).eq('file_path', body.filePath);
        
        await updateQuery;
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

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
      timeInterval = 30, 
      headerRowNumber = 1,
      columnMapping = null,
      targetTable = 'meter_readings'
    } = await req.json();

    // If csvFileId is provided but not filePath, fetch it from the database
    let actualFilePath = filePath;
    let isGeneratedCsv = false;
    
    if (csvFileId && !actualFilePath) {
      const { data: csvFile, error: fetchError } = await supabase
        .from('meter_csv_files')
        .select('file_path, generated_date_from')
        .eq('id', csvFileId)
        .single();
      
      if (fetchError || !csvFile) {
        throw new Error(`Failed to fetch CSV file record: ${fetchError?.message || 'File not found'}`);
      }
      
      actualFilePath = csvFile.file_path;
      isGeneratedCsv = !!csvFile.generated_date_from;
    }

    if (!actualFilePath) {
      throw new Error('No file path provided and could not fetch from csvFileId');
    }

    console.log(`Processing CSV for meter ${meterId} from ${actualFilePath}`);
    console.log(`Separator: "${separator}", timeInterval: ${timeInterval} minutes, headerRowNumber: ${headerRowNumber}`);
    console.log('Column Mapping:', JSON.stringify(columnMapping, null, 2));
    console.log(`Target table: ${targetTable}`);

    // Extract filename from path
    const fileName = actualFilePath.split('/').pop() || 'unknown.csv';

    // Download CSV from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('client-files')
      .download(actualFilePath);

    if (downloadError) {
      console.error('Download error:', downloadError);
      throw new Error(`Failed to download CSV: ${downloadError.message}`);
    }

    // Parse CSV
    const csvText = await fileData.text();
    const lines = csvText.split('\n');
    
    console.log(`Processing ${lines.length} lines`);
    console.log('First 3 lines:', lines.slice(0, 3));

    // Parse header to identify all columns
    let headerColumns: string[] = [];
    let startLineIndex = 0;
    
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
      startLineIndex = headerRowNumber;
    }

    const existingTimestamps = new Set();
    const readings: any[] = [];
    let skipped = 0;
    let parseErrors = 0;
    const errors: string[] = [];
    let rowIndexForInterval = 0;

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
          return null;
        }

        let year: number, month: number, day: number, hours: number, minutes: number, seconds: number = 0;

        if (format.startsWith('YYYY-MM-DD') || format.startsWith('YYYY/MM/DD')) {
          [, year, month, day, hours, minutes, seconds = 0] = match.map(Number);
        } else if (format.startsWith('DD/MM/YYYY') || format.startsWith('DD-MM-YYYY')) {
          [, day, month, year, hours, minutes, seconds = 0] = match.map(Number);
        } else if (format.startsWith('MM/DD/YYYY')) {
          [, month, day, year, hours, minutes, seconds = 0] = match.map(Number);
        } else {
          return null;
        }

        return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
      } catch (err) {
        console.error(`Error parsing datetime: ${(err as Error).message}`);
        return null;
      }
    };

    // Helper function to get split delimiter
    const getSplitDelimiter = (splitType: string): string | RegExp | null => {
      const delimiterMap: Record<string, string | RegExp> = {
        tab: '\t',
        comma: ',',
        semicolon: ';',
        space: /\s+/
      };
      return delimiterMap[splitType] || null;
    };

    // Get datetime column index from column mapping
    const datetimeColumn = columnMapping?.datetimeColumn;
    const datetimeFormat = columnMapping?.datetimeFormat;
    const columnDataTypes = columnMapping?.columnDataTypes || {};
    const renamedHeaders = columnMapping?.renamedHeaders || {};
    const columnSplits = columnMapping?.columnSplits || {};
    const splitColumnNames = columnMapping?.splitColumnNames || {};
    const splitColumnDataTypes = columnMapping?.splitColumnDataTypes || {};

    console.log(`DateTime column: ${datetimeColumn}, format: ${datetimeFormat}`);
    console.log(`Column splits:`, JSON.stringify(columnSplits));
    console.log(`Split column names:`, JSON.stringify(splitColumnNames));
    console.log(`Split column data types:`, JSON.stringify(splitColumnDataTypes));

    for (let i = startLineIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let columns: string[];
      if (separator === ' ') {
        columns = line.split(/\s+/).filter(col => col.trim());
      } else {
        const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const splitRegex = new RegExp(escapedSeparator + '+');
        columns = line.split(splitRegex).filter(col => col.trim());
      }
      
      if (i === startLineIndex) {
        console.log(`First data row columns (${columns.length}):`, columns);
      }
      
      if (columns.length < 1) continue;

      try {
        let dateTimeStr: string | null = null;
        const importedFields: Record<string, any> = {};

        // Extract datetime from the specified column
        if (datetimeColumn !== null && datetimeColumn !== undefined) {
          const dtColIdx = typeof datetimeColumn === 'string' ? parseInt(datetimeColumn) : datetimeColumn;
          dateTimeStr = columns[dtColIdx]?.trim() || null;
        } else {
          // Fallback: use first column as datetime
          dateTimeStr = columns[0]?.trim() || null;
        }

        if (!dateTimeStr) {
          if (errors.length < 5) errors.push(`Line ${i + 1}: No datetime value found`);
          parseErrors++;
          continue;
        }

        // Parse the datetime
        let date: Date | null = null;
        
        if (datetimeFormat) {
          date = parseDateTimeByFormat(dateTimeStr, datetimeFormat);
        }
        
        // Fallback to auto-detect if format parsing failed
        if (!date) {
          // Try ISO format or space-separated datetime
          if (dateTimeStr.includes('T') || dateTimeStr.includes(' ')) {
            const isoStr = dateTimeStr.includes('T') ? dateTimeStr : dateTimeStr.replace(' ', 'T');
            date = new Date(isoStr);
            if (isNaN(date.getTime())) {
              // Manual parsing fallback
              const dateOnlyStr = dateTimeStr.split(' ')[0] || dateTimeStr.split('T')[0];
              const timeOnlyStr = dateTimeStr.split(' ')[1] || dateTimeStr.split('T')[1] || '00:00:00';
              const dateParts = dateOnlyStr.split(/[\/\-]/);
              const timeParts = timeOnlyStr.split(':');
              
              if (dateParts.length >= 3) {
                let year: number, month: number, day: number;
                if (parseInt(dateParts[0]) > 31) {
                  [year, month, day] = dateParts.map(Number);
                } else {
                  [day, month, year] = dateParts.map(Number);
                }
                const [hours = 0, minutes = 0, seconds = 0] = timeParts.map(Number);
                date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
              }
            }
          } else {
            // Just a date, use interval for time
            const dateParts = dateTimeStr.split(/[\/\-]/);
            if (dateParts.length >= 3) {
              let year: number, month: number, day: number;
              if (parseInt(dateParts[0]) > 31) {
                [year, month, day] = dateParts.map(Number);
              } else {
                [day, month, year] = dateParts.map(Number);
              }
              const totalMinutes = rowIndexForInterval * timeInterval;
              const hours = Math.floor(totalMinutes / 60);
              const minutes = totalMinutes % 60;
              date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
              rowIndexForInterval++;
            }
          }
        }

        if (!date || isNaN(date.getTime())) {
          if (errors.length < 5) errors.push(`Line ${i + 1}: Invalid datetime "${dateTimeStr}"`);
          parseErrors++;
          continue;
        }

        const isoTimestamp = date.toISOString();

        // Skip duplicates
        if (existingTimestamps.has(isoTimestamp)) {
          skipped++;
          continue;
        }
        existingTimestamps.add(isoTimestamp);

        // Process ALL columns and store in imported_fields based on data types
        for (let colIdx = 0; colIdx < columns.length; colIdx++) {
          // Skip the datetime column - it's already processed
          if (datetimeColumn !== null && datetimeColumn !== undefined) {
            const dtColIdx = typeof datetimeColumn === 'string' ? parseInt(datetimeColumn) : datetimeColumn;
            if (colIdx === dtColIdx) continue;
          }

          const colValue = columns[colIdx]?.trim();
          if (!colValue || colValue === '' || colValue === '-') continue;

          const colKey = colIdx.toString();
          
          // Check if this column should be split
          const splitType = columnSplits[colIdx] || columnSplits[colKey];
          if (splitType && splitType !== 'none') {
            const delimiter = getSplitDelimiter(splitType);
            if (delimiter) {
              let parts: string[];
              if (delimiter instanceof RegExp) {
                parts = colValue.split(delimiter);
              } else {
                parts = colValue.split(delimiter);
              }
              
              // Process each split part
              for (let partIdx = 0; partIdx < parts.length; partIdx++) {
                const partValue = parts[partIdx]?.trim();
                if (!partValue || partValue === '' || partValue === '-') continue;
                
                const partKey = `${colIdx}-${partIdx}`;
                // Get custom name for this part, or generate default
                const partName = splitColumnNames[partKey] || `${headerColumns[colIdx] || `Column_${colIdx + 1}`}_Part${partIdx + 1}`;
                // Get data type for this part
                const partDataType = splitColumnDataTypes[partKey] || 'string';
                
                // Only store float and int types in imported_fields
                if (partDataType === 'float' || partDataType === 'int') {
                  const parsedValue = parseByDataType(partValue, partDataType);
                  if (parsedValue !== null) {
                    importedFields[partName] = parsedValue;
                  }
                }
              }
            }
          } else {
            // Non-split column - process normally
            // Get the column name (renamed or original)
            const columnName = renamedHeaders[colKey] || headerColumns[colIdx] || `Column_${colIdx + 1}`;
            
            // Get data type for this column
            const dataType = columnDataTypes[colKey] || 'string';
            
            // Only store float and int types in imported_fields
            if (dataType === 'float' || dataType === 'int') {
              const parsedValue = parseByDataType(colValue, dataType);
              if (parsedValue !== null) {
                importedFields[columnName] = parsedValue;
              }
            }
          }
        }

        // Build metadata object
        const metadata: any = {
          source: isGeneratedCsv ? 'hierarchical_aggregation' : 'Parsed',
          source_file: fileName,
          imported_at: new Date().toISOString(),
        };
        
        // Always add imported_fields (even if empty for consistency)
        if (Object.keys(importedFields).length > 0) {
          metadata.imported_fields = importedFields;
        }

        readings.push({
          meter_id: meterId,
          reading_timestamp: isoTimestamp,
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
          .from(targetTable)
          .upsert(batch, { 
            onConflict: 'meter_id,reading_timestamp',
            ignoreDuplicates: false
          });

        if (insertError) {
          console.error('Upsert error:', insertError);
          throw new Error(`Upsert failed at batch ${i} into ${targetTable}: ${insertError.message}`);
        }

        inserted += batch.length;
        console.log(`Upserted batch: ${inserted}/${readings.length} into ${targetTable}`);
      }
    }

    // Generate and store parsed CSV
    let parsedFilePath: string | null = null;
    try {
      // Create standardized CSV from parsed readings
      const csvHeaders = ['reading_timestamp', 'metadata'];
      const csvRows = readings.map(reading => [
        reading.reading_timestamp,
        JSON.stringify(reading.metadata || {})
      ]);
      
      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(val => {
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(','))
      ].join('\n');
      
      const originalFileName = actualFilePath.split('/').pop()?.replace('.csv', '') || 'parsed';
      const parsedFileName = `${originalFileName}_parsed.csv`;
      const tempParsedPath = actualFilePath.replace('/Meters/CSVs/', '/Meters/ParsedCSVs/').replace(fileName, parsedFileName);
      
      const { error: uploadError } = await supabase.storage
        .from('client-files')
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

    // Update the tracking table
    const { error: updateError } = await supabase
      .from('meter_csv_files')
      .update({
        parse_status: readings.length > 0 ? (isGeneratedCsv ? 'generated' : 'parsed') : 'error',
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

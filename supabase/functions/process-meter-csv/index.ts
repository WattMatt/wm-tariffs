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

    const { meterId, filePath, separator = "\t" } = await req.json();

    console.log(`Processing CSV for meter ${meterId} from ${filePath}`);

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

    // Get existing timestamps to avoid duplicates
    const { data: existingReadings } = await supabase
      .from('meter_readings')
      .select('reading_timestamp')
      .eq('meter_id', meterId);

    const existingTimestamps = new Set(
      existingReadings?.map((r) => new Date(r.reading_timestamp).toISOString()) || []
    );

    // Process rows
    const readings: any[] = [];
    let skipped = 0;
    let parseErrors = 0;
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split by the specified separator
      const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const splitRegex = new RegExp(escapedSeparator + '+');
      const columns = line.split(splitRegex).filter(col => col.trim());
      
      // Log first data row for debugging
      if (i === 1) {
        console.log(`First data row columns (${columns.length}):`, columns);
      }
      
      if (columns.length < 2) continue;

      // Skip header rows (check for common header keywords)
      const firstCol = columns[0]?.trim().toLowerCase();
      if (firstCol === 'date' || firstCol === 'time' || firstCol === 'datetime' || 
          firstCol.includes('timestamp') || (i === 0 && /[a-z]/i.test(firstCol))) {
        console.log(`Skipping header at line ${i + 1}: ${line}`);
        continue;
      }

      try {
        // Handle different column layouts
        let dateStr, timeStr, valueStr;
        
        if (columns.length === 2) {
          // Format: DateTime Value
          dateStr = columns[0]?.trim();
          valueStr = columns[1]?.trim()?.replace(',', '.');
          timeStr = null;
        } else {
          // Format: Date Time Value (most common)
          dateStr = columns[0]?.trim();
          timeStr = columns[1]?.trim();
          valueStr = columns[2]?.trim()?.replace(',', '.');
        }

        if (!dateStr || !valueStr) continue;

        let date: Date;
        
        // Check if dateStr contains both date and time (combined format)
        if (!timeStr && (dateStr.includes(' ') || dateStr.includes('T'))) {
          // Combined DateTime format (e.g., "2025-04-01 12:30:00" or "2025-04-01T12:30:00")
          date = new Date(dateStr.replace(' ', 'T'));
        } else {
          // Separate date and time columns
          const dateParts = dateStr.split(/[\/\- ]/);
          if (dateParts.length < 3) {
            if (errors.length < 5) errors.push(`Line ${i + 1}: Invalid date format "${dateStr}"`);
            parseErrors++;
            continue;
          }

          let year: number, month: number, day: number;
          
          // Determine date format
          if (parseInt(dateParts[0]) > 31) {
            // YYYY/MM/DD or YYYY-MM-DD
            [year, month, day] = dateParts.map(Number);
          } else {
            // DD/MM/YYYY
            [day, month, year] = dateParts.map(Number);
          }

          // Parse time - handle both HH:MM:SS and decimal formats
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

        const isoTimestamp = date.toISOString();

        // Skip duplicates
        if (existingTimestamps.has(isoTimestamp)) {
          skipped++;
          continue;
        }

        readings.push({
          meter_id: meterId,
          reading_timestamp: isoTimestamp,
          kwh_value: value,
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

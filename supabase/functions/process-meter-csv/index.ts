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

    const { meterId, filePath } = await req.json();

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

      const columns = line.split(/[,\t]/);
      if (columns.length < 3) continue;

      // Skip header rows
      const firstCol = columns[0]?.trim().toLowerCase();
      if (firstCol === 'date' || firstCol === 'time' || firstCol === 'datetime' || i === 0 && /[a-z]/i.test(firstCol)) {
        continue;
      }

      try {
        const dateStr = columns[0]?.trim();
        const timeStr = columns[1]?.trim();
        const valueStr = columns[2]?.trim()?.replace(',', '.');

        if (!dateStr || !timeStr || !valueStr) continue;

        // Parse date YYYY/MM/DD or YYYY-MM-DD or DD/MM/YYYY
        const dateParts = dateStr.split(/[\/\-]/);
        if (dateParts.length !== 3) {
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

        // Create date
        const date = new Date(year, month - 1, day, hours, minutes, seconds);

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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeleteRequest {
  meterIds: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role for full permissions
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Parse request body
    const { meterIds } = await req.json() as DeleteRequest;

    if (!meterIds || !Array.isArray(meterIds) || meterIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No meter IDs provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`Starting deletion for ${meterIds.length} meters`);

    let totalFilesDeleted = 0;
    let totalReadingsDeleted = 0;

    // Process each meter individually to avoid timeouts
    for (const meterId of meterIds) {
      console.log(`Processing meter: ${meterId}`);

      // Step 1: Get CSV file paths for this meter
      const { data: csvFiles, error: fetchError } = await supabase
        .from('meter_csv_files')
        .select('file_path')
        .eq('meter_id', meterId);
      
      if (fetchError) {
        console.error(`CSV files fetch error for meter ${meterId}:`, fetchError);
        continue; // Continue with next meter instead of failing completely
      }

      const filePaths = csvFiles?.map(f => f.file_path) || [];
      
      // Step 2: Delete files from storage (if any exist)
      if (filePaths.length > 0) {
        const { error } = await supabase.storage
          .from('client-files')
          .remove(filePaths);

        if (error) {
          console.error(`Storage deletion error for meter ${meterId}:`, error);
        } else {
          totalFilesDeleted += filePaths.length;
          console.log(`Deleted ${filePaths.length} files for meter ${meterId}`);
        }
      }

      // Step 3: Delete meter readings for this meter
      const { data: deleteResult, error: deleteError } = await supabase
        .rpc('delete_meter_readings_by_ids', { p_meter_ids: [meterId] });

      if (deleteError) {
        console.error(`Readings delete error for meter ${meterId}:`, deleteError);
      } else {
        const readingsDeleted = deleteResult?.[0]?.total_deleted || 0;
        totalReadingsDeleted += readingsDeleted;
        console.log(`Deleted ${readingsDeleted} readings for meter ${meterId}`);
      }

      // Step 4: Delete CSV file metadata for this meter
      const { error: csvError } = await supabase
        .from('meter_csv_files')
        .delete()
        .eq('meter_id', meterId);

      if (csvError) {
        console.error(`CSV metadata delete error for meter ${meterId}:`, csvError);
      }
    }

    console.log(`Successfully processed ${meterIds.length} meters`);

    return new Response(
      JSON.stringify({ 
        success: true,
        metersProcessed: meterIds.length,
        filesDeleted: totalFilesDeleted,
        readingsDeleted: totalReadingsDeleted
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: errorMessage 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

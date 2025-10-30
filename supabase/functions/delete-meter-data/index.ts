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

    // Step 1: Get all CSV file paths for these meters
    const { data: csvFiles, error: fetchError } = await supabase
      .from('meter_csv_files')
      .select('file_path')
      .in('meter_id', meterIds);
    
    if (fetchError) {
      console.error('CSV files fetch error:', fetchError);
      throw new Error(`Failed to fetch CSV files: ${fetchError.message}`);
    }

    const filePaths = csvFiles?.map(f => f.file_path) || [];
    console.log(`Found ${filePaths.length} CSV files to delete`);

    // Step 2: Delete files from storage (if any exist)
    let deletedFilesCount = 0;
    if (filePaths.length > 0) {
      const { data, error } = await supabase.storage
        .from('meter-csvs')
        .remove(filePaths);

      if (error) {
        console.error('Storage deletion error:', error);
        throw new Error(`Failed to delete files from storage: ${error.message}`);
      }

      deletedFilesCount = filePaths.length;
      console.log(`Deleted ${deletedFilesCount} files from storage`);
    }

    // Step 3: Delete meter readings using database function with extended timeout
    const { data: deleteResult, error: deleteError } = await supabase
      .rpc('delete_meter_readings_by_ids', { p_meter_ids: meterIds });

    if (deleteError) {
      console.error('Readings delete error:', deleteError);
      throw new Error(`Failed to delete readings: ${deleteError.message}`);
    }

    const totalReadingsDeleted = deleteResult?.[0]?.total_deleted || 0;
    console.log(`Successfully deleted ${totalReadingsDeleted} meter readings`);

    // Step 4: Delete CSV file metadata
    const { error: csvError } = await supabase
      .from('meter_csv_files')
      .delete()
      .in('meter_id', meterIds);

    if (csvError) {
      console.error('CSV metadata delete error:', csvError);
      throw new Error(`Failed to delete CSV metadata: ${csvError.message}`);
    }

    console.log(`Successfully deleted all data for ${meterIds.length} meters`);

    return new Response(
      JSON.stringify({ 
        success: true,
        metersProcessed: meterIds.length,
        filesDeleted: deletedFilesCount,
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

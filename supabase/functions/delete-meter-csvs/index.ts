import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeleteRequest {
  filePaths: string[];
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
    const { filePaths } = await req.json() as DeleteRequest;

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No file paths provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`Attempting to delete ${filePaths.length} files from meter-csvs bucket`);
    console.log('File paths:', filePaths);

    // Delete files from storage using service role (bypasses RLS)
    const { data, error } = await supabase.storage
      .from('meter-csvs')
      .remove(filePaths);

    if (error) {
      console.error('Storage deletion error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to delete files',
          details: error.message,
          failedPaths: filePaths
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`Successfully deleted ${filePaths.length} files`);
    console.log('Deletion response:', data);

    return new Response(
      JSON.stringify({ 
        success: true,
        deletedCount: filePaths.length,
        deletedPaths: filePaths
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

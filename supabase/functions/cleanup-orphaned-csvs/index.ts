import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CleanupRequest {
  siteId: string;
  clientName: string;
  siteName: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { siteId, clientName, siteName } = await req.json() as CleanupRequest;

    if (!siteId || !clientName || !siteName) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: siteId, clientName, siteName' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`Cleaning up orphaned CSVs for site: ${siteName} (${siteId})`);

    // Build the storage folder path
    const storagePath = `${clientName}/${siteName}/Metering/Meters/CSVs`;
    console.log(`Storage path: ${storagePath}`);

    // List all files in the CSVs folder
    const { data: files, error: listError } = await supabase.storage
      .from('client-files')
      .list(storagePath);

    if (listError) {
      console.error('Error listing storage folder:', listError);
      return new Response(
        JSON.stringify({ error: 'Failed to list storage folder', details: listError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (!files || files.length === 0) {
      console.log('No files found in storage folder');
      return new Response(
        JSON.stringify({ success: true, message: 'No files found to clean up', deletedCount: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`Found ${files.length} files in storage`);

    // Get all file paths that are tracked in the database for this site
    const { data: trackedFiles, error: dbError } = await supabase
      .from('meter_csv_files')
      .select('file_path')
      .eq('site_id', siteId);

    if (dbError) {
      console.error('Error fetching tracked files:', dbError);
    }

    const trackedPaths = new Set(trackedFiles?.map(f => f.file_path) || []);
    console.log(`Found ${trackedPaths.size} tracked files in database`);

    // Find orphaned files (in storage but not in database)
    const orphanedFilePaths: string[] = [];
    for (const file of files) {
      if (file.name && !file.name.startsWith('.')) { // Skip hidden/placeholder files
        const fullPath = `${storagePath}/${file.name}`;
        if (!trackedPaths.has(fullPath)) {
          orphanedFilePaths.push(fullPath);
        }
      }
    }

    console.log(`Found ${orphanedFilePaths.length} orphaned files to delete`);

    if (orphanedFilePaths.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No orphaned files found', deletedCount: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Delete orphaned files
    const { error: deleteError } = await supabase.storage
      .from('client-files')
      .remove(orphanedFilePaths);

    if (deleteError) {
      console.error('Error deleting orphaned files:', deleteError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to delete some files', 
          details: deleteError.message,
          attemptedCount: orphanedFilePaths.length 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`Successfully deleted ${orphanedFilePaths.length} orphaned files`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Deleted ${orphanedFilePaths.length} orphaned files`,
        deletedCount: orphanedFilePaths.length,
        deletedPaths: orphanedFilePaths
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

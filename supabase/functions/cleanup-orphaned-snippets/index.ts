import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CleanupRequest {
  folderPath: string;
  bucket?: 'client-files' | 'tariff-files';
}

const ALLOWED_BUCKETS = ['client-files', 'tariff-files'] as const;

Deno.serve(async (req) => {
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

    const { folderPath, bucket = 'client-files' } = await req.json() as CleanupRequest;

    if (!folderPath) {
      return new Response(
        JSON.stringify({ error: 'folderPath is required' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    if (!ALLOWED_BUCKETS.includes(bucket as typeof ALLOWED_BUCKETS[number])) {
      return new Response(
        JSON.stringify({ error: `Invalid bucket. Allowed: ${ALLOWED_BUCKETS.join(', ')}` }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    console.log(`Starting cleanup for folder: ${folderPath} in bucket: ${bucket}`);

    // Use database function to delete files directly from storage.objects
    // This is more reliable than using the Storage API list() which can miss files
    const { data: deleteResult, error: deleteError } = await supabase.rpc('delete_storage_folder', {
      p_bucket_id: bucket,
      p_folder_path: folderPath
    });

    if (deleteError) {
      console.error('Error deleting storage folder:', deleteError);
      throw new Error(`Failed to delete storage folder: ${deleteError.message}`);
    }

    const filesDeleted = deleteResult?.[0]?.deleted_count || 0;
    console.log(`Deleted ${filesDeleted} files from storage using direct database query`);

    let databaseReferencesRemoved = 0;

    // Only clean database references for client-files bucket (tariff-files doesn't have DB refs)
    if (bucket === 'client-files') {
      // Build public URLs pattern for searching in database
      const urlPrefix = `${supabaseUrl}/storage/v1/object/public/${bucket}/${folderPath}`;
      
      // Clean meters table references (scanned_snippet_url)
      console.log('Cleaning meters table references...');
      const { data: metersData, error: metersError } = await supabase
        .from('meters')
        .update({ scanned_snippet_url: null })
        .like('scanned_snippet_url', `${urlPrefix}%`)
        .select('id');
      
      if (!metersError && metersData) {
        databaseReferencesRemoved += metersData.length;
      }
      console.log(`Meters cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

      // Delete from site_documents by file_path
      console.log('Cleaning site_documents by file_path...');
      const { data: docsData1, error: docsError1 } = await supabase
        .from('site_documents')
        .delete()
        .like('file_path', `${folderPath}%`)
        .select('id');
      
      if (!docsError1 && docsData1) {
        databaseReferencesRemoved += docsData1.length;
      }

      // Delete from site_documents by converted_image_path
      console.log('Cleaning site_documents by converted_image_path...');
      const { data: docsData2, error: docsError2 } = await supabase
        .from('site_documents')
        .delete()
        .like('converted_image_path', `${folderPath}%`)
        .select('id');
      
      if (!docsError2 && docsData2) {
        databaseReferencesRemoved += docsData2.length;
      }
      console.log(`Site documents cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

      // Delete from schematics by file_path
      console.log('Cleaning schematics by file_path...');
      const { data: schemData1, error: schemError1 } = await supabase
        .from('schematics')
        .delete()
        .like('file_path', `${folderPath}%`)
        .select('id');
      
      if (!schemError1 && schemData1) {
        databaseReferencesRemoved += schemData1.length;
      }

      // Delete from schematics by converted_image_path
      console.log('Cleaning schematics by converted_image_path...');
      const { data: schemData2, error: schemError2 } = await supabase
        .from('schematics')
        .delete()
        .like('converted_image_path', `${folderPath}%`)
        .select('id');
      
      if (!schemError2 && schemData2) {
        databaseReferencesRemoved += schemData2.length;
      }
      console.log(`Schematics cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

      // Nullify references in clients table (logo_url)
      console.log('Cleaning clients table references...');
      const { data: clientsData, error: clientsError } = await supabase
        .from('clients')
        .update({ logo_url: null })
        .like('logo_url', `${urlPrefix}%`)
        .select('id');
      
      if (!clientsError && clientsData) {
        databaseReferencesRemoved += clientsData.length;
      }
      console.log(`Clients cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

      // Nullify references in settings table (logo_url)
      console.log('Cleaning settings table references...');
      const { data: settingsData, error: settingsError } = await supabase
        .from('settings')
        .update({ logo_url: null })
        .like('logo_url', `${urlPrefix}%`)
        .select('id');
      
      if (!settingsError && settingsData) {
        databaseReferencesRemoved += settingsData.length;
      }
      console.log(`Settings cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);
    } else {
      console.log(`Skipping database cleanup for ${bucket} bucket (no DB references)`);
    }

    console.log(`Cleanup complete. Bucket: ${bucket}, Files deleted: ${filesDeleted}, DB refs removed: ${databaseReferencesRemoved}`);

    return new Response(
      JSON.stringify({
        success: true,
        bucket,
        folderPath,
        filesDeleted,
        databaseReferencesRemoved
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Error in cleanup function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to cleanup snippets';
    return new Response(
      JSON.stringify({ 
        error: errorMessage
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

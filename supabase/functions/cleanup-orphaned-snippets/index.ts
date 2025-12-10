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

    // List all files in the specified folder (recursively)
    const allFiles: string[] = [];
    
    async function listFilesRecursively(path: string) {
      const { data: items, error } = await supabase.storage
        .from(bucket)
        .list(path, {
          limit: 1000,
          sortBy: { column: 'name', order: 'asc' }
        });

      if (error) {
        console.error(`Error listing path ${path}:`, error);
        return;
      }

      for (const item of items || []) {
        const fullPath = path ? `${path}/${item.name}` : item.name;
        
        if (item.id === null) {
          // It's a folder, recurse
          await listFilesRecursively(fullPath);
        } else {
          // It's a file
          allFiles.push(fullPath);
        }
      }
    }

    await listFilesRecursively(folderPath);
    
    console.log(`Found ${allFiles.length} files in ${folderPath}`);

    // Build public URLs for the files to search in database
    const fileUrls = allFiles.map(filePath => 
      `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`
    );

    let databaseReferencesRemoved = 0;
    const BATCH_SIZE = 100;

    // Only clean database references for client-files bucket (tariff-files doesn't have DB refs)
    if (bucket === 'client-files') {
      // BATCH: Remove references in meters table (scanned_snippet_url)
      console.log('Cleaning meters table references...');
      for (let i = 0; i < fileUrls.length; i += BATCH_SIZE) {
        const batch = fileUrls.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('meters')
          .update({ scanned_snippet_url: null })
          .in('scanned_snippet_url', batch)
          .select('id');
        
        if (!error && data) {
          databaseReferencesRemoved += data.length;
        }
      }
      console.log(`Meters cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

    // BATCH: Delete from site_documents by file_path
    console.log('Cleaning site_documents by file_path...');
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from('site_documents')
        .delete()
        .in('file_path', batch)
        .select('id');
      
      if (!error && data) {
        databaseReferencesRemoved += data.length;
      }
    }

    // BATCH: Delete from site_documents by converted_image_path
    console.log('Cleaning site_documents by converted_image_path...');
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from('site_documents')
        .delete()
        .in('converted_image_path', batch)
        .select('id');
      
      if (!error && data) {
        databaseReferencesRemoved += data.length;
      }
    }
    console.log(`Site documents cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

    // BATCH: Delete from schematics by file_path
    console.log('Cleaning schematics by file_path...');
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from('schematics')
        .delete()
        .in('file_path', batch)
        .select('id');
      
      if (!error && data) {
        databaseReferencesRemoved += data.length;
      }
    }

    // BATCH: Delete from schematics by converted_image_path
    console.log('Cleaning schematics by converted_image_path...');
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from('schematics')
        .delete()
        .in('converted_image_path', batch)
        .select('id');
      
      if (!error && data) {
        databaseReferencesRemoved += data.length;
      }
    }
      console.log(`Schematics cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

      // BATCH: Nullify references in clients table (logo_url)
      console.log('Cleaning clients table references...');
      for (let i = 0; i < fileUrls.length; i += BATCH_SIZE) {
        const batch = fileUrls.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('clients')
          .update({ logo_url: null })
          .in('logo_url', batch)
          .select('id');
        
        if (!error && data) {
          databaseReferencesRemoved += data.length;
        }
      }
      console.log(`Clients cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);

      // BATCH: Nullify references in settings table (logo_url)
      console.log('Cleaning settings table references...');
      for (let i = 0; i < fileUrls.length; i += BATCH_SIZE) {
        const batch = fileUrls.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('settings')
          .update({ logo_url: null })
          .in('logo_url', batch)
          .select('id');
        
        if (!error && data) {
          databaseReferencesRemoved += data.length;
        }
      }
      console.log(`Settings cleaned. Total refs removed so far: ${databaseReferencesRemoved}`);
    } else {
      console.log(`Skipping database cleanup for ${bucket} bucket (no DB references)`);
    }

    // Delete all files from storage in batches
    console.log('Deleting files from storage...');
    let filesDeleted = 0;
    
    if (allFiles.length > 0) {
      const storageBatchSize = 100;
      for (let i = 0; i < allFiles.length; i += storageBatchSize) {
        const batch = allFiles.slice(i, i + storageBatchSize);
        
        const { error: deleteError } = await supabase.storage
          .from(bucket)
          .remove(batch);

        if (deleteError) {
          console.error(`Error deleting batch ${i / storageBatchSize + 1}:`, deleteError);
        } else {
          filesDeleted += batch.length;
          if (filesDeleted % 500 === 0 || i + storageBatchSize >= allFiles.length) {
            console.log(`Deleted ${filesDeleted}/${allFiles.length} files`);
          }
        }
      }
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

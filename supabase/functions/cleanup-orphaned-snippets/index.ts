import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CleanupRequest {
  folderPath: string;
}

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

    const { folderPath } = await req.json() as CleanupRequest;

    if (!folderPath) {
      return new Response(
        JSON.stringify({ error: 'folderPath is required' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    console.log(`Starting cleanup for folder: ${folderPath}`);

    // List all files in the specified folder (recursively)
    const allFiles: string[] = [];
    
    async function listFilesRecursively(path: string) {
      const { data: items, error } = await supabase.storage
        .from('client-files')
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
      `${supabaseUrl}/storage/v1/object/public/client-files/${filePath}`
    );

    let databaseReferencesRemoved = 0;

    // Search and remove references in meters table (scanned_snippet_url)
    for (const url of fileUrls) {
      const { error: meterError } = await supabase
        .from('meters')
        .update({ scanned_snippet_url: null })
        .eq('scanned_snippet_url', url);
      
      if (!meterError) {
        databaseReferencesRemoved++;
      }
    }

    // Search and remove references in site_documents table (file_path and converted_image_path)
    for (const filePath of allFiles) {
      const { error: docError1 } = await supabase
        .from('site_documents')
        .delete()
        .eq('file_path', filePath);
      
      if (!docError1) {
        databaseReferencesRemoved++;
      }

      const { error: docError2 } = await supabase
        .from('site_documents')
        .delete()
        .eq('converted_image_path', filePath);
      
      if (!docError2) {
        databaseReferencesRemoved++;
      }
    }

    // Search and remove references in schematics table
    for (const filePath of allFiles) {
      const { error: schematicError1 } = await supabase
        .from('schematics')
        .delete()
        .eq('file_path', filePath);
      
      if (!schematicError1) {
        databaseReferencesRemoved++;
      }

      const { error: schematicError2 } = await supabase
        .from('schematics')
        .delete()
        .eq('converted_image_path', filePath);
      
      if (!schematicError2) {
        databaseReferencesRemoved++;
      }
    }

    // Search and nullify references in clients table (logo_url)
    for (const url of fileUrls) {
      const { error: clientError } = await supabase
        .from('clients')
        .update({ logo_url: null })
        .eq('logo_url', url);
      
      if (!clientError) {
        databaseReferencesRemoved++;
      }
    }

    // Search and nullify references in settings table (logo_url)
    for (const url of fileUrls) {
      const { error: settingsError } = await supabase
        .from('settings')
        .update({ logo_url: null })
        .eq('logo_url', url);
      
      if (!settingsError) {
        databaseReferencesRemoved++;
      }
    }

    // Delete all files from storage
    let filesDeleted = 0;
    
    if (allFiles.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);
        
        const { error: deleteError } = await supabase.storage
          .from('client-files')
          .remove(batch);

        if (deleteError) {
          console.error(`Error deleting batch:`, deleteError);
        } else {
          filesDeleted += batch.length;
          console.log(`Deleted batch of ${batch.length} files (${filesDeleted}/${allFiles.length})`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
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

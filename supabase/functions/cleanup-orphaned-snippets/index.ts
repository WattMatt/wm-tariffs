import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CleanupRequest {
  siteId?: string;
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

    const { siteId } = await req.json() as CleanupRequest;

    console.log(`Starting cleanup for site: ${siteId || 'all sites'}`);

    // Get all meter snippet URLs from database
    let query = supabase
      .from('meters')
      .select('scanned_snippet_url');
    
    if (siteId) {
      query = query.eq('site_id', siteId);
    }

    const { data: meters, error: metersError } = await query;
    
    if (metersError) {
      throw metersError;
    }

    // Extract valid snippet paths from database
    const validSnippetPaths = new Set<string>();
    meters?.forEach(meter => {
      if (meter.scanned_snippet_url) {
        const urlParts = meter.scanned_snippet_url.split('/storage/v1/object/public/');
        if (urlParts.length === 2) {
          const [, ...pathParts] = urlParts[1].split('/');
          const filePath = pathParts.join('/');
          if (filePath) {
            validSnippetPaths.add(filePath);
          }
        }
      }
    });

    console.log(`Found ${validSnippetPaths.size} valid snippet references in database`);

    // List all files in client-files bucket that match snippet pattern
    const { data: files, error: listError } = await supabase.storage
      .from('client-files')
      .list('', {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (listError) {
      throw listError;
    }

    // Recursively list all files in the bucket
    const allFiles: string[] = [];
    
    async function listFilesRecursively(path: string = '') {
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
          // It's a file, check if it's a snippet (png in Snippets folder)
          if (fullPath.includes('/Snippets/') && fullPath.endsWith('.png')) {
            allFiles.push(fullPath);
          }
        }
      }
    }

    await listFilesRecursively();
    
    console.log(`Found ${allFiles.length} snippet files in storage`);

    // Find orphaned files
    const orphanedFiles = allFiles.filter(filePath => !validSnippetPaths.has(filePath));
    
    console.log(`Found ${orphanedFiles.length} orphaned snippet files`);

    let deletedCount = 0;
    
    if (orphanedFiles.length > 0) {
      // Delete orphaned files in batches
      const batchSize = 50;
      for (let i = 0; i < orphanedFiles.length; i += batchSize) {
        const batch = orphanedFiles.slice(i, i + batchSize);
        
        const { error: deleteError } = await supabase.storage
          .from('client-files')
          .remove(batch);

        if (deleteError) {
          console.error('Error deleting batch:', deleteError);
        } else {
          deletedCount += batch.length;
          console.log(`Deleted batch of ${batch.length} files`);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        totalSnippetsInStorage: allFiles.length,
        validSnippetsInDatabase: validSnippetPaths.size,
        orphanedSnippets: orphanedFiles.length,
        deletedCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Cleanup error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ 
        error: 'Cleanup failed',
        details: errorMessage 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

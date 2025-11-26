import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CleanupRequest {
  filePattern: string;
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

    const { filePattern } = await req.json() as CleanupRequest;

    if (!filePattern) {
      return new Response(
        JSON.stringify({ error: 'File pattern is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`Searching for files matching pattern: ${filePattern}`);

    // List all files in the bucket (we'll need to paginate for large buckets)
    const { data: files, error: listError } = await supabase
      .storage
      .from('client-files')
      .list('', {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (listError) {
      console.error('Error listing files:', listError);
      return new Response(
        JSON.stringify({ error: 'Failed to list files', details: listError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Recursively search through folders
    async function findMatchingFiles(prefix: string = ''): Promise<string[]> {
      const matchingPaths: string[] = [];
      
      const { data: items, error } = await supabase
        .storage
        .from('client-files')
        .list(prefix, {
          limit: 1000,
        });

      if (error || !items) {
        console.error(`Error listing ${prefix}:`, error);
        return matchingPaths;
      }

      for (const item of items) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        
        // If it's a folder, recurse into it
        if (item.id === null) {
          const subMatches = await findMatchingFiles(fullPath);
          matchingPaths.push(...subMatches);
        } else {
          // Check if this file matches our pattern
          if (item.name.includes(filePattern) && item.name.includes('_snippet_')) {
            matchingPaths.push(fullPath);
            console.log(`Found matching file: ${fullPath}`);
          }
        }
      }

      return matchingPaths;
    }

    const matchingFiles = await findMatchingFiles();

    if (matchingFiles.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No matching files found', deletedCount: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`Found ${matchingFiles.length} files to delete`);

    // Delete files in batches
    const batchSize = 50;
    let totalDeleted = 0;

    for (let i = 0; i < matchingFiles.length; i += batchSize) {
      const batch = matchingFiles.slice(i, i + batchSize);
      const { data, error } = await supabase
        .storage
        .from('client-files')
        .remove(batch);

      if (error) {
        console.error(`Error deleting batch ${i / batchSize + 1}:`, error);
      } else {
        totalDeleted += batch.length;
        console.log(`Deleted batch ${i / batchSize + 1}: ${batch.length} files`);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        deletedCount: totalDeleted,
        filesFound: matchingFiles.length,
        deletedFiles: matchingFiles
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

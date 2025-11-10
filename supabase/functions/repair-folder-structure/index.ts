import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FolderRecord {
  id: string;
  file_name: string;
  folder_path: string;
  site_id: string;
  is_folder: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { siteId } = await req.json();

    if (!siteId) {
      throw new Error('Site ID is required');
    }

    console.log(`Starting folder repair for site: ${siteId}`);

    // Get all documents for this site
    const { data: documents, error: fetchError } = await supabaseClient
      .from('site_documents')
      .select('*')
      .eq('site_id', siteId);

    if (fetchError) {
      throw fetchError;
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No documents found',
          repaired: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const folders = documents.filter(d => d.is_folder) as FolderRecord[];
    const files = documents.filter(d => !d.is_folder);
    
    console.log(`Found ${folders.length} folders and ${files.length} files`);

    // Build a map of correct folder paths
    const folderPathMap = new Map<string, string>();
    const repairedFolders: string[] = [];

    // First pass: identify root folders and build correct paths
    for (const folder of folders) {
      const currentFullPath = folder.folder_path 
        ? `${folder.folder_path}/${folder.file_name}` 
        : folder.file_name;
      
      // Check if this folder's path is corrupted
      // A folder is corrupted if its folder_path contains its own file_name
      const isCorrupted = folder.folder_path.includes(folder.file_name) ||
                         folder.folder_path === currentFullPath;

      if (isCorrupted) {
        console.log(`Found corrupted folder: ${folder.file_name} with path: ${folder.folder_path}`);
        
        // Try to determine the correct parent path
        // If folder_path is "May 2025" and file_name is "March 2025",
        // the correct parent should likely be empty (root) or the actual parent folder name
        
        // For now, set to root - user can manually organize later
        const correctParentPath = '';
        
        console.log(`Repairing folder "${folder.file_name}" from path "${folder.folder_path}" to "${correctParentPath}"`);
        
        const { error: updateError } = await supabaseClient
          .from('site_documents')
          .update({ folder_path: correctParentPath })
          .eq('id', folder.id);

        if (updateError) {
          console.error(`Error updating folder ${folder.file_name}:`, updateError);
        } else {
          repairedFolders.push(folder.file_name);
          folderPathMap.set(currentFullPath, folder.file_name);
        }
      } else {
        folderPathMap.set(currentFullPath, currentFullPath);
      }
    }

    // Second pass: fix any files/subfolders that reference the old corrupted paths
    const updatedDocuments: string[] = [];
    
    for (const doc of [...files, ...folders]) {
      let needsUpdate = false;
      let newPath = doc.folder_path;

      // Check if this document's folder_path references a corrupted folder
      folderPathMap.forEach((newFolderPath, oldFolderPath) => {
        if (doc.folder_path === oldFolderPath || doc.folder_path.startsWith(`${oldFolderPath}/`)) {
          newPath = doc.folder_path.replace(oldFolderPath, newFolderPath);
          needsUpdate = true;
        }
      });

      if (needsUpdate && newPath !== doc.folder_path) {
        console.log(`Updating document "${doc.file_name}" path from "${doc.folder_path}" to "${newPath}"`);
        
        const { error: updateError } = await supabaseClient
          .from('site_documents')
          .update({ folder_path: newPath })
          .eq('id', doc.id);

        if (updateError) {
          console.error(`Error updating document ${doc.file_name}:`, updateError);
        } else {
          updatedDocuments.push(doc.file_name);
        }
      }
    }

    const response = {
      success: true,
      message: `Repair complete: ${repairedFolders.length} folders repaired, ${updatedDocuments.length} documents updated`,
      repairedFolders,
      updatedDocuments,
    };

    console.log('Repair summary:', response);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in repair-folder-structure:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { siteId } = await req.json();
    
    if (!siteId) {
      return new Response(
        JSON.stringify({ error: 'siteId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Syncing storage files for site ${siteId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get site info to build the storage path
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .select('name, clients(name)')
      .eq('id', siteId)
      .single();

    if (siteError || !siteData) {
      throw new Error('Site not found');
    }

    const clientName = (siteData.clients as any).name;
    const siteName = siteData.name;
    const storagePath = `${clientName}/${siteName}/Metering/Schematics`;

    console.log('Storage path:', storagePath);

    // List all files in the schematics folder
    const { data: files, error: listError } = await supabase
      .storage
      .from('client-files')
      .list(storagePath);

    if (listError) {
      console.error('Error listing files:', listError);
      throw new Error('Failed to list storage files');
    }

    console.log(`Found ${files?.length || 0} files in storage`);

    // Get existing schematics in database
    const { data: existingSchematics, error: dbError } = await supabase
      .from('schematics')
      .select('id, name, file_path, file_type')
      .eq('site_id', siteId);

    if (dbError) {
      throw new Error('Failed to fetch existing schematics');
    }

    const existingPaths = new Set(existingSchematics?.map(s => s.file_path) || []);
    const storageFilePaths = new Set(files?.map(f => `${storagePath}/${f.name}`) || []);

    // Find files in storage that aren't in database
    const filesToAdd = files?.filter(file => {
      const fullPath = `${storagePath}/${file.name}`;
      return !existingPaths.has(fullPath);
    }) || [];

    // Find database records that don't have files in storage
    const recordsToRemove = existingSchematics?.filter(schematic => {
      return !storageFilePaths.has(schematic.file_path);
    }) || [];

    console.log(`Files to add: ${filesToAdd.length}`);
    console.log(`Records to remove: ${recordsToRemove.length}`);

    // Add missing database records
    const addedRecords = [];
    for (const file of filesToAdd) {
      const fullPath = `${storagePath}/${file.name}`;
      
      // Determine file type
      let fileType = 'application/octet-stream';
      if (file.name.endsWith('.pdf')) fileType = 'application/pdf';
      else if (file.name.endsWith('.png')) fileType = 'image/png';
      else if (file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')) fileType = 'image/jpeg';
      else if (file.name.endsWith('.svg')) fileType = 'image/svg+xml';

      // Extract name from filename (remove timestamp prefix if present)
      const nameParts = file.name.split('-');
      const displayName = nameParts.length > 1 ? nameParts.slice(1).join('-') : file.name;

      const { data: newSchematic, error: insertError } = await supabase
        .from('schematics')
        .insert({
          site_id: siteId,
          name: displayName,
          file_path: fullPath,
          file_type: fileType,
          total_pages: 1,
        })
        .select()
        .single();

      if (!insertError && newSchematic) {
        addedRecords.push(newSchematic);
        console.log('Added schematic:', displayName);
      } else {
        console.error('Failed to add schematic:', insertError);
      }
    }

    // Remove orphaned database records
    const removedRecords = [];
    for (const record of recordsToRemove) {
      const { error: deleteError } = await supabase
        .from('schematics')
        .delete()
        .eq('id', record.id);

      if (!deleteError) {
        removedRecords.push(record);
        console.log('Removed orphaned schematic:', record.name);
      } else {
        console.error('Failed to remove schematic:', deleteError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        added: addedRecords.length,
        removed: removedRecords.length,
        total: files?.length || 0,
        addedRecords,
        removedRecords,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync-storage-schematics:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Failed to sync storage',
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

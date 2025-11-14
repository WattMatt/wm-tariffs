import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupResult {
  bucket: string;
  totalRecords: number;
  invalidRecords: number;
  cleanedRecords: number;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results: CleanupResult[] = [];

    // 1. Clean up schematics with invalid file_path
    console.log('🔍 Checking schematics...');
    const schematicsResult = await cleanupSchematics(supabase);
    results.push(schematicsResult);

    // 2. Clean up meter_csv_files with invalid file_path
    console.log('🔍 Checking meter CSV files...');
    const csvResult = await cleanupMeterCsvFiles(supabase);
    results.push(csvResult);

    // 3. Clean up meters with invalid scanned_snippet_url
    console.log('🔍 Checking meter snippets...');
    const snippetsResult = await cleanupMeterSnippets(supabase);
    results.push(snippetsResult);

    // 4. Clean up site_documents with invalid file_path
    console.log('🔍 Checking site documents...');
    const documentsResult = await cleanupSiteDocuments(supabase);
    results.push(documentsResult);

    console.log('✅ Cleanup complete!');

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          totalTables: results.length,
          totalRecordsCleaned: results.reduce((sum, r) => sum + r.cleanedRecords, 0),
          totalInvalidFound: results.reduce((sum, r) => sum + r.invalidRecords, 0),
        },
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('❌ Cleanup error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function cleanupSchematics(supabase: any): Promise<CleanupResult> {
  const result: CleanupResult = {
    bucket: 'schematics',
    totalRecords: 0,
    invalidRecords: 0,
    cleanedRecords: 0,
    errors: [],
  };

  try {
    const { data: schematics, error } = await supabase
      .from('schematics')
      .select('id, file_path');

    if (error) throw error;
    result.totalRecords = schematics?.length || 0;

    for (const schematic of schematics || []) {
      if (!schematic.file_path) continue;

      const { data, error: storageError } = await supabase.storage
        .from('schematics')
        .list('', { search: schematic.file_path });

      if (storageError || !data || data.length === 0) {
        result.invalidRecords++;
        console.log(`  ❌ Invalid schematic file: ${schematic.file_path}`);
        
        // Delete the schematic record
        const { error: deleteError } = await supabase
          .from('schematics')
          .delete()
          .eq('id', schematic.id);

        if (deleteError) {
          result.errors.push(`Failed to delete schematic ${schematic.id}: ${deleteError.message}`);
        } else {
          result.cleanedRecords++;
        }
      }
    }
  } catch (error: any) {
    result.errors.push(error.message);
  }

  return result;
}

async function cleanupMeterCsvFiles(supabase: any): Promise<CleanupResult> {
  const result: CleanupResult = {
    bucket: 'meter-csvs',
    totalRecords: 0,
    invalidRecords: 0,
    cleanedRecords: 0,
    errors: [],
  };

  try {
    const { data: csvFiles, error } = await supabase
      .from('meter_csv_files')
      .select('id, file_path');

    if (error) throw error;
    result.totalRecords = csvFiles?.length || 0;

    for (const csvFile of csvFiles || []) {
      if (!csvFile.file_path) continue;

      const { data, error: storageError } = await supabase.storage
        .from('meter-csvs')
        .list('', { search: csvFile.file_path });

      if (storageError || !data || data.length === 0) {
        result.invalidRecords++;
        console.log(`  ❌ Invalid CSV file: ${csvFile.file_path}`);
        
        // Delete the CSV file record
        const { error: deleteError } = await supabase
          .from('meter_csv_files')
          .delete()
          .eq('id', csvFile.id);

        if (deleteError) {
          result.errors.push(`Failed to delete CSV file ${csvFile.id}: ${deleteError.message}`);
        } else {
          result.cleanedRecords++;
        }
      }
    }
  } catch (error: any) {
    result.errors.push(error.message);
  }

  return result;
}

async function cleanupMeterSnippets(supabase: any): Promise<CleanupResult> {
  const result: CleanupResult = {
    bucket: 'meter-snippets',
    totalRecords: 0,
    invalidRecords: 0,
    cleanedRecords: 0,
    errors: [],
  };

  try {
    const { data: meters, error } = await supabase
      .from('meters')
      .select('id, scanned_snippet_url')
      .not('scanned_snippet_url', 'is', null);

    if (error) throw error;
    result.totalRecords = meters?.length || 0;

    for (const meter of meters || []) {
      if (!meter.scanned_snippet_url) continue;

      // Extract filename from URL
      const urlParts = meter.scanned_snippet_url.split('/');
      const filename = urlParts[urlParts.length - 1];

      const { data, error: storageError } = await supabase.storage
        .from('meter-snippets')
        .list('', { search: filename });

      if (storageError || !data || data.length === 0) {
        result.invalidRecords++;
        console.log(`  ❌ Invalid meter snippet: ${meter.scanned_snippet_url}`);
        
        // Update meter to remove invalid snippet URL
        const { error: updateError } = await supabase
          .from('meters')
          .update({ scanned_snippet_url: null })
          .eq('id', meter.id);

        if (updateError) {
          result.errors.push(`Failed to update meter ${meter.id}: ${updateError.message}`);
        } else {
          result.cleanedRecords++;
        }
      }
    }
  } catch (error: any) {
    result.errors.push(error.message);
  }

  return result;
}

async function cleanupSiteDocuments(supabase: any): Promise<CleanupResult> {
  const result: CleanupResult = {
    bucket: 'site-documents',
    totalRecords: 0,
    invalidRecords: 0,
    cleanedRecords: 0,
    errors: [],
  };

  try {
    const { data: documents, error } = await supabase
      .from('site_documents')
      .select('id, file_path, is_folder')
      .eq('is_folder', false);

    if (error) throw error;
    result.totalRecords = documents?.length || 0;

    for (const doc of documents || []) {
      if (!doc.file_path) continue;

      const { data, error: storageError } = await supabase.storage
        .from('site-documents')
        .list('', { search: doc.file_path });

      if (storageError || !data || data.length === 0) {
        result.invalidRecords++;
        console.log(`  ❌ Invalid site document: ${doc.file_path}`);
        
        // Delete the site document record
        const { error: deleteError } = await supabase
          .from('site_documents')
          .delete()
          .eq('id', doc.id);

        if (deleteError) {
          result.errors.push(`Failed to delete document ${doc.id}: ${deleteError.message}`);
        } else {
          result.cleanedRecords++;
        }
      }
    }
  } catch (error: any) {
    result.errors.push(error.message);
  }

  return result;
}

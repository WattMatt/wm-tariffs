import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MigrationResult {
  bucket: string;
  totalFiles: number;
  migratedFiles: number;
  errors: string[];
}

// Sanitize folder/file names for storage
const sanitizeName = (name: string): string => {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .replace(/\s+/g, ' ');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const results: MigrationResult[] = [];
    
    console.log('🚀 Starting storage structure migration...');

    // ==================== MIGRATE SCHEMATICS ====================
    console.log('\n📁 Migrating schematics...');
    const schematicsResult: MigrationResult = {
      bucket: 'schematics',
      totalFiles: 0,
      migratedFiles: 0,
      errors: []
    };

    const { data: schematics, error: schematicsError } = await supabase
      .from('schematics')
      .select('id, site_id, file_path, converted_image_path, sites(name, clients(name))');

    if (schematicsError) {
      console.error('Error fetching schematics:', schematicsError);
      schematicsResult.errors.push(schematicsError.message);
    } else if (schematics) {
      schematicsResult.totalFiles = schematics.length;
      
      for (const schematic of schematics) {
        try {
          // Skip if already in new format (contains client/site hierarchy)
          if (schematic.file_path.includes('/')) {
            const pathParts = schematic.file_path.split('/');
            if (pathParts.length > 3) {
              console.log(`  ✓ Skipping ${schematic.file_path} (already migrated)`);
              continue;
            }
          }

          const sites = schematic.sites as any;
          const clientName = sanitizeName(sites.clients.name);
          const siteName = sanitizeName(sites.name);
          const fileName = schematic.file_path.split('/').pop();
          const newPath = `${clientName}/${siteName}/Metering/Schematics/${fileName}`;

          // Copy file to new location
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('schematics')
            .download(schematic.file_path);

          if (downloadError) {
            console.error(`  ❌ Error downloading ${schematic.file_path}:`, downloadError);
            schematicsResult.errors.push(`${schematic.file_path}: ${downloadError.message}`);
            continue;
          }

          // Upload to new location
          const { error: uploadError } = await supabase.storage
            .from('schematics')
            .upload(newPath, fileData!, { contentType: 'application/pdf', upsert: false });

          if (uploadError) {
            console.error(`  ❌ Error uploading to ${newPath}:`, uploadError);
            schematicsResult.errors.push(`${newPath}: ${uploadError.message}`);
            continue;
          }

          // Update database record
          const updateData: any = { file_path: newPath };
          
          // Migrate converted_image_path if it exists
          if (schematic.converted_image_path) {
            const imageFileName = schematic.converted_image_path.split('/').pop();
            updateData.converted_image_path = `${clientName}/${siteName}/Metering/Schematics/${imageFileName}`;
            
            // Copy converted image
            const { data: imageData, error: imageDownloadError } = await supabase.storage
              .from('schematics')
              .download(schematic.converted_image_path);

            if (!imageDownloadError && imageData) {
              await supabase.storage
                .from('schematics')
                .upload(updateData.converted_image_path, imageData, { contentType: 'image/png', upsert: false });
            }
          }

          await supabase
            .from('schematics')
            .update(updateData)
            .eq('id', schematic.id);

          // Delete old file
          await supabase.storage
            .from('schematics')
            .remove([schematic.file_path]);

          if (schematic.converted_image_path) {
            await supabase.storage
              .from('schematics')
              .remove([schematic.converted_image_path]);
          }

          schematicsResult.migratedFiles++;
          console.log(`  ✓ Migrated: ${schematic.file_path} → ${newPath}`);
        } catch (err) {
          console.error(`  ❌ Error migrating ${schematic.file_path}:`, err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          schematicsResult.errors.push(`${schematic.file_path}: ${errorMsg}`);
        }
      }
    }
    results.push(schematicsResult);

    // ==================== MIGRATE CSV FILES ====================
    console.log('\n📊 Migrating CSV files...');
    const csvResult: MigrationResult = {
      bucket: 'meter-csvs',
      totalFiles: 0,
      migratedFiles: 0,
      errors: []
    };

    const { data: csvFiles, error: csvError } = await supabase
      .from('meter_csv_files')
      .select('id, site_id, meter_id, file_path, meters(meter_number), sites(name, clients(name))');

    if (csvError) {
      console.error('Error fetching CSV files:', csvError);
      csvResult.errors.push(csvError.message);
    } else if (csvFiles) {
      csvResult.totalFiles = csvFiles.length;
      
      for (const csvFile of csvFiles) {
        try {
          // Skip if already in new format
          if (csvFile.file_path.includes('/Meters/')) {
            console.log(`  ✓ Skipping ${csvFile.file_path} (already migrated)`);
            continue;
          }

          const sites = csvFile.sites as any;
          const clientName = sanitizeName(sites.clients.name);
          const siteName = sanitizeName(sites.name);
          const meters = csvFile.meters as any;
          const meterNumber = sanitizeName(meters.meter_number);
          const fileName = csvFile.file_path.split('/').pop();
          const newPath = `${clientName}/${siteName}/Metering/Meters/${meterNumber}/${fileName}`;

          // Copy file
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('meter-csvs')
            .download(csvFile.file_path);

          if (downloadError) {
            console.error(`  ❌ Error downloading ${csvFile.file_path}:`, downloadError);
            csvResult.errors.push(`${csvFile.file_path}: ${downloadError.message}`);
            continue;
          }

          const { error: uploadError } = await supabase.storage
            .from('meter-csvs')
            .upload(newPath, fileData!, { contentType: 'text/csv', upsert: false });

          if (uploadError) {
            console.error(`  ❌ Error uploading to ${newPath}:`, uploadError);
            csvResult.errors.push(`${newPath}: ${uploadError.message}`);
            continue;
          }

          // Update database
          await supabase
            .from('meter_csv_files')
            .update({ file_path: newPath })
            .eq('id', csvFile.id);

          // Delete old file
          await supabase.storage
            .from('meter-csvs')
            .remove([csvFile.file_path]);

          csvResult.migratedFiles++;
          console.log(`  ✓ Migrated: ${csvFile.file_path} → ${newPath}`);
        } catch (err) {
          console.error(`  ❌ Error migrating ${csvFile.file_path}:`, err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          csvResult.errors.push(`${csvFile.file_path}: ${errorMsg}`);
        }
      }
    }
    results.push(csvResult);

    // ==================== MIGRATE METER SNIPPETS ====================
    console.log('\n🖼️ Migrating meter snippets...');
    const snippetsResult: MigrationResult = {
      bucket: 'meter-snippets',
      totalFiles: 0,
      migratedFiles: 0,
      errors: []
    };

    const { data: meters, error: metersError } = await supabase
      .from('meters')
      .select('id, site_id, meter_number, scanned_snippet_url, sites(name, clients(name))')
      .not('scanned_snippet_url', 'is', null);

    if (metersError) {
      console.error('Error fetching meters with snippets:', metersError);
      snippetsResult.errors.push(metersError.message);
    } else if (meters) {
      snippetsResult.totalFiles = meters.length;
      
      for (const meter of meters) {
        try {
          if (!meter.scanned_snippet_url) continue;

          // Skip if already in new format
          if (meter.scanned_snippet_url.includes('/Meters/')) {
            console.log(`  ✓ Skipping meter ${meter.meter_number} snippet (already migrated)`);
            continue;
          }

          // Extract file path from URL
          const urlParts = meter.scanned_snippet_url.split('/meter-snippets/');
          if (urlParts.length < 2) {
            console.error(`  ❌ Invalid URL format: ${meter.scanned_snippet_url}`);
            continue;
          }
          const oldPath = urlParts[1];

          const sites = meter.sites as any;
          const clientName = sanitizeName(sites.clients.name);
          const siteName = sanitizeName(sites.name);
          const meterNumber = sanitizeName(meter.meter_number);
          const fileName = oldPath.split('/').pop() || `snippet_${Date.now()}.png`;
          const newPath = `${clientName}/${siteName}/Metering/Meters/${meterNumber}/Snippets/${fileName}`;

          // Copy file
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('meter-snippets')
            .download(oldPath);

          if (downloadError) {
            console.error(`  ❌ Error downloading ${oldPath}:`, downloadError);
            snippetsResult.errors.push(`${oldPath}: ${downloadError.message}`);
            continue;
          }

          const { error: uploadError } = await supabase.storage
            .from('meter-snippets')
            .upload(newPath, fileData!, { contentType: 'image/png', upsert: false });

          if (uploadError) {
            console.error(`  ❌ Error uploading to ${newPath}:`, uploadError);
            snippetsResult.errors.push(`${newPath}: ${uploadError.message}`);
            continue;
          }

          // Get new public URL
          const { data: { publicUrl } } = supabase.storage
            .from('meter-snippets')
            .getPublicUrl(newPath);

          // Update database
          await supabase
            .from('meters')
            .update({ scanned_snippet_url: publicUrl })
            .eq('id', meter.id);

          // Delete old file
          await supabase.storage
            .from('meter-snippets')
            .remove([oldPath]);

          snippetsResult.migratedFiles++;
          console.log(`  ✓ Migrated snippet: ${oldPath} → ${newPath}`);
        } catch (err) {
          console.error(`  ❌ Error migrating snippet for meter ${meter.meter_number}:`, err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          snippetsResult.errors.push(`${meter.meter_number}: ${errorMsg}`);
        }
      }
    }
    results.push(snippetsResult);

    // ==================== MIGRATE REPORTS ====================
    console.log('\n📄 Migrating reconciliation reports...');
    const reportsResult: MigrationResult = {
      bucket: 'site-documents',
      totalFiles: 0,
      migratedFiles: 0,
      errors: []
    };

    const { data: reports, error: reportsError } = await supabase
      .from('site_documents')
      .select('id, site_id, file_path, file_name, sites(name, clients(name))')
      .eq('document_type', 'report');

    if (reportsError) {
      console.error('Error fetching reports:', reportsError);
      reportsResult.errors.push(reportsError.message);
    } else if (reports) {
      reportsResult.totalFiles = reports.length;
      
      for (const report of reports) {
        try {
          // Skip if already in new format
          if (report.file_path.includes('/Reconciliation/')) {
            console.log(`  ✓ Skipping ${report.file_path} (already migrated)`);
            continue;
          }

          const sites = report.sites as any;
          const clientName = sanitizeName(sites.clients.name);
          const siteName = sanitizeName(sites.name);
          const newPath = `${clientName}/${siteName}/Reconciliation/${report.file_name}`;

          // Copy file
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('site-documents')
            .download(report.file_path);

          if (downloadError) {
            console.error(`  ❌ Error downloading ${report.file_path}:`, downloadError);
            reportsResult.errors.push(`${report.file_path}: ${downloadError.message}`);
            continue;
          }

          const { error: uploadError } = await supabase.storage
            .from('site-documents')
            .upload(newPath, fileData!, { contentType: 'application/pdf', upsert: false });

          if (uploadError) {
            console.error(`  ❌ Error uploading to ${newPath}:`, uploadError);
            reportsResult.errors.push(`${newPath}: ${uploadError.message}`);
            continue;
          }

          // Update database
          await supabase
            .from('site_documents')
            .update({ 
              file_path: newPath,
              folder_path: '/Reconciliation'
            })
            .eq('id', report.id);

          // Delete old file
          await supabase.storage
            .from('site-documents')
            .remove([report.file_path]);

          reportsResult.migratedFiles++;
          console.log(`  ✓ Migrated: ${report.file_path} → ${newPath}`);
        } catch (err) {
          console.error(`  ❌ Error migrating ${report.file_path}:`, err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          reportsResult.errors.push(`${report.file_path}: ${errorMsg}`);
        }
      }
    }
    results.push(reportsResult);

    console.log('\n✅ Migration complete!');
    console.log('Summary:', results);

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        summary: {
          totalFiles: results.reduce((sum, r) => sum + r.totalFiles, 0),
          migratedFiles: results.reduce((sum, r) => sum + r.migratedFiles, 0),
          totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0)
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    console.error('Migration error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

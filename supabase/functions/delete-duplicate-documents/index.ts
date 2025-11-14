import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    console.log('Starting duplicate document deletion...');

    // Get all documents with their extractions that have shop numbers
    const { data: documents, error: fetchError } = await supabase
      .from('site_documents')
      .select(`
        id,
        meter_id,
        file_name,
        file_path,
        upload_date,
        document_extractions (
          extracted_data,
          period_start,
          period_end
        )
      `)
      .not('meter_id', 'is', null)
      .order('upload_date', { ascending: false });

    if (fetchError) {
      console.error('Error fetching documents:', fetchError);
      throw fetchError;
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true,
          duplicatesDeleted: 0,
          message: 'No documents found'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Group documents by meter_id and shop number
    const documentsByMeterAndShop = new Map<string, any[]>();
    
    console.log(`Processing ${documents.length} documents...`);
    
    for (const doc of documents) {
      const extraction = doc.document_extractions?.[0];
      if (!extraction?.extracted_data) {
        console.log(`Document ${doc.id} has no extraction data`);
        continue;
      }
      
      // Check both shopNumber and shop_number (snake_case)
      const shopNumber = extraction.extracted_data.shopNumber || extraction.extracted_data.shop_number;
      if (!shopNumber) {
        console.log(`Document ${doc.id} has no shop number`);
        continue;
      }
      
      const key = `${doc.meter_id}_${shopNumber}`;
      console.log(`Document ${doc.id}: meter=${doc.meter_id}, shop=${shopNumber}`);
      
      if (!documentsByMeterAndShop.has(key)) {
        documentsByMeterAndShop.set(key, []);
      }
      documentsByMeterAndShop.get(key)!.push(doc);
    }

    console.log(`Found ${documentsByMeterAndShop.size} unique meter-shop combinations`);

    let totalDeleted = 0;
    const duplicatesToDelete: string[] = [];
    const filesToDelete: string[] = [];

    // For each group, keep the most recent and mark others for deletion
    for (const [key, docs] of documentsByMeterAndShop.entries()) {
      if (docs.length > 1) {
        // Sort by upload_date descending (most recent first)
        docs.sort((a, b) => new Date(b.upload_date).getTime() - new Date(a.upload_date).getTime());
        
        // Keep the first (most recent), delete the rest
        const toDelete = docs.slice(1);
        console.log(`Found ${toDelete.length} duplicates for ${key}`);
        
        for (const doc of toDelete) {
          duplicatesToDelete.push(doc.id);
          filesToDelete.push(doc.file_path);
        }
        
        totalDeleted += toDelete.length;
      }
    }

    if (duplicatesToDelete.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true,
          duplicatesDeleted: 0,
          message: 'No duplicates found'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`Deleting ${duplicatesToDelete.length} duplicate documents...`);

    // Delete document extractions first
    const { error: extractionsError } = await supabase
      .from('document_extractions')
      .delete()
      .in('document_id', duplicatesToDelete);

    if (extractionsError) {
      console.error('Error deleting extractions:', extractionsError);
      throw extractionsError;
    }

    // Delete files from storage
    if (filesToDelete.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('client-files')
        .remove(filesToDelete);

      if (storageError) {
        console.error('Error deleting files from storage:', storageError);
        // Continue anyway - database cleanup is more important
      }
    }

    // Delete document records
    const { error: documentsError } = await supabase
      .from('site_documents')
      .delete()
      .in('id', duplicatesToDelete);

    if (documentsError) {
      console.error('Error deleting documents:', documentsError);
      throw documentsError;
    }

    console.log(`Successfully deleted ${totalDeleted} duplicate documents`);

    return new Response(
      JSON.stringify({ 
        success: true,
        duplicatesDeleted: totalDeleted,
        message: `Deleted ${totalDeleted} duplicate documents`
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


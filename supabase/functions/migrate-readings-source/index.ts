import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { batchSize = 500, subBatchSize = 50 } = await req.json().catch(() => ({}));

    console.log(`Starting migration with batch size: ${batchSize}, sub-batch: ${subBatchSize}`);

    // Get readings that need migration
    const { data: readingsToUpdate, error: selectError } = await supabase
      .from('meter_readings')
      .select('id, metadata')
      .is('metadata->>source', null)
      .not('metadata->>source_file', 'is', null)
      .limit(batchSize);

    if (selectError) {
      console.error('Select error:', selectError);
      throw selectError;
    }

    if (!readingsToUpdate || readingsToUpdate.length === 0) {
      // Get total remaining count
      const { count: remainingCount } = await supabase
        .from('meter_readings')
        .select('id', { count: 'exact', head: true })
        .is('metadata->>source', null)
        .not('metadata->>source_file', 'is', null);

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Migration complete - no more readings to update',
        updated: 0,
        remaining: remainingCount || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${readingsToUpdate.length} readings to update`);

    // Process in sub-batches for better performance
    let totalUpdated = 0;

    for (let i = 0; i < readingsToUpdate.length; i += subBatchSize) {
      const batch = readingsToUpdate.slice(i, i + subBatchSize);
      
      // Update all records in this sub-batch concurrently
      const updatePromises = batch.map(reading => {
        const updatedMetadata = {
          ...(reading.metadata as Record<string, unknown>),
          source: 'Parsed'
        };

        return supabase
          .from('meter_readings')
          .update({ metadata: updatedMetadata })
          .eq('id', reading.id);
      });

      await Promise.all(updatePromises);
      totalUpdated += batch.length;
      console.log(`Updated ${totalUpdated}/${readingsToUpdate.length} readings`);
    }

    // Get remaining count
    const { count: remainingCount } = await supabase
      .from('meter_readings')
      .select('id', { count: 'exact', head: true })
      .is('metadata->>source', null)
      .not('metadata->>source_file', 'is', null);

    console.log(`Migration batch complete. Updated: ${totalUpdated}, Remaining: ${remainingCount}`);

    return new Response(JSON.stringify({ 
      success: true,
      message: `Updated ${totalUpdated} readings`,
      updated: totalUpdated,
      remaining: remainingCount || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const error = err as Error;
    console.error('Migration error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

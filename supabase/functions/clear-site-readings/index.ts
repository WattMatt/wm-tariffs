import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { siteId } = await req.json();

    console.log(`Starting deletion for site ${siteId}`);

    // Get all meter IDs for this site
    const { data: meters, error: metersError } = await supabase
      .from('meters')
      .select('id, meter_number')
      .eq('site_id', siteId);

    if (metersError) {
      console.error('Meters fetch error:', metersError);
      throw new Error(`Failed to fetch meters: ${metersError.message}`);
    }

    if (!meters || meters.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          totalDeleted: 0,
          message: 'No meters found for this site'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const meterIds = meters.map(m => m.id);
    console.log(`Found ${meters.length} meters`);

    // Delete in batches to avoid timeout
    const batchSize = 5000;
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
      // Delete a batch (using LIMIT since we don't have IDs)
      const { error: deleteError, count } = await supabase
        .from('meter_readings')
        .delete({ count: 'exact' })
        .in('meter_id', meterIds)
        .limit(batchSize);

      if (deleteError) {
        console.error('Delete error:', deleteError);
        throw new Error(`Failed to delete readings: ${deleteError.message}`);
      }

      const deletedCount = count || 0;
      totalDeleted += deletedCount;

      console.log(`Batch deleted: ${deletedCount} readings (total: ${totalDeleted})`);

      // If we deleted less than batch size, we're done
      if (deletedCount < batchSize) {
        hasMore = false;
      }

      // Small delay to prevent overwhelming the database
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`Deletion complete: ${totalDeleted} total readings deleted`);

    return new Response(
      JSON.stringify({
        success: true,
        totalDeleted,
        metersProcessed: meters.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

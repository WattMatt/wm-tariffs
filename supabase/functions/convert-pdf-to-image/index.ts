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
    const { schematicId, documentId, filePath, bucketName = 'schematics', tableName = 'schematics' } = await req.json();
    
    if ((!schematicId && !documentId) || !filePath || !bucketName || !tableName) {
      return new Response(
        JSON.stringify({ error: 'ID, filePath, bucketName, and tableName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const recordId = schematicId || documentId;
    console.log(`PDF conversion requested for ${tableName} ${recordId}, file: ${filePath}`);
    console.log(`Note: PDF viewing is now handled client-side for better compatibility`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // For now, we don't actually convert - PDFs are displayed directly in browser
    // This edge function is kept for backwards compatibility but returns success immediately
    // Future enhancement: could use external service like CloudConvert API for real conversion

    console.log(`${tableName} record - PDF will be displayed directly in browser`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'PDF will be displayed directly - conversion not needed',
        note: 'Modern browsers handle PDF display natively',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in convert-pdf-to-image:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Failed to process PDF',
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
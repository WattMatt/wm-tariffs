import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";

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
    console.log(`Converting PDF to image for ${tableName} ${recordId}, file: ${filePath}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Download the PDF from storage
    const { data: pdfData, error: downloadError } = await supabase
      .storage
      .from(bucketName)
      .download(filePath);
      
    if (downloadError || !pdfData) {
      console.error('Error downloading PDF:', downloadError);
      throw new Error('Failed to download PDF file');
    }

    console.log('PDF downloaded successfully');

    // Convert blob to base64
    const arrayBuffer = await pdfData.arrayBuffer();
    const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    console.log('Starting puppeteer browser...');
    
    // Launch browser
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      
      // Set viewport for high quality
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
      
      // Create a data URL for the PDF
      const pdfDataUrl = `data:application/pdf;base64,${base64Pdf}`;
      
      // Navigate to the PDF
      await page.goto(pdfDataUrl, { waitUntil: 'networkidle2' });
      
      console.log('PDF loaded in browser, taking screenshot...');
      
      // Take screenshot of first page
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
      });
      
      console.log('Screenshot captured');
      
      // Generate unique filename for the converted image
      const imagePath = `${filePath.replace('.pdf', '')}_converted.png`;

      // Upload the converted image to storage
      const { error: uploadError } = await supabase
        .storage
        .from(bucketName)
        .upload(imagePath, screenshot, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        console.error('Error uploading converted image:', uploadError);
        throw new Error('Failed to upload converted image');
      }

      console.log('Converted image uploaded:', imagePath);

      // Update the record with the converted image path
      const { error: updateError } = await supabase
        .from(tableName)
        .update({ converted_image_path: imagePath })
        .eq('id', recordId);

      if (updateError) {
        console.error(`Error updating ${tableName} record:`, updateError);
        throw new Error(`Failed to update ${tableName} record`);
      }

      console.log(`${tableName} record updated successfully`);

      // Get public URL for the converted image
      const { data: urlData } = supabase
        .storage
        .from(bucketName)
        .getPublicUrl(imagePath);

      return new Response(
        JSON.stringify({ 
          success: true,
          imagePath,
          imageUrl: urlData.publicUrl,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } finally {
      await browser.close();
      console.log('Browser closed');
    }

  } catch (error) {
    console.error('Error in convert-pdf-to-image:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Failed to convert PDF',
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
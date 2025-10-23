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

    // Convert PDF to image using pdfjs-serverless (designed for edge functions)
    const arrayBuffer = await pdfData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Import pdfjs-serverless - works without workers in edge environments
    const { getDocument } = await import('https://esm.sh/pdfjs-serverless@0.3.2');

    // Load PDF
    const loadingTask = getDocument(uint8Array);
    const pdf = await loadingTask.promise;
    
    console.log(`PDF loaded, pages: ${pdf.numPages}`);

    // Get first page
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for better quality

    // Create canvas (using canvas package for Deno)
    const { createCanvas } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    console.log('PDF rendered to canvas');

    // Convert canvas to PNG buffer
    const imageBuffer = canvas.toBuffer('image/png');
    
    // Generate unique filename for the converted image
    const originalFilename = filePath.split('/').pop()?.replace('.pdf', '') || 'schematic';
    const imagePath = `${filePath.replace('.pdf', '')}_converted.png`;

    // Upload the converted image to storage
    const { error: uploadError } = await supabase
      .storage
      .from(bucketName)
      .upload(imagePath, imageBuffer, {
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

    // Get public URL for the converted image (or signed URL for private buckets)
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

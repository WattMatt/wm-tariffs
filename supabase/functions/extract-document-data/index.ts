import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, fileUrl, documentType } = await req.json();
    
    console.log(`Processing document ${documentId} of type ${documentType}`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if file is PDF and convert to image
    let imageUrl = fileUrl;
    if (fileUrl.toLowerCase().includes('.pdf')) {
      console.log("PDF detected, converting to image...");
      
      try {
        // Download PDF from the signed URL
        const pdfResponse = await fetch(fileUrl);
        if (!pdfResponse.ok) {
          throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
        }
        
        const pdfData = await pdfResponse.blob();
        const arrayBuffer = await pdfData.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Import pdfjs-serverless
        const { getDocument } = await import('https://esm.sh/pdfjs-serverless@0.3.2');

        // Load PDF
        const loadingTask = getDocument(uint8Array);
        const pdf = await loadingTask.promise;
        console.log(`PDF loaded, pages: ${pdf.numPages}`);

        // Get first page
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });

        // Create canvas
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
        
        // Upload the converted image to site-documents bucket
        const imagePath = `temp/${documentId}_converted.png`;
        const { error: uploadError } = await supabase
          .storage
          .from('site-documents')
          .upload(imagePath, imageBuffer, {
            contentType: 'image/png',
            upsert: true,
          });

        if (uploadError) {
          console.error('Error uploading converted image:', uploadError);
          throw new Error('Failed to upload converted image');
        }

        // Get signed URL for the converted image
        const { data: urlData } = await supabase
          .storage
          .from('site-documents')
          .createSignedUrl(imagePath, 3600);

        if (!urlData?.signedUrl) {
          throw new Error('Failed to get signed URL for converted image');
        }

        imageUrl = urlData.signedUrl;
        console.log('PDF converted successfully to image');
      } catch (conversionError) {
        console.error('PDF conversion failed:', conversionError);
        throw new Error(`PDF conversion failed: ${conversionError instanceof Error ? conversionError.message : 'Unknown error'}`);
      }
    }

    // Define the extraction prompt based on document type
    const systemPrompt = documentType === 'municipal_account'
      ? `You are an expert at extracting data from South African municipal electricity accounts. Extract the following information:
- Billing period (start and end dates)
- Total amount due
- Any meter readings or consumption data
- Account reference numbers
- Supply authority/municipality name
Return the data in a structured format.`
      : `You are an expert at extracting data from tenant electricity bills. Extract the following information:
- Billing period (start and end dates)
- Total amount
- Meter readings if available
- Consumption in kWh
- Tenant information
Return the data in a structured format.`;

    // Call Lovable AI for document extraction
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the relevant billing information from this document." },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_billing_data",
            description: "Extract structured billing data from the document",
            parameters: {
              type: "object",
              properties: {
                period_start: {
                  type: "string",
                  description: "Start date of billing period (YYYY-MM-DD format)"
                },
                period_end: {
                  type: "string",
                  description: "End date of billing period (YYYY-MM-DD format)"
                },
                total_amount: {
                  type: "number",
                  description: "Total amount in the bill"
                },
                currency: {
                  type: "string",
                  description: "Currency code (e.g., ZAR)"
                },
                meter_readings: {
                  type: "object",
                  description: "Meter readings if available",
                  properties: {
                    previous: { type: "number" },
                    current: { type: "number" },
                    consumption_kwh: { type: "number" }
                  }
                },
                account_reference: {
                  type: "string",
                  description: "Account or reference number"
                },
                additional_data: {
                  type: "object",
                  description: "Any other relevant extracted information"
                }
              },
              required: ["period_start", "period_end", "total_amount"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "extract_billing_data" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      throw new Error(`AI extraction failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error("No extraction data returned from AI");
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    console.log("Extracted data:", extractedData);

    // Store the extraction in the database
    const { data: extraction, error: extractionError } = await supabase
      .from("document_extractions")
      .insert({
        document_id: documentId,
        period_start: extractedData.period_start,
        period_end: extractedData.period_end,
        total_amount: extractedData.total_amount,
        currency: extractedData.currency || 'ZAR',
        extracted_data: extractedData,
        confidence_score: 0.85 // Could be calculated based on AI response
      })
      .select()
      .single();

    if (extractionError) {
      console.error("Error storing extraction:", extractionError);
      throw extractionError;
    }

    // Update document status
    await supabase
      .from("site_documents")
      .update({ extraction_status: 'completed' })
      .eq("id", documentId);

    console.log(`✓ Successfully extracted data for document ${documentId}`);

    return new Response(JSON.stringify({ 
      success: true, 
      extraction,
      extractedData 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in extract-document-data:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
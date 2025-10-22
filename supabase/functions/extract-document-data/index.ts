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

    // Check if file is PDF - use a cloud conversion service
    let imageUrl = fileUrl;
    if (fileUrl.toLowerCase().includes('.pdf')) {
      console.log("PDF detected, using cloud conversion service...");
      
      try {
        // Use a PDF to image conversion API (pdf.co or similar)
        // For now, we'll use the PDF directly and rely on the AI to extract text
        // This works with some AI models that support PDF input
        
        console.log("Processing PDF directly - AI will extract text from PDF");
      } catch (conversionError) {
        console.error('PDF processing note:', conversionError);
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

    // Download the file and convert to base64 for AI processing
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status}`);
    }
    
    const fileBuffer = await fileResponse.arrayBuffer();
    const base64File = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
    const mimeType = fileUrl.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    
    console.log(`File downloaded, size: ${fileBuffer.byteLength} bytes, type: ${mimeType}`);

    // Call Lovable AI for document extraction using base64 encoding
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
              { 
                type: "image_url", 
                image_url: { 
                  url: `data:${mimeType};base64,${base64File}` 
                } 
              }
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
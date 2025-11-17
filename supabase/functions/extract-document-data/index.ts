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

    // Define the extraction prompt based on document type
    const systemPrompt = documentType === 'municipal_account'
      ? `You are an expert at extracting data from South African municipal electricity accounts. Extract the following information:
- Billing period (start and end dates)
- Total amount due
- Any meter readings or consumption data
- Account reference numbers
- Supply authority/municipality name
Return the data in a structured format.`
      : `You are an expert at extracting data from tenant electricity bills. 

CRITICAL: Extract ALL line items from the billing table in the document. Each row in the table represents a separate charge and should become a line item.

Extract the following information:
- Billing period (start and end dates)
- Total amount (sum of all line items)
- Tenant name (NOTE: The tenant name appears BEFORE the account reference number. Extract only the tenant name, not the account reference)
- Account reference number (This appears AFTER the tenant name. Extract only the reference number)
- Shop number (CRITICAL: Extract ONLY the raw shop number WITHOUT any "DB-" prefix. The system will add the prefix automatically. The shop number is usually located BELOW the tenant name and account reference)
- Line items array: For EACH row in the billing table, extract:
  * Description (e.g., "Electrical", "Water", "Misc")
  * Meter number (if shown in the table)
  * Previous reading (the starting meter value)
  * Current reading (the ending meter value)
  * Consumption (units used, should be current - previous)
  * Rate (price per unit, in cents or rands)
  * Amount (line item total, should be consumption × rate)

Return the data in a structured format with all line items in an array.`;

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
              { type: "image_url", image_url: { url: fileUrl } }
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
                  description: "Currency - ALWAYS use 'R' regardless of whether the document shows 'ZAR', 'Rand', or 'R'"
                },
                line_items: {
                  type: "array",
                  description: "Array of billing line items from the document table. Extract ALL rows from the billing table.",
                  items: {
                    type: "object",
                    properties: {
                      description: { 
                        type: "string", 
                        description: "Description of the charge (e.g., 'Electrical', 'Water', 'Misc')" 
                      },
                      meter_number: { 
                        type: "string", 
                        description: "Meter number if shown in the table row" 
                      },
                      previous_reading: { 
                        type: "number", 
                        description: "Previous meter reading value" 
                      },
                      current_reading: { 
                        type: "number", 
                        description: "Current meter reading value" 
                      },
                      consumption: { 
                        type: "number", 
                        description: "Consumption/units used (should equal current - previous)" 
                      },
                      rate: { 
                        type: "number", 
                        description: "Rate/tariff per unit in rands or cents" 
                      },
                      amount: { 
                        type: "number", 
                        description: "Line item total amount (should equal consumption × rate)" 
                      }
                    },
                    required: ["description"]
                  }
                },
                account_reference: {
                  type: "string",
                  description: "Account or reference number"
                },
                shop_number: {
                  type: "string",
                  description: "Shop number (for tenant bills)"
                },
                tenant_name: {
                  type: "string",
                  description: "Name of the tenant (for tenant bills)"
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
    
    // Helper function to convert various date formats to YYYY-MM-DD
    const convertToISODate = (dateString: string): string => {
      if (!dateString) return dateString;
      
      // Already in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return dateString;
      }
      
      // Handle DD/MM/YYYY format
      const ddmmyyyyMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (ddmmyyyyMatch) {
        const [, day, month, year] = ddmmyyyyMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      
      // Handle MM/DD/YYYY format (less common for SA docs)
      const mmddyyyyMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (mmddyyyyMatch) {
        const [, first, second, year] = mmddyyyyMatch;
        // Assume DD/MM/YYYY for South African documents
        return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
      }
      
      // Return as-is if no pattern matches (will likely cause DB error which is good for debugging)
      console.warn(`Unexpected date format: ${dateString}`);
      return dateString;
    };
    
    // Convert dates to ISO format
    if (extractedData.period_start) {
      extractedData.period_start = convertToISODate(extractedData.period_start);
    }
    if (extractedData.period_end) {
      extractedData.period_end = convertToISODate(extractedData.period_end);
    }
    
    // Format shop number with DB- prefix and proper digit formatting
    if (extractedData.shop_number) {
      let shopNum = extractedData.shop_number.toString().trim();
      
      // Remove any existing DB- prefix (case insensitive)
      shopNum = shopNum.replace(/^DB-?/i, '');
      
      // Check if it's purely numeric or has a letter suffix (e.g., "13", "1A", "622")
      const match = shopNum.match(/^(\d+)([A-Z])?$/i);
      if (match) {
        const number = match[1];
        const suffix = match[2] ? match[2].toUpperCase() : '';
        
        // For numbers, pad to 2 digits (unless it's a special case like "622" or "ATM 2")
        const paddedNumber = number.length <= 2 ? number.padStart(2, '0') : number;
        extractedData.shop_number = `DB-${paddedNumber}${suffix}`;
      } else {
        // For non-standard patterns (e.g., "ATM 2", "CW"), just add DB- prefix
        extractedData.shop_number = `DB-${shopNum.toUpperCase()}`;
      }
      
      console.log(`Formatted shop number: ${extractedData.shop_number}`);
    }
    
    // Normalize currency to always be "R"
    if (extractedData.currency) {
      const currencyStr = extractedData.currency.toString().toUpperCase().trim();
      // Convert any variation (ZAR, RAND, R, etc.) to just "R"
      extractedData.currency = 'R';
    }
    
    console.log("Extracted data:", extractedData);

    // Delete any existing extractions for this document before creating a new one
    const { error: deleteError } = await supabase
      .from("document_extractions")
      .delete()
      .eq("document_id", documentId);
    
    if (deleteError) {
      console.error("Error deleting old extractions:", deleteError);
      // Continue anyway - it might be the first extraction
    }

    // Store the extraction in the database
    const { data: extraction, error: extractionError } = await supabase
      .from("document_extractions")
      .insert({
        document_id: documentId,
        period_start: extractedData.period_start,
        period_end: extractedData.period_end,
        total_amount: extractedData.total_amount,
        currency: extractedData.currency || 'R',
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

    // Auto-assign meter based on shop number
    if (extractedData.shop_number) {
      console.log(`Attempting to auto-assign meter for shop number: ${extractedData.shop_number}`);
      
      // Get the site_id and folder_path from the document
      const { data: document } = await supabase
        .from("site_documents")
        .select("site_id, folder_path")
        .eq("id", documentId)
        .single();
      
      if (document?.site_id) {
        // Find meter with matching meter_number (shop number)
        const { data: meter } = await supabase
          .from("meters")
          .select("id")
          .eq("site_id", document.site_id)
          .eq("meter_number", extractedData.shop_number)
          .single();
        
        if (meter) {
          // Check if this meter is already assigned to another document IN THE SAME FOLDER
          const { data: existingAssignments } = await supabase
            .from("site_documents")
            .select("id, file_name")
            .eq("meter_id", meter.id)
            .eq("folder_path", document.folder_path)
            .neq("id", documentId);
          
          if (existingAssignments && existingAssignments.length > 0) {
            const conflictDoc = existingAssignments[0];
            console.log(`⚠ Cannot auto-assign: Meter ${extractedData.shop_number} is already assigned to document "${conflictDoc.file_name}" in the same folder`);
            
            // Update document with warning status
            await supabase
              .from("site_documents")
              .update({ 
                extraction_status: 'completed_with_warning'
              })
              .eq("id", documentId);
          } else {
            // Assign the meter to the document
            await supabase
              .from("site_documents")
              .update({ meter_id: meter.id })
              .eq("id", documentId);
            
            console.log(`✓ Auto-assigned meter ${meter.id} to document ${documentId}`);
          }
        } else {
          console.log(`⚠ No meter found with number ${extractedData.shop_number} for site ${document.site_id}`);
        }
      }
    }

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
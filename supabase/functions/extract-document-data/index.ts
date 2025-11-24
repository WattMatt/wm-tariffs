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

    // Retry logic for AI API calls
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds
    
    const callAIWithRetry = async (url: string, options: any, attempt = 1): Promise<Response> => {
      const response = await fetch(url, options);
      
      // If we get a 503 (Service Unavailable) and haven't exceeded retries, try again
      if (response.status === 503 && attempt < maxRetries) {
        console.log(`AI API returned 503, retrying (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        return callAIWithRetry(url, options, attempt + 1);
      }
      
      return response;
    };

    // Define the extraction prompt based on document type
    const systemPrompt = documentType === 'municipal_account'
      ? `You are an expert at extracting electricity data from South African municipal accounts.

CRITICAL MATCHING LOGIC FOR ACCOUNT DETAILS AND METER READINGS:

The ACCOUNT DETAILS table contains:
- CODE: Internal reference code
- DESCRIPTION: Charge description (may just say "ELECTRICITY" for both kVA and kWh)
- UNITS: The consumption amount for this charge
- TARIFF: The rate/price per unit (CRITICAL: Extract this as the 'rate' field)
- VALUE: The total charge amount

The METER READINGS table contains:
- METER NO.: Meter identifier
- METER TYPE: "KVA" or "ELECTRICITY" or "kWh"
- OLD READING: Previous meter value
- NEW READING: Current meter value
- CONSUMPTION: Calculated difference (NEW - OLD)

MATCHING PROCESS:
1. Look at the UNITS column in ACCOUNT DETAILS
2. Match it to the CONSUMPTION column in METER READINGS
3. If UNITS ≈ 534 and METER TYPE = "KVA", this is ELECTRICITY-POWER
4. If UNITS ≈ 100,000+ and METER TYPE = "ELECTRICITY", this is ELECTRICITY-ENERGY

EXAMPLE:
METER READINGS shows:
- Row 1: METER TYPE="KVA", CONSUMPTION=534.000
- Row 2: METER TYPE="ELECTRICITY", CONSUMPTION=101356.000

ACCOUNT DETAILS shows:
- Row 1: DESCRIPTION="ELECTRICITY", UNITS=534.000, TARIFF=424.970000, VALUE=226933.98
- Row 2: DESCRIPTION="ELECTRICITY", UNITS=101356.000, TARIFF=1.726500, VALUE=174991.13

Then extract as:
- ELECTRICITY-POWER: meter_number from KVA row, consumption=534.000 (from METER READINGS), rate=424.970000 (from ACCOUNT DETAILS TARIFF), amount=226933.98
- ELECTRICITY-ENERGY: meter_number from ELECTRICITY row, consumption=101356.000 (from METER READINGS), rate=1.726500 (from ACCOUNT DETAILS TARIFF), amount=174991.13

CRITICAL: Extract ONLY these three electricity charges from the document:

1. **ELECTRICITY-BASIC** (Basic Charge):
   - Find the line item with description "ELECTRICITY-BASIC" in the ACCOUNT DETAILS table
   - Extract the TARIFF as the rate (if available, otherwise use amount)
   - Extract the VALUE as the amount (e.g., R 17123.48)
   - This is a fixed monthly charge, so there are NO meter readings for this item
   - Set unit to "Monthly"
   - Set supply to "Normal"

2. **ELECTRICITY-POWER** (kVA/Demand Charge):
   - In ACCOUNT DETAILS, find the ELECTRICITY row where UNITS matches the KVA meter's CONSUMPTION (~534)
   - Extract TARIFF as the rate (e.g., 424.970000)
   - Extract VALUE as the amount (e.g., 226933.98)
   - From METER READINGS, find where METER TYPE = "KVA"
   - Extract: METER NO. as meter_number, OLD READING as old_reading, NEW READING as new_reading, CONSUMPTION as consumption
   - CRITICAL: consumption field MUST come from METER READINGS table, NOT from ACCOUNT DETAILS UNITS
   - Set description to "ELECTRICITY-POWER"
   - Set unit to "kVA"
   - Set supply to "Normal"

3. **ELECTRICITY-ENERGY** (kWh Charge):
   - In ACCOUNT DETAILS, find the ELECTRICITY row where UNITS matches the ELECTRICITY meter's CONSUMPTION (~100,000+)
   - Extract TARIFF as the rate (e.g., 1.726500)
   - Extract VALUE as the amount (e.g., 174991.13)
   - From METER READINGS, find where METER TYPE = "ELECTRICITY" or "kWh"
   - Extract: METER NO. as meter_number, OLD READING as old_reading, NEW READING as new_reading, CONSUMPTION as consumption
   - CRITICAL: consumption field MUST come from METER READINGS table, NOT from ACCOUNT DETAILS UNITS
   - Set description to "ELECTRICITY-ENERGY"
   - Set unit to "kWh"
   - Set supply to "Normal"

IGNORE all other charges (water, rates, sewerage, refuse, etc.). Return ONLY these three electricity line items.

Also extract:
- Billing period (start and end dates from the document header)
- Total amount (sum of the three electricity charges, or from document total)
- Account reference number
- Supply authority/municipality name`
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
  * Supply (CRITICAL: If the description contains the word "Generator", set this to "Emergency", otherwise set it to "Normal")
  * Meter number (if shown in the table)
  * Unit (CRITICAL: Determine the unit type from the description or table headers. The ONLY valid options are: "kWh" (kilowatt-hours for energy consumption), "kVA" (kilovolt-amperes for demand charges), or "Monthly" (for fixed monthly charges like basic fees). Look for indicators like "(kWh)", "(kVA)", "Conv", "Demand", "Basic", or "Monthly" in the description.)
  * Previous reading (the starting meter value, only applicable for kWh and kVA)
  * Current reading (the ending meter value, only applicable for kWh and kVA)
  * Consumption (units used, should be current - previous for kWh and kVA)
  * Rate (price per unit in cents or rands)
  * Amount (line item total, should be consumption × rate)

Return the data in a structured format with all line items in an array.`;

    // Call Lovable AI for document extraction with retry logic
    const aiResponse = await callAIWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                  description: documentType === 'municipal_account' 
                    ? "Array of EXACTLY THREE electricity line items: ELECTRICITY-BASIC, ELECTRICITY-POWER (kVA), and ELECTRICITY-ENERGY (kWh). Extract ONLY these three charges."
                    : "Array of billing line items from the document table. Extract ALL rows from the billing table.",
                  items: {
                    type: "object",
                    properties: {
                      description: { 
                        type: "string", 
                        description: documentType === 'municipal_account'
                          ? "Description of the electricity charge. Must be one of: 'ELECTRICITY-BASIC', 'ELECTRICITY-POWER', or 'ELECTRICITY-ENERGY'"
                          : "Description of the charge (e.g., 'Electrical', 'Water', 'Misc')"
                      },
                      supply: {
                        type: "string",
                        description: "Supply type - 'Emergency' if the description contains 'Generator', otherwise 'Normal'",
                        enum: ["Normal", "Emergency"]
                      },
                      meter_number: { 
                        type: "string", 
                        description: documentType === 'municipal_account'
                          ? "Meter number from the METER READINGS table (for kVA and kWh line items only, not for BASIC charge)"
                          : "Meter number if shown in the table row"
                      },
                      unit: {
                        type: "string",
                        description: "Unit type for this line item. Must be one of: 'kWh' (for energy consumption charges), 'kVA' (for demand charges), or 'Monthly' (for fixed monthly charges like basic fees). Determine from the description - look for keywords like 'Conv', 'Consumption', 'kWh' for energy; 'Demand', 'kVA' for demand; 'Basic', 'Fixed', 'Monthly' for monthly charges.",
                        enum: ["kWh", "kVA", "Monthly"]
                      },
                      old_reading: { 
                        type: "number", 
                        description: documentType === 'municipal_account'
                          ? "Old/previous meter reading from METER READINGS table (for kVA and kWh charges only)"
                          : "Previous meter reading value"
                      },
                      new_reading: { 
                        type: "number", 
                        description: documentType === 'municipal_account'
                          ? "New/current meter reading from METER READINGS table (for kVA and kWh charges only)"
                          : "Current meter reading value"
                      },
                      previous_reading: { 
                        type: "number", 
                        description: "Previous meter reading value (alternative field name for backwards compatibility)" 
                      },
                      current_reading: { 
                        type: "number", 
                        description: "Current meter reading value (alternative field name for backwards compatibility)" 
                      },
                      consumption: { 
                        type: "number", 
                        description: documentType === 'municipal_account'
                          ? "CRITICAL: Extract ONLY from METER READINGS table CONSUMPTION column (NOT from ACCOUNT DETAILS UNITS). This is new_reading - old_reading from the meter data."
                          : "Consumption/units used (should equal current - previous)"
                      },
                      rate: { 
                        type: "number", 
                        description: documentType === 'municipal_account'
                          ? "CRITICAL: Extract from TARIFF column in ACCOUNT DETAILS table (e.g., 424.970000 for kVA, 1.726500 for kWh). This is the price per unit."
                          : "Rate/tariff per unit in rands or cents"
                      },
                      amount: { 
                        type: "number", 
                        description: "Line item total amount from ACCOUNT DETAILS table" 
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
      
      if (aiResponse.status === 503) {
        throw new Error("AI service is temporarily unavailable. Please try again in a few moments.");
      } else if (aiResponse.status === 429) {
        throw new Error("Rate limit exceeded. Please wait a moment and try again.");
      } else if (aiResponse.status === 402) {
        throw new Error("AI credits depleted. Please add credits to your workspace.");
      }
      
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
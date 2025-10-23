import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, phase, municipalityName, cropRegion } = await req.json();
    
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: "Image URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase 1: Identify province/municipality structure
    if (phase === "identify") {
      return await identifyStructure(imageUrl);
    }
    
    // Phase 2: Extract specific municipality tariffs
    if (phase === "extract" && municipalityName) {
      return await extractMunicipalityTariffs(imageUrl, municipalityName, cropRegion);
    }
    
    return new Response(
      JSON.stringify({ error: "Invalid phase or missing municipalityName" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in extract-tariff-data function:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function identifyStructure(imageUrl: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log("Phase 1: Identifying province/municipality structure from image");

  const identifyPrompt = `Analyze this South African electricity tariff document IMAGE and identify the structure.

VISUAL CUES TO LOOK FOR:
- Municipality headers in bold/large font
- Format: "MUNICIPALITY_NAME - XX.XX%" (e.g., "AMAHLATHI - 10.76%")
- Sections separated by borders or spacing
- Table headers and structure
- For Eskom: "Eskom Holdings SOC Ltd"

TASK: Extract municipality names with their NERSA increase percentages by analyzing the visual layout.

Return ONLY a JSON array of objects:
[
  {
    "name": "AMAHLATHI",
    "nersaIncrease": 10.76,
    "province": "Eastern Cape"
  }
]

Rules:
- Extract ONLY municipality names (uppercase, no "- XX%")
- Include the percentage as a number
- Include province if visible
- Be thorough - scan entire document
- Pay attention to visual formatting and layout
- For Eskom, use: {"name": "Eskom Holdings SOC Ltd", "nersaIncrease": XX, "province": "National"}

Return ONLY valid JSON, no markdown.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { 
          role: "system", 
          content: identifyPrompt 
        },
        { 
          role: "user", 
          content: [
            {
              type: "text",
              text: "Analyze this tariff document and extract municipality structure:"
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl
              }
            }
          ]
        }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    throw new Error(`AI processing failed: ${response.status}`);
  }

  const aiResponse = await response.json();
  const extractedText = aiResponse.choices?.[0]?.message?.content;

  if (!extractedText) {
    throw new Error("No content in AI response");
  }

  try {
    const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const municipalities = JSON.parse(cleanedText);
    
    console.log(`Found ${municipalities.length} municipalities:`, municipalities);
    
    return new Response(
      JSON.stringify({ success: true, municipalities }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (parseError) {
    console.error("Failed to parse municipalities:", extractedText);
    return new Response(
      JSON.stringify({ error: "Failed to parse structure", details: extractedText }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function extractMunicipalityTariffs(imageUrl: string, municipalityName: string, cropRegion?: { x: number; y: number; width: number; height: number }) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log(`Phase 2: Extracting tariffs for ${municipalityName} from image`);
  console.log(`Image URL: ${imageUrl}`);
  if (cropRegion) {
    console.log(`Using crop region:`, cropRegion);
  }

  const systemPrompt = `Extract electricity tariff data ONLY for: "${municipalityName}" by analyzing the document IMAGE.

VISUAL ANALYSIS:
- Identify tables and their visual structure
- Read values from table cells
- Distinguish between headers and data rows
- Look for tiered pricing blocks (usually in separate rows)
- Find charge types in leftmost columns
- Extract amounts from rightmost columns
- Identify TOU periods by time ranges in tables
- Pay attention to borders, formatting, and layout

CRITICAL RULES:
1. Extract ONLY tariffs for "${municipalityName}" - ignore all other municipalities
2. Each municipality has multiple tariff categories (Domestic, Commercial, Industrial, etc.)
3. Look for section headers indicating tariff types (check for bold/larger text)
4. Extract ALL charges: energy charges (c/kWh), capacity charges (R/kVA), service charges (R/day)
5. Handle TOU periods if present (Peak/Standard/Off-peak with times)
6. Handle blocks for domestic tariffs (0-600 kWh, 600+ kWh, etc.)

SEARCH PATTERN:
- Find "${municipalityName}" header (look for bold/large text)
- Extract all tariff sections until next municipality
- Each tariff has: name, type, charges, blocks/TOU periods

OUTPUT STRUCTURE:
{
  "supplyAuthority": {
    "name": "${municipalityName}",
    "region": "province if found",
    "nersaIncreasePercentage": number
  },
  "tariffStructures": [
    {
      "name": "Tariff name (e.g., Domestic Conventional, Business)",
      "tariffType": "domestic|commercial|industrial|agricultural",
      "voltageLevel": "if specified",
      "meterConfiguration": "prepaid|conventional|both",
      "effectiveFrom": "2025-07-01",
      "effectiveTo": null,
      "description": "Brief description",
      "usesTou": false,
      "touType": null,
      "blocks": [
        {
          "blockNumber": 1,
          "kwhFrom": 0,
          "kwhTo": 600,
          "energyChargeCents": 192.00
        }
      ],
      "charges": [
        {
          "chargeType": "service_charge|demand_kva|basic_monthly|capacity_charge",
          "chargeAmount": 246.19,
          "description": "Basic Monthly Charge",
          "unit": "R/month"
        }
      ],
      "touPeriods": []
    }
  ]
}

CRITICAL VALUE CONVERSION:
1. Energy charges in R/kWh → MULTIPLY BY 100 to store as c/kWh
   - Excel shows: "1,92 R/kWh" → store energyChargeCents as 192.00
   - Excel shows: "3.53 R/kWh" → store energyChargeCents as 353.00
2. Fixed charges in R/month, R/kVA → KEEP AS-IS (do not multiply)
   - Excel shows: "246.19 R/month" → store chargeAmount as 246.19
   - Excel shows: "243.73 R/kVA" → store chargeAmount as 243.73
3. Block energy charges: Multiply R/kWh values by 100
4. TOU period charges: Multiply R/kWh values by 100

EXTRACTION STRATEGY:
1. Locate "${municipalityName}" section boundaries
2. Identify all tariff subsections within
3. For each tariff, extract:
   - Tariff name and type
   - Energy charges in R/kWh → MULTIPLY BY 100 to convert to c/kWh for storage
   - Fixed charges (R/month, R/kVA) → KEEP AS-IS (no multiplication)
   - Blocks with tiered pricing (convert R/kWh to c/kWh by multiplying by 100)
   - TOU periods if time-based (convert R/kWh to c/kWh by multiplying by 100)

Return ONLY valid JSON, no markdown.`;

  let userMessage: any = {
    role: "user",
    content: [
      {
        type: "text",
        text: cropRegion 
          ? `Analyze the selected region of this tariff document and extract data for ${municipalityName}:`
          : `Analyze this complete tariff document and extract data for ${municipalityName}:`
      },
      {
        type: "image_url",
        image_url: {
          url: imageUrl
        }
      }
    ]
  };

  console.log("Calling Lovable AI gateway for extraction...");
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        userMessage
      ],
    }),
  });

  console.log(`AI gateway response status: ${response.status}`);

  if (!response.ok) {
    if (response.status === 429) {
      console.error("Rate limit exceeded");
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later.", success: false }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (response.status === 402) {
      console.error("Payment required");
      return new Response(
        JSON.stringify({ error: "Payment required. Please add credits to your workspace.", success: false }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    return new Response(
      JSON.stringify({ error: `AI processing failed: ${response.status}`, details: errorText, success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("Parsing AI response...");
  const aiResponse = await response.json();
  const extractedText = aiResponse.choices?.[0]?.message?.content;

  if (!extractedText) {
    console.error("No content in AI response");
    throw new Error("No content in AI response");
  }

  console.log(`Extraction result length: ${extractedText.length} characters`);
  console.log(`First 200 chars of response: ${extractedText.slice(0, 200)}`);

  try {
    const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const extractedData = JSON.parse(cleanedText);
    
    console.log(`Successfully extracted ${extractedData.tariffStructures?.length || 0} tariff structures`);
    
    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (parseError) {
    console.error("Failed to parse extraction result:", parseError);
    console.error("Raw response (first 500 chars):", extractedText.slice(0, 500));
    return new Response(
      JSON.stringify({ 
        error: "Failed to parse tariff data", 
        details: extractedText.slice(0, 1000),
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

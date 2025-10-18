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
    const { documentContent, phase, municipalityName } = await req.json();
    
    if (!documentContent) {
      return new Response(
        JSON.stringify({ error: "Document content is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase 1: Identify province/municipality structure
    if (phase === "identify") {
      return await identifyStructure(documentContent);
    }
    
    // Phase 2: Extract specific municipality tariffs
    if (phase === "extract" && municipalityName) {
      return await extractMunicipalityTariffs(documentContent, municipalityName);
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

async function identifyStructure(documentContent: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log("Phase 1: Identifying province/municipality structure");

  const identifyPrompt = `Analyze this South African electricity tariff document and identify the structure.

DOCUMENT FORMAT:
- Provinces contain municipalities
- Municipalities are shown as "MUNICIPALITY_NAME - XX.XX%" (e.g., "AMAHLATHI - 10.76%")
- Each municipality has multiple tariff structures
- For Eskom: "Eskom Holdings SOC Ltd"

TASK: Extract municipality names with their NERSA increase percentages.

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
        { role: "system", content: identifyPrompt },
        { role: "user", content: `Extract municipality structure:\n\n${documentContent.slice(0, 30000)}` }
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

async function extractMunicipalityTariffs(documentContent: string, municipalityName: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log(`Phase 2: Extracting tariffs for ${municipalityName}`);

  const systemPrompt = `Extract electricity tariff data ONLY for: "${municipalityName}"

CRITICAL RULES:
1. Extract ONLY tariffs for "${municipalityName}" - ignore all other municipalities
2. Each municipality has multiple tariff categories (Domestic, Commercial, Industrial, etc.)
3. Look for section headers indicating tariff types
4. Extract ALL charges: energy charges (c/kWh), capacity charges (R/kVA), service charges (R/day)
5. Handle TOU periods if present (Peak/Standard/Off-peak with times)
6. Handle blocks for domestic tariffs (0-600 kWh, 600+ kWh, etc.)

SEARCH PATTERN:
- Find "${municipalityName}" header
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
        { role: "user", content: `Document to extract from:\n\n${documentContent.slice(0, 100000)}` }
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (response.status === 402) {
      return new Response(
        JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    return new Response(
      JSON.stringify({ error: `AI processing failed: ${response.status}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const aiResponse = await response.json();
  const extractedText = aiResponse.choices?.[0]?.message?.content;

  if (!extractedText) {
    throw new Error("No content in AI response");
  }

  console.log(`Extraction result length: ${extractedText.length} characters`);

  try {
    const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const extractedData = JSON.parse(cleanedText);
    
    console.log(`Extracted ${extractedData.tariffStructures?.length || 0} tariff structures`);
    
    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (parseError) {
    console.error("Failed to parse extraction result:", extractedText.slice(0, 500));
    return new Response(
      JSON.stringify({ 
        error: "Failed to parse tariff data", 
        details: extractedText.slice(0, 1000)
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

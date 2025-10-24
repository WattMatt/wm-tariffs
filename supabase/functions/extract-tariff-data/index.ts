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
    const { documentContent, phase, municipalityName, cropRegion, imageUrl } = await req.json();
    
    // Phase for extracting municipality from image
    if (phase === "extractMunicipality" && imageUrl) {
      return await extractMunicipalityFromImage(imageUrl);
    }
    
    if (!documentContent) {
      return new Response(
        JSON.stringify({ error: "Document content is required", success: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${phase} phase with text content (${documentContent.length} chars)`);

    // Phase 1: Identify province/municipality structure
    if (phase === "identify") {
      return await identifyStructure(documentContent);
    }
    
    // Phase 2: Extract specific municipality tariffs
    if (phase === "extract" && municipalityName) {
      return await extractMunicipalityTariffs(documentContent, municipalityName, cropRegion);
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

  console.log("Phase 1: Identifying province/municipality structure from text");

  const identifyPrompt = `You are analyzing extracted text from a South African electricity tariff document. Your task is to identify ONLY the municipalities that are present in this specific document text.

CRITICAL RULES:
1. Extract ONLY municipality names that you can find in the provided text
2. DO NOT invent or guess any municipality names
3. DO NOT use examples from your training data
4. If you cannot find a municipality name in the text, DO NOT include it
5. Extract the EXACT text as it appears - do not correct spellings or format names

SEARCH PATTERN:
- Look for municipality headers (usually in format: "MUNICIPALITY_NAME - XX.XX%")
- Format typically: "BA-PHALABORWA - 12.92%"
- Look for NERSA increase percentages next to municipality names
- Province name may be mentioned at the start of the document

TASK: 
Scan through the provided document text and extract ONLY the municipality names that you can FIND in the text, along with their NERSA increase percentages.

Return ONLY a JSON array of objects for municipalities you can CONFIRM are in the text:
[
  {
    "name": "EXACT_NAME_AS_SHOWN",
    "nersaIncrease": XX.XX,
    "province": "Province name if found in text"
  }
]

IMPORTANT:
- Only return municipalities that are CLEARLY PRESENT in the provided text
- Do not pad the results with municipalities from your training data
- The province MUST match what's written in the document text

Return ONLY valid JSON, no markdown, no explanations.`;

  console.log("CRITICAL: AI must extract ONLY from the actual document text, not from training data");

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
          role: "user", 
          content: `${identifyPrompt}\n\nDocument text to analyze:\n\n${documentContent.slice(0, 50000)}`
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
    
    console.log(`Found ${municipalities.length} municipalities in text`);
    console.log("Municipalities extracted:", JSON.stringify(municipalities.slice(0, 3))); // Log first 3
    
    // Log province distribution to detect hallucinations
    const provinceCount: Record<string, number> = {};
    municipalities.forEach((m: any) => {
      const province = m.province || 'Unknown';
      provinceCount[province] = (provinceCount[province] || 0) + 1;
    });
    console.log("Province distribution:", provinceCount);
    
    return new Response(
      JSON.stringify({ success: true, municipalities }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (parseError) {
    console.error("Failed to parse municipalities:", extractedText);
    return new Response(
      JSON.stringify({ error: "Failed to parse structure", details: extractedText, success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function extractMunicipalityTariffs(documentContent: string, municipalityName: string, cropRegion?: { x: number; y: number; width: number; height: number }) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log(`Phase 2: Extracting tariffs for ${municipalityName} from text (${documentContent.length} chars)`);
  if (cropRegion) {
    console.log(`Note: crop region specified but not applicable for text extraction:`, cropRegion);
  }

  const systemPrompt = `Extract electricity tariff data ONLY for: "${municipalityName}" from the document text.

CRITICAL RULES:
1. Extract ONLY tariffs for "${municipalityName}" - ignore all other municipalities
2. Each municipality has multiple tariff categories (Domestic, Commercial, Industrial, etc.)
3. Look for section headers indicating tariff types
4. Extract ALL charges: energy charges (c/kWh), capacity charges (R/kVA), service charges (R/day)
5. Handle TOU periods if present (Peak/Standard/Off-peak with times)
6. Handle blocks for domestic tariffs (0-600 kWh, 600+ kWh, etc.)

SEARCH PATTERN:
- Find "${municipalityName}" header in text
- Extract all tariff sections until next municipality appears
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
        { role: "user", content: `Document text to extract from:\n\n${documentContent.slice(0, 100000)}` }
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

async function extractMunicipalityFromImage(imageUrl: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log("Extracting municipality data from image:", imageUrl);

  const prompt = `You are analyzing a South African electricity tariff document image. Extract EVERY SINGLE piece of tariff information visible.

CRITICAL INSTRUCTIONS:
1. SCAN THE ENTIRE IMAGE from top to bottom
2. Extract EVERY tariff category you see (Domestic, Commercial, Industrial, etc.)
3. For EACH tariff category, extract EVERY SINGLE BLOCK and CHARGE
4. DO NOT STOP after finding one category - continue scanning for more
5. Count the rows carefully - if you see 4 blocks, extract all 4 blocks

WHAT TO EXTRACT (for EACH tariff category):
1. Municipality name from header (e.g., "BA-PHALABORWA - 12.92%")
2. NERSA increase percentage (the number with %)
3. Tariff category name (full text like "Domestic Prepaid & Conventional")
4. EVERY block row with:
   - Block number (Block 1, Block 2, etc.)
   - kWh range (e.g., "0 - 50 kWh" → kwhFrom: 0, kwhTo: 50)
   - Energy charge (e.g., "175.08 c/kWh" → 175.08)
   - IMPORTANT: Read ALL rows until the table ends
5. ALL fixed charges rows:
   - Basic charge / Service charge / Energy charge
   - Amount in R/month or R/day
   - Extract even if it's the last row of a table

CONVERSION RULES:
- "175.08 c/kWh" → energyChargeCents: 175.08
- "1.75 R/kWh" → energyChargeCents: 175.00 (multiply by 100)
- "R292.66 /month" → chargeAmount: 292.66, unit: "R/month"
- "0 - 50 kWh" → kwhFrom: 0, kwhTo: 50
- ">600 kWh" → kwhFrom: 601, kwhTo: null

CRITICAL: If you see multiple tariff tables in the image (e.g., "Domestic Prepaid", "Domestic conventional", "Commercial"), extract ALL of them. Do not stop after the first one.

EXAMPLE for an image with 2 tariff categories:
{
  "municipalityName": "BA-PHALABORWA",
  "nersaIncrease": 12.92,
  "tariffStructures": [
    {
      "tariffName": "Domestic Prepaid & Conventional",
      "tariffType": "domestic",
      "meterConfiguration": "both",
      "blocks": [
        {"blockNumber": 1, "kwhFrom": 0, "kwhTo": 50, "energyChargeCents": 175.08, "description": "Block 1 (0-50 kWh)"},
        {"blockNumber": 2, "kwhFrom": 51, "kwhTo": 350, "energyChargeCents": 223.84, "description": "Block 2 (51-350 kWh)"},
        {"blockNumber": 3, "kwhFrom": 351, "kwhTo": 600, "energyChargeCents": 303.40, "description": "Block 3 (351-600 kWh)"},
        {"blockNumber": 4, "kwhFrom": 601, "kwhTo": null, "energyChargeCents": 366.19, "description": "Block 4 (>600 kWh)"}
      ],
      "charges": []
    },
    {
      "tariffName": "Domestic conventional",
      "tariffType": "domestic",
      "meterConfiguration": "conventional",
      "blocks": [
        {"blockNumber": 1, "kwhFrom": 0, "kwhTo": 50, "energyChargeCents": 175.46, "description": "Block 1 (0-50 kWh)"},
        {"blockNumber": 2, "kwhFrom": 51, "kwhTo": 350, "energyChargeCents": 224.65, "description": "Block 2 (51-350 kWh)"},
        {"blockNumber": 3, "kwhFrom": 351, "kwhTo": 600, "energyChargeCents": 318.05, "description": "Block 3 (351-600 kWh)"},
        {"blockNumber": 4, "kwhFrom": 601, "kwhTo": null, "energyChargeCents": 374.56, "description": "Block 4 (>600 kWh)"}
      ],
      "charges": [
        {"chargeType": "basic_monthly", "chargeAmount": 292.66, "unit": "R/month", "description": "Basic charge"}
      ]
    }
  ]
}

FINAL CHECK: Before returning, count:
- How many tariff tables are visible in the image?
- How many blocks does each table have?
- Have you extracted ALL of them?

Return ONLY valid JSON, no markdown, no explanations.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { 
          role: "user", 
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later.", success: false }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (response.status === 402) {
      return new Response(
        JSON.stringify({ error: "Payment required. Please add credits to your workspace.", success: false }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
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
    const extractedData = JSON.parse(cleanedText);
    
    console.log("Extracted municipality:", {
      name: extractedData.municipalityName,
      nersaIncrease: extractedData.nersaIncrease,
      tariffCount: extractedData.tariffStructures?.length || 0
    });
    
    // Log first tariff structure for debugging
    if (extractedData.tariffStructures && extractedData.tariffStructures.length > 0) {
      const firstTariff = extractedData.tariffStructures[0];
      console.log("First tariff:", {
        name: firstTariff.tariffName,
        blockCount: firstTariff.blocks?.length || 0,
        chargeCount: firstTariff.charges?.length || 0
      });
    }
    
    // Return in format compatible with frontend
    return new Response(
      JSON.stringify({ 
        success: true, 
        tariffData: {
          municipalityName: extractedData.municipalityName || "",
          nersaIncrease: extractedData.nersaIncrease || 0,
          tariffStructures: extractedData.tariffStructures || []
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (parseError) {
    console.error("Failed to parse tariff data from image:", extractedText);
    return new Response(
      JSON.stringify({ error: "Failed to parse tariff data", details: extractedText, success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

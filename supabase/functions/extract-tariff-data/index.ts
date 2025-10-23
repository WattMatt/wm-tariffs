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

  console.log("Extracting tariff data from selected image region:", imageUrl);

  const prompt = `Analyze this image and extract ALL tariff information visible in it.

CRITICAL INSTRUCTIONS:
1. Extract EVERYTHING you can see in this image
2. Look for tariff blocks (e.g., "Block 1 (0 - 50 kWh): 175.08 c/kWh")
3. Look for charge types (energy charges, service charges, capacity charges)
4. Look for tariff categories (Domestic, Commercial, Industrial, etc.)
5. Look for TOU periods (Peak, Standard, Off-peak with times if shown)
6. Extract the tariff name (e.g., "Domestic Prepaid & Conventional")
7. Look for any header information (municipality name, voltage level, meter type)

TARIFF STRUCTURE TO EXTRACT:
- Tariff name and category
- Voltage level (if shown)
- Meter configuration (prepaid/conventional/both)
- All blocks with kWh ranges and charges in c/kWh
- All fixed charges (service/basic monthly in R/month or R/day)
- Capacity charges (R/kVA if shown)
- TOU periods with times and charges (if shown)

CRITICAL VALUE EXTRACTION:
1. Energy charges:
   - If shown as "c/kWh" or "cents/kWh" → extract as-is
   - If shown as "R/kWh" → MULTIPLY BY 100 to convert to c/kWh
   - Examples: "175.08 c/kWh" → 175.08, "1.75 R/kWh" → 175.00
2. Fixed charges:
   - If shown as "R/month" or "R/day" → extract as-is (no multiplication)
   - Examples: "246.19 R/month" → 246.19
3. Capacity charges:
   - If shown as "R/kVA" → extract as-is
   - Example: "243.73 R/kVA" → 243.73

Return ONLY a JSON object in this exact format:
{
  "municipalityName": "Name if shown in header, or empty string",
  "nersaIncrease": number or 0 if not shown,
  "tariffName": "Full tariff name as shown",
  "tariffType": "domestic|commercial|industrial|agricultural|other",
  "voltageLevel": "voltage if shown, or null",
  "meterConfiguration": "prepaid|conventional|both|null",
  "description": "Brief description of tariff",
  "blocks": [
    {
      "blockNumber": 1,
      "kwhFrom": 0,
      "kwhTo": 50,
      "energyChargeCents": 175.08,
      "description": "Block description if shown"
    }
  ],
  "charges": [
    {
      "chargeType": "service_charge|basic_monthly|capacity_charge|demand_kva",
      "chargeAmount": 246.19,
      "description": "Charge description",
      "unit": "R/month|R/day|R/kVA"
    }
  ],
  "touPeriods": [
    {
      "periodName": "Peak|Standard|Off-peak",
      "timeRange": "06:00-09:00" or null if not shown,
      "energyChargeCents": 250.00,
      "season": "Summer|Winter|All" or null
    }
  ]
}

If no tariff data is visible, return minimal structure with empty arrays.

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
    const tariffData = JSON.parse(cleanedText);
    
    console.log("Extracted tariff data from image:", JSON.stringify(tariffData, null, 2));
    
    // Return in format compatible with frontend
    return new Response(
      JSON.stringify({ 
        success: true, 
        municipality: {
          name: tariffData.municipalityName || "",
          nersaIncrease: tariffData.nersaIncrease || 0
        },
        tariffData: tariffData
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

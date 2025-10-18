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

    // Phase 1: Identify municipalities
    if (phase === "identify") {
      return await identifyMunicipalities(documentContent);
    }
    
    // Phase 2: Extract specific municipality
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

async function identifyMunicipalities(documentContent: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  const identifyPrompt = `You are analyzing a South African electricity tariff document. Identify ALL municipalities/supply authorities mentioned in this document.

For Eskom documents, the supply authority is "Eskom Holdings SOC Ltd".
For municipal documents, identify each unique municipality name.

Return ONLY a JSON array of supply authority names, no markdown formatting.
Example: ["Eskom Holdings SOC Ltd"] or ["City of Cape Town", "City of Johannesburg"]

IMPORTANT: Return a simple string array only.`;

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
        { role: "user", content: `Identify all municipalities/supply authorities in this document:\n\n${documentContent.slice(0, 50000)}` }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    throw new Error("AI processing failed");
  }

  const aiResponse = await response.json();
  const extractedText = aiResponse.choices?.[0]?.message?.content;

  if (!extractedText) {
    throw new Error("No content in AI response");
  }

  try {
    const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const municipalities = JSON.parse(cleanedText);
    
    return new Response(
      JSON.stringify({ success: true, municipalities }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (parseError) {
    console.error("Failed to parse municipalities:", extractedText);
    return new Response(
      JSON.stringify({ error: "Failed to parse municipalities", details: extractedText }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function extractMunicipalityTariffs(documentContent: string, municipalityName: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  const systemPrompt = `You are a specialized data extraction assistant for South African electricity tariff documents. Extract tariff information ONLY for: ${municipalityName}

CRITICAL INSTRUCTIONS:
- Extract ONLY tariffs for "${municipalityName}"
- Ignore tariffs from other municipalities
- For Eskom tariffs, handle voltage levels (< 500V, ≥ 500V & < 66kV, ≥ 66kV & ≤132kV, > 132kV)
- For Eskom tariffs, handle transmission zones (≤ 300km, > 300km, > 600km, > 900km) if present
- Handle TOU periods: peak, standard, off-peak with seasonal variations
- Extract both High-demand season (Jun-Aug) and Low-demand season (Sep-May) rates
- Pay attention to c/kWh (energy charges), R/kVA/m (capacity charges), R/POD/day (service charges)

Extract:
1. Supply Authority details (name, region if mentioned, NERSA increase %)
2. Tariff Structures - create SEPARATE structures for each major tariff type found:
   - Name (e.g., "Megaflex", "Miniflex", "Nightsave Urban", "Homepower", "Homelight", etc.)
   - Type (domestic/commercial/industrial/agricultural)
   - Voltage level (if Eskom tariff)
   - Transmission zone (if applicable)
   - Meter configuration (prepaid/conventional/both)
   - Effective dates
   - Whether it uses TOU pricing
   - TOU type (nightsave/megaflex if applicable)

3. For each tariff structure:
   - If TOU tariff, extract time periods with rates for peak/standard/off-peak
   - Extract blocks if present (for non-TOU residential tariffs)
   - Extract ALL fixed charges: generation capacity, transmission network, distribution network, service, administration
   - Extract variable charges: legacy charges, ancillary service, reactive energy
   - Extract subsidy charges if present

Return valid JSON only, no markdown formatting. Structure:
{
  "supplyAuthority": {
    "name": "string",
    "region": "string (optional)",
    "nersaIncreasePercentage": number (optional)
  },
  "tariffStructures": [{
    "name": "string",
    "tariffType": "domestic|commercial|industrial|agricultural",
    "voltageLevel": "string (optional)",
    "transmissionZone": "string (optional)",
    "meterConfiguration": "prepaid|conventional|both|null",
    "effectiveFrom": "YYYY-MM-DD",
    "effectiveTo": "YYYY-MM-DD or null",
    "description": "string",
    "usesTou": boolean,
    "touType": "nightsave|megaflex|miniflex|homeflex|ruraflex|null",
    "blocks": [{
      "blockNumber": number,
      "kwhFrom": number,
      "kwhTo": number or null,
      "energyChargeCents": number
    }],
    "charges": [{
      "chargeType": "generation_capacity|transmission_network|distribution_network_capacity|distribution_network_demand|service|administration|legacy|ancillary|reactive_energy|affordability_subsidy|rural_subsidy|basic_monthly",
      "chargeAmount": number,
      "description": "string",
      "unit": "R/kVA/month|R/POD/day|c/kWh|c/kVArh|R/month"
    }],
    "touPeriods": [{
      "periodType": "peak|standard|off_peak",
      "season": "high_demand|low_demand|all_year",
      "dayType": "weekday|saturday|sunday|weekend|all_days",
      "startHour": number (0-23),
      "endHour": number (0-23),
      "energyChargeCents": number
    }]
  }]
}`;

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
        { role: "user", content: `Extract tariff data for ${municipalityName}:\n\n${documentContent.slice(0, 100000)}` }
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
      JSON.stringify({ error: "AI processing failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const aiResponse = await response.json();
  const extractedText = aiResponse.choices?.[0]?.message?.content;

  if (!extractedText) {
    throw new Error("No content in AI response");
  }

  try {
    const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const extractedData = JSON.parse(cleanedText);
    
    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (parseError) {
    console.error("Failed to parse AI response as JSON:", extractedText);
    return new Response(
      JSON.stringify({ error: "Failed to parse extracted data", details: extractedText }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

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
    const { documentContent } = await req.json();
    
    if (!documentContent) {
      return new Response(
        JSON.stringify({ error: "Document content is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are a specialized data extraction assistant for South African electricity tariff documents (NERSA-approved and Eskom tariffs). Your task is to extract structured tariff information.

CRITICAL INSTRUCTIONS:
- Extract ALL tariff structures found in the document
- For Eskom tariffs, handle voltage levels (< 500V, ≥ 500V & < 66kV, ≥ 66kV & ≤132kV, > 132kV)
- For Eskom tariffs, handle transmission zones (≤ 300km, > 300km, > 600km, > 900km) if present
- Handle TOU periods: peak, standard, off-peak with seasonal variations
- Extract both High-demand season (Jun-Aug) and Low-demand season (Sep-May) rates
- Pay attention to c/kWh (energy charges), R/kVA/m (capacity charges), R/POD/day (service charges)
- For Eskom, the supply authority name is always "Eskom Holdings SOC Ltd"

Extract:
1. Supply Authority details (name like "Eskom Holdings SOC Ltd" or municipality name, region if mentioned, NERSA increase %)
2. Tariff Structures - create SEPARATE structures for each major tariff type found:
   - Name (e.g., "Megaflex", "Miniflex", "Nightsave Urban", "Homepower", "Homelight", etc.)
   - Type (domestic/commercial/industrial/agricultural)
   - Voltage level (if Eskom tariff: "< 500V", "≥ 500V & < 66kV", "≥ 66kV & ≤132kV", "> 132kV")
   - Transmission zone (if applicable: "≤ 300km", "> 300km", "> 600km", "> 900km")
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
    "name": "string (e.g., 'Eskom Holdings SOC Ltd' or municipality name)",
    "region": "string (optional)",
    "nersaIncreasePercentage": number (optional)
  },
  "tariffStructures": [{
    "name": "string (e.g., 'Megaflex < 500V', 'Nightsave Urban Large', 'Homepower Standard')",
    "tariffType": "domestic|commercial|industrial|agricultural",
    "voltageLevel": "string (for Eskom: '< 500V', '≥ 500V & < 66kV', '≥ 66kV & ≤132kV', '> 132kV')",
    "transmissionZone": "string (for Eskom: '≤ 300km', '> 300km', '> 600km', '> 900km', or null)",
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
}

IMPORTANT: 
- For Eskom tariffs, create SEPARATE tariff structures for EACH voltage level if rates differ
- Include ALL charge types found (generation capacity, transmission, distribution, service, admin, etc.)
- For TOU tariffs, extract rates for BOTH high-demand and low-demand seasons
- Always check for VAT-inclusive values and use those when available
- If a tariff has multiple voltage levels, create one structure per voltage level with the voltage in the name`;

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
          { role: "user", content: `Extract tariff data from this document:\n\n${documentContent.slice(0, 100000)}` }
        ],
        temperature: 0.1,
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

    // Parse the JSON response
    let extractedData;
    try {
      // Remove markdown code blocks if present
      const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", extractedText);
      return new Response(
        JSON.stringify({ error: "Failed to parse extracted data", details: extractedText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

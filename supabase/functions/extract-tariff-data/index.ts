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

    const systemPrompt = `You are a specialized data extraction assistant for South African NERSA tariff documents. Your task is to extract structured tariff information from municipality energy tariff documents.

Extract the following information:
1. Supply Authority/Municipality details (name, region, NERSA increase percentage if mentioned)
2. Tariff Structures with:
   - Name (e.g., "Domestic Prepaid", "Commercial Conventional")
   - Type (domestic, commercial, industrial, agricultural)
   - Meter configuration (prepaid, conventional, both)
   - Effective dates
   - Whether it uses Time-of-Use (TOU) pricing
3. For each tariff structure, extract:
   - Tariff blocks (block number, kWh from, kWh to, energy charge in cents)
   - Fixed charges (charge type like "basic_monthly", amount, description, unit)
   - If TOU: time periods (period type: peak/standard/off_peak, season, day type, hours, energy charge)

Return valid JSON only, no additional text. Structure:
{
  "supplyAuthority": {
    "name": "string",
    "region": "string",
    "nersaIncreasePercentage": number
  },
  "tariffStructures": [{
    "name": "string",
    "tariffType": "domestic|commercial|industrial|agricultural",
    "meterConfiguration": "prepaid|conventional|both",
    "effectiveFrom": "YYYY-MM-DD",
    "effectiveTo": "YYYY-MM-DD or null",
    "description": "string",
    "usesTou": boolean,
    "touType": "nightsave|megaflex|null",
    "blocks": [{
      "blockNumber": number,
      "kwhFrom": number,
      "kwhTo": number or null,
      "energyChargeCents": number
    }],
    "charges": [{
      "chargeType": "basic_monthly|demand|service",
      "chargeAmount": number,
      "description": "string",
      "unit": "R/month|R/kVA|R/day"
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
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract tariff data from this document:\n\n${documentContent.slice(0, 50000)}` }
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

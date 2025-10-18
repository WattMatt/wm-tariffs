import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();
    
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'Image URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Calling Lovable AI to extract meter data from schematic...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract all meter information from this electrical schematic diagram. For each meter/distribution board, extract:
- NO (meter number, e.g., DB-03, MB-1)
- NAME (meter name/location, e.g., ACKERMANS, MAIN BOARD 1)
- AREA (in m² - extract just the number, e.g., 406)
- RATING (with units, e.g., 100A TP, 150A TP)
- CABLE (cable specification, e.g., 4C x 50mm² ALU ECC CABLE)
- SERIAL (serial number, e.g., 35777285)
- CT (CT type, e.g., DOL, 150/5A, 300/5A)

Analyze the meter details to determine the meter_type:
- "council_bulk" - for main incoming council supply meters (typically highest rating, labeled as "INCOMING COUNCIL")
- "check_meter" - for bulk check meters or sub-main check meters (labeled as "BULK CHECK METER" or "CHECK METER")
- "distribution" - for distribution boards (labeled as DB-XX)

Return ONLY a JSON array of objects with these exact keys: meter_number, name, area (as number or null if not specified), rating, cable_specification, serial_number, ct_type, meter_type.

Important: Return ONLY the JSON array, no additional text or markdown formatting.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your Lovable AI workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    console.log('AI Response:', content);

    if (!content) {
      throw new Error('No content in AI response');
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Try to find JSON after removing markdown
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    }

    if (!jsonMatch) {
      console.error('Could not find JSON in response:', content);
      throw new Error('Could not parse meter data from AI response');
    }

    const meters = JSON.parse(jsonMatch[0]);
    
    console.log(`Successfully extracted ${meters.length} meters`);

    return new Response(
      JSON.stringify({ meters }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-schematic-meters:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Failed to extract meter data',
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

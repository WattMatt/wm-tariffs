import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    const { imageUrl, mode, rectangleId, rectangleBounds, region } = requestBody;
    
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

    console.log(`Calling Lovable AI in ${mode || 'full'} mode with image URL:`, imageUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

    // Different prompts based on mode
    let promptText = '';
    
    if (mode === 'detect-rectangles') {
      promptText = `You are an expert electrical engineer analyzing an electrical schematic diagram to identify all meter boxes and distribution board rectangles.

TASK: Identify ONLY the rectangular boxes/blocks that represent meters or distribution boards on this schematic.

For each rectangle found, return:
- id: A unique identifier (e.g., "rect_1", "rect_2", etc.)
- position: The center position of the rectangle
  - x: Distance from LEFT edge as percentage (0.0-100.0 with 1 decimal)
  - y: Distance from TOP edge as percentage (0.0-100.0 with 1 decimal)
- bounds: The approximate boundaries of the rectangle
  - width: Width as percentage of image (with 1 decimal)
  - height: Height as percentage of image (with 1 decimal)
- hasData: true (we'll update this after extraction)

Return ONLY a valid JSON array of rectangles. NO markdown, NO explanations.
Example: [{"id":"rect_1","position":{"x":25.5,"y":30.2},"bounds":{"width":8.5,"height":6.0},"hasData":true}]`;
    } else if (mode === 'extract-single') {
      promptText = `You are an expert electrical engineer extracting meter label information from a distribution board schematic with 100% fidelity to the original formatting.

FOCUS AREA: Extract data from the meter box at position x:${rectangleBounds.x}%, y:${rectangleBounds.y}%

CRITICAL RULES:
1. Preserve ALL units exactly as shown (m², A, TP, mm², ALU ECC CABLE, etc.)
2. Do NOT abbreviate or reformat values
3. All fields must be present - use null only if genuinely not visible
4. Extract exactly what you see, character-for-character

EXTRACT these fields with EXACT formatting:

- meter_number (NO): 
  - Extract exactly as labeled (e.g., "DB-01A", "MB-03", "INCOMING-01")
  
- name (NAME): 
  - Extract exactly as shown (e.g., "VACANT", "ACKERMANS", "MAIN BOARD 1")
  
- area (AREA): 
  - MUST include "m²" unit (e.g., "187m²", "406m²")
  - If no unit shown, add "m²" to the numeric value
  
- rating (RATING): 
  - MUST include full units (e.g., "150A TP", "100A TP", "250A TP")
  - Preserve spaces and formatting exactly
  
- cable_specification (CABLE): 
  - Full specification with ALL units (e.g., "4C x 95mm² ALU ECC CABLE", "4C x 50mm² ALU ECC CABLE")
  - Do NOT abbreviate "ALU ECC CABLE"
  
- serial_number (SERIAL): 
  - Extract number exactly (e.g., "35779383", "35777285")
  
- ct_type (CT): 
  - Extract with format/ratio (e.g., "150/5A", "DOL", "300/5A")

Return ONLY a valid JSON object with these exact keys.
NO markdown, NO explanations.
Example: {"meter_number":"DB-01A","name":"VACANT","area":"187m²","rating":"150A TP","cable_specification":"4C x 95mm² ALU ECC CABLE","serial_number":"35779383","ct_type":"150/5A"}`;
    } else if (mode === 'extract-region') {
      promptText = `You are an expert electrical engineer extracting meter label information from a distribution board schematic with 100% fidelity to the original formatting.

FOCUS AREA: Extract data ONLY from the highlighted region at position:
- Left: ${region.x}%, Top: ${region.y}%
- Width: ${region.width}%, Height: ${region.height}%

CRITICAL RULES:
1. Preserve ALL units exactly as shown (m², A, TP, mm², ALU ECC CABLE, etc.)
2. Do NOT abbreviate or reformat values
3. All fields must be present - use null only if genuinely not visible
4. Extract exactly what you see, character-for-character

EXTRACT these fields with EXACT formatting:

- meter_number (NO): 
  - Extract exactly as labeled (e.g., "DB-01A", "MB-03", "INCOMING-01")
  
- name (NAME): 
  - Extract exactly as shown (e.g., "VACANT", "ACKERMANS", "MAIN BOARD 1")
  
- area (AREA): 
  - MUST include "m²" unit (e.g., "187m²", "406m²")
  - If value appears as just a number, add "m²"
  
- rating (RATING): 
  - MUST include full units (e.g., "150A TP", "100A TP", "250A TP")
  - Preserve spaces and formatting exactly
  
- cable_specification (CABLE): 
  - Full specification with ALL units (e.g., "4C x 95mm² ALU ECC CABLE", "4C x 50mm² ALU ECC CABLE")
  - Do NOT abbreviate "ALU ECC CABLE"
  
- serial_number (SERIAL): 
  - Extract number exactly (e.g., "35779383", "35777285")
  
- ct_type (CT): 
  - Extract with format/ratio (e.g., "150/5A", "DOL", "300/5A")

- meter_type:
  - Determine from context: "council_bulk", "check_meter", "solar", or "distribution"

Return ONLY a valid JSON object with these exact keys.
NO markdown, NO explanations.
Example: {"meter_number":"DB-01A","name":"VACANT","area":"187m²","rating":"150A TP","cable_specification":"4C x 95mm² ALU ECC CABLE","serial_number":"35779383","ct_type":"150/5A","meter_type":"distribution"}`;
    } else {
      // Full extraction mode (original)
      promptText = `You are an expert electrical engineer analyzing an electrical schematic diagram to extract meter information with PIXEL-PERFECT position accuracy AND exact formatting preservation.

CRITICAL RULES:
1. Position measurements must be pixel-perfect for visual marker placement
2. Preserve ALL units exactly as shown (m², A, TP, mm², ALU ECC CABLE, etc.)
3. Do NOT abbreviate or reformat any values
4. Extract exactly what you see, character-for-character

STEP 1: ANALYZE THE SCHEMATIC LAYOUT
- Carefully examine the entire schematic image
- Identify every meter box, distribution board symbol, and meter connection point
- Note the visual structure and how meters are arranged

STEP 2: EXTRACT DATA FOR EACH METER WITH EXACT FORMATTING

For each meter/distribution board visible, extract:

- meter_number (NO): 
  - Extract exactly as labeled (e.g., "DB-01A", "DB-03", "INCOMING-01")
  
- name (NAME): 
  - Extract exactly as shown (e.g., "VACANT", "ACKERMANS", "MAIN BOARD 1")
  
- area (AREA): 
  - MUST include "m²" unit in the string (e.g., "187m²", "406m²")
  - If shown as just number, add "m²" to it
  
- rating (RATING): 
  - MUST include full units (e.g., "150A TP", "100A TP", "250A TP")
  - Preserve exact spacing and formatting
  
- cable_specification (CABLE): 
  - Full specification with ALL units (e.g., "4C x 95mm² ALU ECC CABLE")
  - Never abbreviate "ALU ECC CABLE"
  
- serial_number (SERIAL): 
  - Extract number exactly as shown (e.g., "35779383", "35777285")
  
- ct_type (CT): 
  - Extract with format/ratio (e.g., "150/5A", "DOL", "300/5A")

STEP 3: MEASURE EXACT POSITIONS (MOST CRITICAL)
For EVERY meter, measure its position with extreme precision:

1. Locate the VISUAL CENTER of the meter's box/symbol on the schematic
2. Measure from the image edges:
   - x = Distance from LEFT edge as percentage (0.0 = far left, 100.0 = far right)  
   - y = Distance from TOP edge as percentage (0.0 = top, 100.0 = bottom)
3. Use ONE decimal place precision (e.g., 23.5, 47.2, 88.1)
4. Verify each position visually before finalizing

POSITION EXAMPLES:
- Top-left corner meter: {"x": 12.5, "y": 15.3}
- Center meter: {"x": 50.0, "y": 50.0}
- Bottom-right meter: {"x": 87.3, "y": 91.2}

METER TYPE CLASSIFICATION:
- "council_bulk": Main incoming council supply (highest rating, labeled "INCOMING" or "COUNCIL")
- "check_meter": Check/verification meters (labeled "CHECK METER")  
- "distribution": Distribution boards (typically labeled DB-XX or similar)

VALIDATION:
- Every meter MUST have all fields present
- Every meter MUST have a position with valid x and y numbers
- Positions should match the visual layout of the schematic
- Adjacent meters should have adjacent position values
- Area must include "m²", rating must include "A TP" or similar

Return ONLY valid JSON array with exact keys: meter_number, name, area (string with m²), rating, cable_specification, serial_number, ct_type, meter_type, position (object with x and y as numbers 0-100).

NO markdown, NO explanations, ONLY the JSON array starting with [ and ending with ]
Example: [{"meter_number":"DB-01A","name":"VACANT","area":"187m²","rating":"150A TP","cable_specification":"4C x 95mm² ALU ECC CABLE","serial_number":"35779383","ct_type":"150/5A","meter_type":"distribution","position":{"x":25.5,"y":30.2}}]`;
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: promptText
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

    clearTimeout(timeoutId);

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

      return new Response(
        JSON.stringify({ error: `AI API error: ${response.status} - ${errorText}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('AI request completed successfully');
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error('No content in AI response');
      return new Response(
        JSON.stringify({ error: 'No content in AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('AI Response preview:', content.substring(0, 500));

    // Extract JSON from response (handle markdown code blocks and objects)
    let jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Try to find JSON after removing markdown
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
    }

    if (!jsonMatch) {
      console.error('Could not find JSON in response:', content.substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Could not parse data from AI response. Response did not contain valid JSON.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError, 'Content:', jsonMatch[0].substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Failed to parse JSON from AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (mode === 'detect-rectangles') {
      console.log(`Successfully detected ${result.length} rectangles`);
      return new Response(
        JSON.stringify({ rectangles: result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else if (mode === 'extract-single' || mode === 'extract-region') {
      // Validate all required fields are present
      const requiredFields = ['meter_number', 'name', 'rating', 'cable_specification', 'serial_number', 'ct_type'];
      const missingFields = requiredFields.filter(field => !result[field]);
      
      if (missingFields.length > 0) {
        console.warn(`⚠️ Missing fields in extracted data: ${missingFields.join(', ')}`);
      }
      
      // Validate area has m² unit
      if (result.area && !result.area.includes('m²')) {
        console.warn(`⚠️ Area field missing m² unit: ${result.area}`);
      }
      
      console.log(`✓ Meter label extracted successfully: ${result.meter_number} - ${result.name}`);
      console.log(`  Fields extracted: ${Object.keys(result).join(', ')}`);
      
      return new Response(
        JSON.stringify({ 
          meter: result,
          validation: {
            success: missingFields.length === 0,
            missingFields: missingFields.length > 0 ? missingFields : undefined
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Validate all meters have required fields
      let totalMissing = 0;
      result.forEach((meter: any, idx: number) => {
        const requiredFields = ['meter_number', 'name', 'rating', 'cable_specification', 'serial_number', 'ct_type'];
        const missingFields = requiredFields.filter(field => !meter[field]);
        if (missingFields.length > 0) {
          console.warn(`⚠️ Meter ${idx + 1} (${meter.meter_number || 'unknown'}) missing: ${missingFields.join(', ')}`);
          totalMissing++;
        }
        
        // Validate area format
        if (meter.area && !meter.area.includes('m²')) {
          console.warn(`⚠️ Meter ${idx + 1} area missing m² unit: ${meter.area}`);
        }
      });
      
      console.log(`✓ Successfully extracted ${result.length} meters`);
      if (totalMissing > 0) {
        console.warn(`⚠️ ${totalMissing} meters have missing fields`);
      }
      
      return new Response(
        JSON.stringify({ meters: result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Request timeout after 90 seconds');
      return new Response(
        JSON.stringify({ 
          error: 'Request timeout - the AI took too long to process the schematic. Please try again.',
        }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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

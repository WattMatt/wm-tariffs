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

IMPORTANT: Look ONLY within this rectangular region. Ignore all text and labels outside this area.

CRITICAL RULES:
1. Preserve ALL units exactly as shown (m², A, TP, mm², ALU ECC CABLE, etc.)
2. Do NOT abbreviate or reformat values
3. All fields must be present - use null only if genuinely not visible
4. Extract exactly what you see, character-for-character

EXTRACT these fields with EXACT formatting:

- meter_number (NO): 
  - Extract exactly as labeled (e.g., "DB-01A", "MB-03", "INCOMING-01")
  - Common label: "NO:", "NO.", or just visible meter number
  - Look for pattern: DB-XX, MB-XX, INCOMING-XX
  
- name (NAME): 
  - Extract exactly as shown (e.g., "VACANT", "ACKERMANS", "MAIN BOARD 1")
  - Common label: "NAME:", "TENANT:"
  - This is usually the tenant/occupant name
  
- area (AREA): 
  - MUST include "m²" unit (e.g., "187m²", "406m²")
  - Common label: "AREA:", "SIZE:"
  - If value appears as just a number, add "m²"
  
- rating (RATING): 
  - MUST include full units (e.g., "150A TP", "100A TP", "250A TP")
  - Common label: "RATING:", "SIZE:"
  - Preserve spaces and formatting exactly - TP means Three Phase
  
- cable_specification (CABLE): 
  - Full specification with ALL units (e.g., "4C x 95mm² ALU ECC CABLE")
  - Common label: "CABLE:", "CABLE SPEC:", "CABLE SIZE:"
  - Do NOT abbreviate "ALU ECC CABLE"
  - Format: "XC x XXmm² ALU ECC CABLE"
  
- serial_number (SERIAL): 
  - Extract number exactly (e.g., "35779383", "35777285")
  - Common label: "SERIAL:", "S/N:", "METER NO:"
  - Usually an 8-digit number
  
- ct_type (CT): 
  - Extract with format/ratio (e.g., "150/5A", "DOL", "300/5A")
  - Common label: "CT:", "CT RATIO:", "CT TYPE:"

- meter_type:
  - Determine from context: "council_bulk", "check_meter", "solar", or "distribution"

Return ONLY a valid JSON object with these exact keys.
NO markdown, NO explanations.
Example: {"meter_number":"DB-01A","name":"VACANT","area":"187m²","rating":"150A TP","cable_specification":"4C x 95mm² ALU ECC CABLE","serial_number":"35779383","ct_type":"150/5A","meter_type":"distribution"}`;
    } else {
      // Full extraction mode - MAXIMUM ACCURACY REQUIRED
      promptText = `You are an expert electrical engineer performing CRITICAL DATA EXTRACTION from an electrical schematic. This data will be used for financial calculations and legal compliance - 100% accuracy is MANDATORY.

⚠️ CRITICAL IMPORTANCE: Meter serial numbers and specifications are legally binding and financially significant. Any errors could result in serious consequences.

ACCURACY REQUIREMENTS:
- Extract data with ZERO tolerance for errors
- If ANY field is unclear or ambiguous, mark it with "VERIFY:" prefix
- If a field is genuinely not visible, use "NOT_VISIBLE" not "*" or null
- Double-check every serial number character-by-character
- Preserve exact spacing, capitalization, and punctuation

SCANNING PROTOCOL:
1. Systematically scan ENTIRE schematic from top-left to bottom-right
2. Identify EVERY meter box - count them first, then extract
3. For partially visible or unclear text: mark field with "VERIFY:" prefix
4. For completely missing fields: use "NOT_VISIBLE"
5. Re-read serial numbers twice to ensure accuracy

CRITICAL DATA FIELDS (Zero error tolerance):

1. meter_number (NO): 
   - Extract EXACTLY as shown (e.g., "DB-01W", "MB-1 INCOMING COUNCIL")
   - Include all letters, numbers, hyphens, spaces
   - If unclear: prefix with "VERIFY:"

2. serial_number (SERIAL): ⚠️ MOST CRITICAL FIELD
   - Read character-by-character, verify twice
   - Common formats: 8-digit (35777285), alphanumeric (34020113A)
   - If ANY digit is unclear: prefix with "VERIFY:"
   - If not visible: use "NOT_VISIBLE"

3. name (NAME):
   - Exact text including capitalization (e.g., "CAR WASH", "VACANT")
   - Preserve spaces and special characters

4. area (AREA):
   - Include unit "m²" (e.g., "187m²", "1214m²")
   - If not shown: "NOT_VISIBLE"

5. rating (RATING):
   - Include units (e.g., "80A TP", "150A TP", "300A TP")
   - TP = Three Phase (never abbreviate)

6. cable_specification (CABLE):
   - Complete spec: "4C x 16mm² ALU ECC CABLE"
   - Never abbreviate, preserve exact format
   - If truncated or unclear: extract what's visible + "VERIFY:"

7. ct_type (CT):
   - Exact format (e.g., "DOL", "150/5A", "300/5A")

8. meter_type:
   - "council_bulk": Main incoming (labeled INCOMING/COUNCIL)
   - "check_meter": Check meters (labeled CHECK METER/BULK CHECK)
   - "distribution": All other meters (DB-XX)

POSITIONING (CRITICAL - This determines visual overlay accuracy):
- position.x: Percentage from LEFT edge to meter box CENTER (0.0 = left edge, 100.0 = right edge)
- position.y: Percentage from TOP edge to meter box CENTER (0.0 = top edge, 100.0 = bottom edge)
- Use 1 decimal precision (e.g., 33.7, not 33 or 34)
- Measure to the CENTER of each meter's rectangular box

SCALING (Match actual meter size on PDF):
- scale_x: Width factor (measure meter box width relative to standard ~200px width)
- scale_y: Height factor (measure meter box height relative to standard ~140px height)
- If all meters same size: use 1.0 for all
- If meters vary: adjust proportionally (0.8 = 80% size, 1.2 = 120% size)
- Typical range: 0.5 to 2.0

VALIDATION CHECKLIST:
✓ Found ALL meters (count carefully)
✓ Each meter has complete data (no missing fields)
✓ Positions reflect actual visual layout
✓ Scales match relative sizes on schematic
✓ All units preserved (m², A TP, mm², ALU ECC CABLE)

OUTPUT FORMAT:
{
  "meters": [
    {
      "meter_number": "DB-01W",
      "name": "CAR WASH",
      "area": "187m²",
      "rating": "80A TP",
      "cable_specification": "4C x 16mm² ALU ECC CABLE",
      "serial_number": "34020113A",
      "ct_type": "DOL",
      "meter_type": "distribution",
      "position": {"x": 33.7, "y": 49.0},
      "scale_x": 1.0,
      "scale_y": 1.0
    }
  ]
}

Return ONLY valid JSON. NO markdown, NO explanations.`;

    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro', // Using most powerful model for maximum accuracy
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
      // Full extraction mode - handle both array and object with meters array
      let metersArray;
      if (Array.isArray(result)) {
        // Old format: direct array
        metersArray = result;
      } else if (result.meters && Array.isArray(result.meters)) {
        // New format: object with meters property
        metersArray = result.meters;
      } else {
        console.error('Unexpected result format:', result);
        return new Response(
          JSON.stringify({ error: 'Unexpected response format from AI' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate all meters have required fields
      let totalMissing = 0;
      metersArray.forEach((meter: any, idx: number) => {
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
      
      console.log(`✓ Successfully extracted ${metersArray.length} meters`);
      if (totalMissing > 0) {
        console.warn(`⚠️ ${totalMissing} meters have missing fields`);
      }
      
      return new Response(
        JSON.stringify({ meters: metersArray }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Fallback return (should never reach here)
    return new Response(
      JSON.stringify({ error: 'Invalid mode or unexpected condition' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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

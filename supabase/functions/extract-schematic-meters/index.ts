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
    let { imageUrl, mode, rectangleId, rectangleBounds, region } = requestBody;
    
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
      // Use absolute pixel coordinates for precise region extraction
      console.log('🎯 Extract-region mode - analyzing region:', {
        pixels: { 
          x: Math.round(region.x), 
          y: Math.round(region.y), 
          width: Math.round(region.width), 
          height: Math.round(region.height) 
        },
        imageSize: {
          width: Math.round(region.imageWidth),
          height: Math.round(region.imageHeight)
        }
      });
      
      promptText = `You are an expert electrical engineer analyzing an electrical schematic diagram.

⚠️ CRITICAL INSTRUCTION: This image has been pre-cropped to show ONLY the meter information box you need to analyze.

Extract ALL meter data visible in this cropped image.

METER DATA TO EXTRACT:

1. meter_number (NO): Extract exactly as shown (e.g., "DB-01A", "MB-03", "INCOMING-01")
2. name (NAME): Business/tenant name or "VACANT"
3. area (AREA): Include unit "m²" (e.g., "187m²", "406m²")
4. rating (RATING): Include full units (e.g., "150A TP", "100A TP")
5. cable_specification (CABLE): Full spec with units (e.g., "4C x 95mm² ALU ECC CABLE")
6. serial_number (SERIAL): Exact number (e.g., "35779383")
7. ct_type (CT): Format/ratio (e.g., "150/5A", "DOL")

METER TYPE INFERENCE (automatic classification):
- If meter_number contains "INCOMING", "COUNCIL", or "BULK" → meter_type: "bulk"
- If meter_number contains "CHECK" → meter_type: "check_meter"
- Otherwise → meter_type: "submeter"

ZONE EXTRACTION:
- If zone label visible (e.g., "MAIN BOARD 1", "MINI SUB 2"), extract it
- Otherwise set zone to null

Return ONLY valid JSON with these exact fields. Use null for fields not visible.
NO markdown, NO explanations.

Example: {"meter_number":"DB-03","name":"ACKERMANS","area":"434m²","rating":"100A TP","cable_specification":"4C x 35mm² ALU ECC CABLE","serial_number":"35777225","ct_type":"DOL","meter_type":"submeter","zone":null}`;
    } else {
      // Full extraction mode - MAXIMUM ACCURACY REQUIRED
      promptText = `You are an expert electrical engineer performing CRITICAL DATA EXTRACTION from an electrical schematic. This data will be used for financial calculations and legal compliance - 100% accuracy is MANDATORY.

⚠️ CRITICAL IMPORTANCE: Meter serial numbers and specifications are legally binding and financially significant. Any errors could result in serious consequences.

METER BLOCK FORMAT - EXACT STANDARD:
Each meter on this schematic is represented by a RECTANGULAR TABLE BOX with the following exact structure:

┌──────────┬─────────────────────────────────┐
│ NO:      │ DB-01A                          │
├──────────┼─────────────────────────────────┤
│ NAME:    │ VACANT                          │
├──────────┼─────────────────────────────────┤
│ AREA:    │ 187m²                           │
├──────────┼─────────────────────────────────┤
│ RATING:  │ 150A TP                         │
├──────────┼─────────────────────────────────┤
│ CABLE:   │ 4C x 95mm² ALU ECC CABLE       │
├──────────┼─────────────────────────────────┤
│ SERIAL:  │ 35779383                        │
├──────────┼─────────────────────────────────┤
│ CT:      │ 150/5A                          │
└──────────┴─────────────────────────────────┘

CRITICAL RECOGNITION RULES:
- Each meter is a BORDERED TABLE with 7 rows (NO, NAME, AREA, RATING, CABLE, SERIAL, CT)
- Left column contains LABELS ending with colon (:)
- Right column contains VALUES
- This is a STANDARDIZED template - every meter follows this exact format
- Extract the VALUE from each row, preserving exact formatting

ACCURACY REQUIREMENTS:
- Extract data with ZERO tolerance for errors
- Look for rectangular table boxes with this exact 7-row structure
- Each meter block uses this standardized template with consistent field labels
- If ANY field is unclear or ambiguous, mark it with "VERIFY:" prefix
- If a field is genuinely not visible, use "NOT_VISIBLE" not "*" or null
- Double-check every serial number character-by-character
- Preserve exact spacing, capitalization, and punctuation from the VALUE column

SCANNING PROTOCOL:
1. Identify all rectangular table boxes following this exact 7-row format
2. Systematically scan ENTIRE schematic from top-left to bottom-right
3. Count all meter table boxes first, then extract data from each
4. For partially visible or unclear text: mark field with "VERIFY:" prefix
5. For completely missing fields: use "NOT_VISIBLE"
6. Re-read serial numbers twice to ensure accuracy

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

9. zone (optional):
   - If meter is within a MAIN BOARD ZONE, extract the zone identifier
   - Main board zones have distinct visual characteristics:
     * Framed by a LARGE RECTANGULAR BORDER (often purple/magenta color)
     * Contains a THICK HORIZONTAL BAR inside representing the BUS BAR
     * Zone label at top (e.g., "MAIN BOARD 1", "MAIN BOARD 3", "MB-1")
     * Multiple meters/meter blocks positioned within this zone
   - If meter is within such a zone, set zone to the zone label (e.g., "MAIN BOARD 3")
   - If meter is standalone/not in a main board zone, set zone to null

   - MINI SUB zones have these distinct visual features:
     * Rectangular border/frame (similar to main boards but no thick bus bar)
     * Contains TWO OVERLAPPING CIRCLES (transformer symbol) in the center/lower area
     * Text label showing "MINI SUB X" and power rating (e.g., "MINI SUB 1 800kVA")
     * Electrical connection lines at top and bottom (incoming/outgoing connections)
     * May contain meters connected to this mini sub
   - If meter is within a Mini Sub zone, set zone to the label (e.g., "MINI SUB 1")

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

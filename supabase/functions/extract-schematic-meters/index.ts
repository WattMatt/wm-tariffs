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
    const { imageUrl, filePath, mode } = await req.json();
    
    if (!imageUrl && !filePath) {
      return new Response(
        JSON.stringify({ error: 'Image URL or file path is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Check if the file is a PDF and needs conversion
    let processedImageUrl = imageUrl;
    
    if (filePath && filePath.toLowerCase().endsWith('.pdf')) {
      console.log('PDF detected, converting to image...');
      
      // For PDFs, we'll fetch the file and convert the first page to an image
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Download the PDF from storage
      const { data: pdfData, error: downloadError } = await supabase
        .storage
        .from('schematics')
        .download(filePath);
        
      if (downloadError || !pdfData) {
        console.error('Error downloading PDF:', downloadError);
        throw new Error('Failed to download PDF file');
      }

      console.log('PDF downloaded, converting to base64 image...');
      
      // Convert PDF blob to array buffer
      const arrayBuffer = await pdfData.arrayBuffer();
      const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      // Use PDF as base64 data URL - the AI can handle PDFs as images
      processedImageUrl = `data:application/pdf;base64,${base64Pdf}`;
      
      console.log('PDF converted to base64 data URL');
    }

    console.log(`Calling Lovable AI in ${mode || 'full'} mode...`);

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
      const { rectangleId, rectangleBounds } = await req.json();
      promptText = `You are an expert electrical engineer extracting detailed meter information from a specific rectangle on an electrical schematic.

FOCUS AREA: Extract data from the meter box at position x:${rectangleBounds.x}%, y:${rectangleBounds.y}%

Extract the following from this SPECIFIC meter box:
- meter_number (NO): e.g., DB-03, MB-1, INCOMING-01
- name (NAME/description): e.g., ACKERMANS, MAIN BOARD 1
- area (AREA in m²): numeric value only, e.g., 406
- rating (RATING): Include units, e.g., 100A TP, 150A TP
- cable_specification (CABLE): Full spec, e.g., 4C x 50mm² ALU ECC CABLE
- serial_number (SERIAL): e.g., 35777285
- ct_type (CT): e.g., DOL, 150/5A, 300/5A

Return ONLY a valid JSON object with these exact keys. If a field is not visible, use null.
NO markdown, NO explanations.`;
    } else if (mode === 'extract-region') {
      const { region } = await req.json();
      promptText = `You are an expert electrical engineer extracting detailed meter information from a specific drawn region on an electrical schematic.

FOCUS AREA: Extract data ONLY from the highlighted region at position:
- Left: ${region.left}%, Top: ${region.top}%
- Width: ${region.width}%, Height: ${region.height}%

Analyze ONLY the content within this specific region and extract:
- meter_number (NO): e.g., DB-03, MB-1, INCOMING-01
- name (NAME/description): e.g., ACKERMANS, MAIN BOARD 1
- area (AREA in m²): numeric value only, e.g., 406
- rating (RATING): Include units, e.g., 100A TP, 150A TP
- cable_specification (CABLE): Full spec, e.g., 4C x 50mm² ALU ECC CABLE
- serial_number (SERIAL): e.g., 35777285
- ct_type (CT): e.g., DOL, 150/5A, 300/5A
- meter_type: one of: council_bulk, check_meter, solar, distribution

Return ONLY a valid JSON object with these exact keys. If a field is not visible, use null.
NO markdown, NO explanations.`;
    } else {
      // Full extraction mode (original)
      promptText = `You are an expert electrical engineer analyzing an electrical schematic diagram to extract meter information with PIXEL-PERFECT position accuracy.

CRITICAL: Your position measurements will directly control marker placement on the visual schematic. Inaccurate positions render the system unusable.

STEP 1: ANALYZE THE SCHEMATIC LAYOUT
- Carefully examine the entire schematic image
- Identify every meter box, distribution board symbol, and meter connection point
- Note the visual structure and how meters are arranged

STEP 2: EXTRACT DATA FOR EACH METER
For each meter/distribution board visible, extract:
- NO (meter number): e.g., DB-03, MB-1, INCOMING-01
- NAME (location/description): e.g., ACKERMANS, MAIN BOARD 1, INCOMING COUNCIL
- AREA (m²): Extract numeric value only, e.g., 406
- RATING: Include units, e.g., 100A TP, 150A TP, 250A TP
- CABLE: Full cable specification, e.g., 4C x 50mm² ALU ECC CABLE
- SERIAL: Serial number, e.g., 35777285
- CT: CT type/rating, e.g., DOL, 150/5A, 300/5A

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
- Every meter MUST have a position with valid x and y numbers
- Positions should match the visual layout of the schematic
- Adjacent meters should have adjacent position values

Return ONLY valid JSON array with exact keys: meter_number, name, area (number or null), rating, cable_specification, serial_number, ct_type, meter_type, position (object with x and y as numbers 0-100).

NO markdown, NO explanations, ONLY the JSON array starting with [ and ending with ]`;
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
                  url: processedImageUrl
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
      console.log(`Successfully extracted data for single meter`);
      return new Response(
        JSON.stringify({ meter: result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      console.log(`Successfully extracted ${result.length} meters`);
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

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
    const { imageUrl, filePath } = await req.json();
    
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

    console.log('Calling Lovable AI to extract meter data from schematic...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

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
                text: `You are an expert electrical engineer analyzing an electrical schematic diagram to extract meter information with PIXEL-PERFECT position accuracy.

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

NO markdown, NO explanations, ONLY the JSON array starting with [ and ending with ]`
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

    // Extract JSON from response (handle markdown code blocks)
    let jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Try to find JSON after removing markdown
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    }

    if (!jsonMatch) {
      console.error('Could not find JSON in response:', content.substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Could not parse meter data from AI response. Response did not contain valid JSON array.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let meters;
    try {
      meters = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError, 'Content:', jsonMatch[0].substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Failed to parse meter data JSON from AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Successfully extracted ${meters.length} meters`);

    return new Response(
      JSON.stringify({ meters }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

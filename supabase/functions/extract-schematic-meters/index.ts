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
- POSITION (the approximate position of this meter on the schematic as a percentage from top-left corner, e.g., {"x": 25, "y": 30} means 25% from left edge and 30% from top edge)

Analyze the meter details to determine the meter_type:
- "council_bulk" - for main incoming council supply meters (typically highest rating, labeled as "INCOMING COUNCIL")
- "check_meter" - for bulk check meters or sub-main check meters (labeled as "BULK CHECK METER" or "CHECK METER")
- "distribution" - for distribution boards (labeled as DB-XX)

Return ONLY a JSON array of objects with these exact keys: meter_number, name, area (as number or null if not specified), rating, cable_specification, serial_number, ct_type, meter_type, position (with x and y percentages).

Important: Return ONLY the JSON array, no additional text or markdown formatting.`
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

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
    const { sheetData, municipalityName, cropRegion } = await req.json();
    
    if (!sheetData || !municipalityName) {
      throw new Error('Missing required parameters: sheetData and municipalityName');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Filter sheet data if crop region is provided
    let filteredSheetData = sheetData;
    if (cropRegion) {
      console.log('Applying crop region filter:', cropRegion);
      
      const { y, height, imageHeight, x, width, imageWidth } = cropRegion;
      
      // Calculate which rows to include based on Y coordinates
      const totalRows = sheetData.length;
      const startRowIndex = Math.floor((y / imageHeight) * totalRows);
      const endRowIndex = Math.ceil(((y + height) / imageHeight) * totalRows);
      
      // Extract rows within the region
      const rowsInRegion = sheetData.slice(startRowIndex, endRowIndex);
      
      // For each row, filter columns based on X coordinates
      filteredSheetData = rowsInRegion.map((row: any[]) => {
        if (!row || row.length === 0) return row;
        
        const totalCols = row.length;
        const startColIndex = Math.floor((x / imageWidth) * totalCols);
        const endColIndex = Math.ceil(((x + width) / imageWidth) * totalCols);
        
        return row.slice(startColIndex, endColIndex);
      });
      
      console.log(`Filtered from ${sheetData.length} rows to ${filteredSheetData.length} rows`);
    }

    // Convert sheet data to a readable text format for AI
    const sheetText = filteredSheetData.map((row: any[], idx: number) => 
      `Row ${idx + 1}: ${row.map(cell => cell?.toString() || '').join(' | ')}`
    ).join('\n');

    const systemPrompt = `You are an expert at extracting South African municipal electricity tariff data from spreadsheets.

Your task is to analyze the provided spreadsheet data and extract:
1. NERSA increase percentage (look for patterns like "12.72%", "NERSA: 15%", "approved increase", etc.)
2. All tariff structures with their names
3. For each tariff structure:
   - Tariff blocks (kWh ranges with cents/kWh rates)
   - Additional charges (fixed charges, demand charges, etc. with amounts and units)
   - Whether it uses Time-of-Use (TOU) pricing
   - Voltage level if specified
   - Any seasonal variations

Important rules:
- Energy charges are typically in cents/kWh (c/kWh)
- Fixed charges are typically in Rands (R)
- Look for block structures like "0-600 kWh @ 150c/kWh"
- Common charge types: service charge, network charge, demand charge, capacity charge
- TOU periods: peak, standard, off-peak with different rates
- Be thorough - extract ALL tariff structures found in the data
${cropRegion ? '- Focus only on the data provided, which is from a selected region of the document' : ''}

Return your findings in JSON format.`;

    const userPrompt = `Extract tariff data from this spreadsheet for ${municipalityName}:\n\n${sheetText.substring(0, 15000)}`;

    console.log('Calling AI for tariff extraction...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_tariff_data',
            description: 'Extract structured tariff data from municipality spreadsheet',
            parameters: {
              type: 'object',
              properties: {
                nersaIncrease: {
                  type: 'number',
                  description: 'The NERSA approved percentage increase (e.g., 12.72)'
                },
                tariffStructures: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: {
                        type: 'string',
                        description: 'Name of the tariff structure'
                      },
                      tariffType: {
                        type: 'string',
                        enum: ['domestic', 'commercial', 'industrial', 'agricultural'],
                        description: 'Tariff type: domestic (residential/household), commercial (business), industrial (manufacturing), agricultural (farming)'
                      },
                      voltageLevel: {
                        type: 'string',
                        description: 'Voltage level if specified'
                      },
                      usesTou: {
                        type: 'boolean',
                        description: 'Whether it uses time-of-use pricing'
                      },
                      blocks: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            blockNumber: { type: 'integer' },
                            kwhFrom: { type: 'number' },
                            kwhTo: { type: 'number', nullable: true },
                            energyChargeCents: { type: 'number' }
                          },
                          required: ['blockNumber', 'kwhFrom', 'energyChargeCents']
                        }
                      },
                      charges: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            chargeType: {
                              type: 'string',
                              description: 'Type like service_charge, network_charge, demand_charge'
                            },
                            description: { type: 'string' },
                            chargeAmount: { type: 'number' },
                            unit: {
                              type: 'string',
                              description: 'Unit like R/month, R/kVA, c/kWh'
                            }
                          },
                          required: ['chargeType', 'chargeAmount', 'unit']
                        }
                      },
                      touPeriods: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            periodType: {
                              type: 'string',
                              enum: ['peak', 'standard', 'off_peak']
                            },
                            season: {
                              type: 'string',
                              enum: ['summer', 'winter', 'all_year']
                            },
                            dayType: {
                              type: 'string',
                              enum: ['weekday', 'weekend', 'all_days']
                            },
                            startHour: { type: 'integer', minimum: 0, maximum: 23 },
                            endHour: { type: 'integer', minimum: 0, maximum: 23 },
                            energyChargeCents: { type: 'number' }
                          },
                          required: ['periodType', 'season', 'dayType', 'startHour', 'endHour', 'energyChargeCents']
                        }
                      }
                    },
                    required: ['name', 'tariffType', 'usesTou', 'blocks', 'charges']
                  }
                }
              },
              required: ['nersaIncrease', 'tariffStructures'],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'extract_tariff_data' } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted. Please add credits to your workspace.');
      }
      
      throw new Error(`AI Gateway error: ${aiResponse.status}`);
    }

    const result = await aiResponse.json();
    console.log('AI response received');
    
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    
    // Validate and normalize tariff types
    const validTariffTypes = ['domestic', 'commercial', 'industrial', 'agricultural'];
    
    // Allowed charge types from database constraint
    const validChargeTypes = [
      'basic_monthly',
      'demand_kva',
      'access_charge',
      'capacity_charge',
      'amp_charge',
      'service_charge',
      'network_charge',
      'fixed_charge'
    ];
    
    // Function to normalize charge type
    const normalizeChargeType = (chargeType: string): string => {
      const normalized = chargeType.toLowerCase().replace(/[^a-z_]/g, '_');
      
      // If it's already valid, return it
      if (validChargeTypes.includes(normalized)) return normalized;
      
      // Map common variations
      if (normalized.includes('demand')) return 'demand_kva';
      if (normalized.includes('service')) return 'service_charge';
      if (normalized.includes('network')) return 'network_charge';
      if (normalized.includes('capacity')) return 'capacity_charge';
      if (normalized.includes('access')) return 'access_charge';
      if (normalized.includes('amp')) return 'amp_charge';
      if (normalized.includes('basic') || normalized.includes('monthly')) return 'basic_monthly';
      
      // Default fallback
      return 'service_charge';
    };
    
    extractedData.tariffStructures = extractedData.tariffStructures?.map((ts: any) => ({
      ...ts,
      tariffType: validTariffTypes.includes(ts.tariffType?.toLowerCase()) 
        ? ts.tariffType.toLowerCase() 
        : 'commercial', // default fallback
      charges: ts.charges?.map((charge: any) => ({
        ...charge,
        chargeType: normalizeChargeType(charge.chargeType)
      })) || []
    }));
    
    console.log(`✓ Extracted data for ${municipalityName}:`, {
      nersaIncrease: extractedData.nersaIncrease,
      tariffCount: extractedData.tariffStructures?.length || 0
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: extractedData,
        municipalityName
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in extract-tariff-ai:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

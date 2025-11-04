import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PdfSection {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'page-break' | 'chart';
  editable: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, sections, selectionArea } = await req.json();
    
    if (!prompt || !sections) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Build context about the current sections for the AI
    const sectionsContext = sections
      .map((s: PdfSection, idx: number) => `Section ${idx + 1} (${s.type}): ${s.title}\n${s.content.substring(0, 200)}...`)
      .join('\n\n');

    const systemPrompt = `You are an AI assistant helping to edit PDF report sections. The user has selected an area on the PDF and wants to make changes.

Current sections in the report:
${sectionsContext}

When the user asks for changes:
1. If they want page breaks, insert page-break sections between appropriate sections
2. If they want to modify text, update the content of relevant sections
3. If they want to ADD charts (pie, bar), you should EMBED the chart JSON within the content of an existing or new text section

CHART EMBEDDING FORMAT:
When adding charts, embed them within text content like this:

For a PIE chart showing supply breakdown:
\`\`\`json
{
  "type": "pie",
  "data": {
    "labels": ["Council Bulk Supply", "Solar Generation"],
    "datasets": [{
      "data": [113187.07, 82759.01]
    }]
  }
}
\`\`\`

For a BAR chart:
\`\`\`json
{
  "type": "bar",
  "data": {
    "labels": ["Meter 1", "Meter 2", "Meter 3"],
    "datasets": [{
      "data": [1000, 1500, 2000]
    }]
  }
}
\`\`\`

IMPORTANT RULES:
- Charts must be embedded WITHIN the "content" field of a text section, surrounded by markdown code fences
- Do NOT create separate sections with type: "chart"
- Use accurate data from the report (e.g., for supply pie chart, only include supply sources, NOT distribution or variance)
- Return ONLY a valid JSON array of sections, no additional text
- Each section must have: id, title, content, type ('text', 'page-break', or 'chart'), and editable (boolean)`;

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
          { role: 'user', content: `User's request: "${prompt}"\n\nSelection area: ${JSON.stringify(selectionArea)}\n\nCurrent sections (JSON):\n${JSON.stringify(sections, null, 2)}\n\nPlease return the modified sections array.` }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const errorText = await aiResponse.text();
      console.error('AI gateway error:', aiResponse.status, errorText);
      throw new Error('AI service error');
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '';
    
    console.log('AI response:', aiContent);

    // Try to parse the AI response as JSON
    let modifiedSections: PdfSection[];
    try {
      // Remove markdown code blocks if present
      const cleanedContent = aiContent
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      modifiedSections = JSON.parse(cleanedContent);
      
      // Validate the structure
      if (!Array.isArray(modifiedSections)) {
        throw new Error('Response is not an array');
      }
      
      // Ensure all sections have required fields
      modifiedSections = modifiedSections.map((section: any, idx: number) => ({
        id: section.id || `section-${Date.now()}-${idx}`,
        title: section.title || 'Untitled Section',
        content: section.content || '',
        type: section.type === 'page-break' ? 'page-break' : (section.type === 'chart' ? 'chart' : 'text'),
        editable: section.editable !== false,
      }));
      
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError, aiContent);
      
      // Fallback: If user asked for page breaks, add them between all sections
      if (prompt.toLowerCase().includes('page break')) {
        modifiedSections = [];
        sections.forEach((section: PdfSection, idx: number) => {
          modifiedSections.push(section);
          // Add page break after each section except the last
          if (idx < sections.length - 1) {
            modifiedSections.push({
              id: `page-break-${Date.now()}-${idx}`,
              title: 'Page Break',
              content: '',
              type: 'page-break',
              editable: false,
            });
          }
        });
      } else {
        throw new Error('Could not parse AI response as valid sections');
      }
    }

    return new Response(
      JSON.stringify({ sections: modifiedSections }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Process PDF edit error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
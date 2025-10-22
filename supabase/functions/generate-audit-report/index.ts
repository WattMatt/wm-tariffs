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
    const { 
      siteName,
      auditPeriodStart,
      auditPeriodEnd,
      meterHierarchy,
      reconciliationData,
      documentExtractions,
      anomalies 
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are an expert electrical metering auditor specializing in South African municipal billing and sub-metering reconciliation. Generate professional audit report sections based on provided data.`;

    const sections: any = {};

    // Generate Executive Summary
    const executiveSummaryPrompt = `Generate a professional executive summary for a metering audit report for ${siteName}.

Audit Period: ${auditPeriodStart} to ${auditPeriodEnd}

Reconciliation Summary:
${JSON.stringify(reconciliationData, null, 2)}

Anomalies Found: ${anomalies?.length || 0}

Include:
- Purpose of the audit
- Scope and period
- Key findings (discrepancies, percentage variance)
- High-level recommendations

Keep it concise (2-3 paragraphs) and professional.`;

    const execSummaryResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: executiveSummaryPrompt }
        ],
      }),
    });

    if (!execSummaryResponse.ok) {
      throw new Error(`AI Gateway error: ${execSummaryResponse.status}`);
    }

    const execSummaryResult = await execSummaryResponse.json();
    sections.executiveSummary = execSummaryResult.choices[0].message.content;

    // Generate Metering Hierarchy Overview
    const hierarchyPrompt = `Generate a metering hierarchy overview for ${siteName}.

Metering Structure:
${JSON.stringify(meterHierarchy, null, 2)}

Include:
- Description of bulk supply meter
- Overview of distribution network
- Explanation of sub-metering layout
- Meter types and locations

Write in professional technical language (2 paragraphs).`;

    const hierarchyResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: hierarchyPrompt }
        ],
      }),
    });

    if (!hierarchyResponse.ok) {
      throw new Error(`AI Gateway error: ${hierarchyResponse.status}`);
    }

    const hierarchyResult = await hierarchyResponse.json();
    sections.hierarchyOverview = hierarchyResult.choices[0].message.content;

    // Generate Observations and Anomalies
    const observationsPrompt = `Generate an observations and anomalies section for the metering audit.

Anomalies Detected:
${JSON.stringify(anomalies, null, 2)}

Reconciliation Data:
${JSON.stringify(reconciliationData, null, 2)}

Include:
- Detailed analysis of each anomaly
- Potential causes (meter tampering, faults, bypassing)
- Load profile inconsistencies
- Missing or inaccessible meters
- Any billing discrepancies

Be specific and technical.`;

    const observationsResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: observationsPrompt }
        ],
      }),
    });

    if (!observationsResponse.ok) {
      throw new Error(`AI Gateway error: ${observationsResponse.status}`);
    }

    const observationsResult = await observationsResponse.json();
    sections.observations = observationsResult.choices[0].message.content;

    // Generate Recommendations
    const recommendationsPrompt = `Generate detailed recommendations for the metering audit findings.

Issues Found:
${JSON.stringify(anomalies, null, 2)}

Variance: ${reconciliationData.variancePercentage}%

Include:
- Remedial actions for discrepancies
- Metering infrastructure upgrades needed
- Billing workflow improvements
- Preventive measures for future audits

Provide actionable, prioritized recommendations.`;

    const recommendationsResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: recommendationsPrompt }
        ],
      }),
    });

    if (!recommendationsResponse.ok) {
      throw new Error(`AI Gateway error: ${recommendationsResponse.status}`);
    }

    const recommendationsResult = await recommendationsResponse.json();
    sections.recommendations = recommendationsResult.choices[0].message.content;

    // Generate Billing Validation Summary
    if (documentExtractions?.length > 0) {
      const billingPrompt = `Generate a billing validation summary based on extracted document data.

Extracted Billing Data:
${JSON.stringify(documentExtractions, null, 2)}

Include:
- Cross-check findings between tenant bills and meter readings
- Tariff application verification
- Cases of overbilling or underbilling identified

Be concise and factual.`;

      const billingResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: billingPrompt }
          ],
        }),
      });

      if (!billingResponse.ok) {
        throw new Error(`AI Gateway error: ${billingResponse.status}`);
      }

      const billingResult = await billingResponse.json();
      sections.billingValidation = billingResult.choices[0].message.content;
    }

    console.log('✓ Generated all report sections');

    return new Response(
      JSON.stringify({
        success: true,
        sections
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in generate-audit-report:', error);
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

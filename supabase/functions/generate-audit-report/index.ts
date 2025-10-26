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
      meterBreakdown,
      reconciliationData,
      documentExtractions,
      anomalies 
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are an expert electrical metering auditor specializing in South African municipal billing and sub-metering reconciliation. You write detailed, evidence-based audit reports following professional standards. Your writing is formal, technical, quantitative, and action-oriented. Always reference specific meters, consumption values in kWh, and financial impacts in ZAR when relevant.`;

    const sections: any = {};

    // Generate Executive Summary
    const executiveSummaryPrompt = `Generate a professional executive summary for a metering audit report for ${siteName}.

Audit Period: ${auditPeriodStart} to ${auditPeriodEnd}

Reconciliation Data:
- Council Bulk Supply: ${reconciliationData.councilTotal} kWh
- Solar Generation: ${reconciliationData.solarTotal} kWh
- Total Supply: ${reconciliationData.totalSupply} kWh
- Total Distribution: ${reconciliationData.distributionTotal} kWh
- Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
- Recovery Rate: ${reconciliationData.recoveryRate}%
- Anomalies Detected: ${anomalies?.length || 0}

Structure (3-4 paragraphs):
1. Purpose statement: State this is a metering audit report for the site
2. Scope and period: Mention audit period and what was analyzed
3. Key findings: 
   - Highlight total variance in kWh and percentage
   - State recovery rate percentage
   - Note number of anomalies by severity if applicable
   - Mention financial impact estimate if variance is significant (estimate ZAR loss based on ~R2.50/kWh average tariff)
4. Recommendations preview: Brief mention of infrastructure upgrades, billing improvements, or remedial actions needed

Writing style: Professional, evidence-based, quantitative. Use specific numbers from the data provided.`;

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

Meter Hierarchy Data:
${JSON.stringify(meterHierarchy, null, 2)}

Meter Breakdown:
${JSON.stringify(meterBreakdown, null, 2)}

Structure (2-3 paragraphs):
1. Bulk Supply: Identify council bulk supply meter(s) by meter number. If solar/generation present, mention it.
2. Distribution Network: Describe the distribution architecture - how power flows from bulk to sub-meters. Mention main distribution boards if evident from hierarchy.
3. Sub-Metering Layout: Categorize meters by function:
   - Retailers/Tenant meters (identify by location/name patterns)
   - Service meters (utilities, pump rooms, HVAC)
   - Check meters (note status - active/inactive)
   - Specialized meters (signage, car wash, ATMs, parking)
   - Vacant units (if any)

Include specific meter identifiers (numbers) and mention consumption data where relevant.

Writing style: Technical but clear, structured, with specific meter references.`;

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
    const observationsPrompt = `Generate a comprehensive observations and anomalies section for the metering audit.

Anomalies Detected:
${JSON.stringify(anomalies, null, 2)}

Reconciliation Data:
${JSON.stringify(reconciliationData, null, 2)}

Meter Breakdown:
${JSON.stringify(meterBreakdown, null, 2)}

Structure as numbered subsections (3.1, 3.2, 3.3, etc.):

3.1 Critical Meter Reading Deficiencies
- Identify meters with no readings or insufficient readings
- Specify meter numbers and reading counts
- Discuss implications for reconciliation accuracy

3.2 Excessive Variance Between Supply and Distribution
- Analyze the ${reconciliationData.variancePercentage}% variance
- Compare to acceptable threshold (~5-7%)
- Discuss magnitude of discrepancy (${reconciliationData.variance} kWh)

3.3 Sub-Optimal Energy Recovery Rate
- Analyze recovery rate of ${reconciliationData.recoveryRate}%
- Compare to acceptable threshold (90-95%)
- Discuss lost revenue implications

3.4 Missing or Inaccessible Meters
- Identify any meters that appear in hierarchy but have no data
- Discuss potential causes (bypassed, tampered, faulty)

3.5 Billing Discrepancies (Inferred)
- Based on variance and anomalies, infer potential billing issues
- Mention overbilling or underbilling scenarios

For each subsection:
- State the issue clearly with data
- List potential causes (bulleted: meter faults, tampering, bypassing, calibration drift, CT ratio errors)
- Analyze impact (financial, operational, compliance)
- Connect to other findings if relevant

Writing style: Technical, evidence-based, South African municipal context. Reference specific meters and consumption values.`;

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
    const recommendationsPrompt = `Generate detailed, actionable recommendations for the metering audit findings.

Issues Found:
${JSON.stringify(anomalies, null, 2)}

Reconciliation Data:
${JSON.stringify(reconciliationData, null, 2)}

Structure as 4 main subsections (4.1, 4.2, 4.3, 4.4) with detailed recommendations:

4.1 Remedial Actions for Immediate Discrepancies
Focus: Fix current issues causing variance and low recovery rate
- Address meters with no/insufficient readings
- Investigate and rectify negative consumption meters
- Resolve variance between supply and distribution
Each recommendation should include: Action → Objective → Process (numbered steps) → Benefits → Priority (High/Medium/Low)

4.2 Metering Infrastructure Upgrades and Enhancements
Focus: Long-term infrastructure improvements
- Smart meter installations
- CT ratio verifications
- Meter calibration programs
- Communication system upgrades
Format: Action → Objective → Process → Benefits → Priority → Timeline estimate

4.3 Billing Workflow and Data Management Improvements
Focus: Process and system improvements
- Automated meter reading systems
- Data validation protocols
- Billing reconciliation procedures
- Energy management dashboards
Format: Action → Objective → Process → Benefits → Priority

4.4 Preventative Measures for Future Audits
Focus: Ongoing monitoring and compliance
- Regular audit schedules
- Real-time monitoring systems
- Tamper detection protocols
- Staff training programs
Format: Action → Objective → Process → Benefits → Priority → Frequency

Writing style: Action-oriented, specific, prioritized. Each recommendation should be numbered (e.g., 4.1.1, 4.1.2) and include concrete implementation steps. Reference South African municipal billing context where relevant.`;

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
      const billingPrompt = `Generate a comprehensive billing validation summary based on extracted document data.

Extracted Billing Data:
${JSON.stringify(documentExtractions, null, 2)}

Meter Data for Cross-Reference:
${JSON.stringify(meterBreakdown, null, 2)}

Structure:

Overview Paragraph:
State purpose of billing validation - cross-checking tenant bills against meter readings to verify accuracy.

Subsections (numbered):
1. Consumption Calculation Verification
   - Compare billed consumption vs. actual meter readings
   - Identify discrepancies by tenant/unit
   
2. Tariff Application Verification
   - Verify correct tariff rates applied
   - Check for TOU (Time of Use) application if applicable
   - Verify demand charges, fixed charges

3. Discrepancies/Potential Overbilling-Underbilling
   - List specific cases where bills don't match readings
   - Calculate variance amounts in kWh and ZAR
   
4. Total Amount Verification
   - Cross-check calculated totals vs. billed totals
   - Identify mathematical errors

5. Generator kWh Charge Analysis (if solar present)
   - Verify solar credit calculations
   - Check net metering accuracy

6. Tenant-Specific Rate Structures
   - Verify each tenant has correct tariff assignment
   - Check for bulk rate vs. municipal rate inconsistencies

Identified Cases of Overbilling or Underbilling:
List specific findings as bullet points with meter/tenant identification

Recommendations:
Number 3-5 specific recommendations for billing process improvements

Writing style: Factual, quantitative, evidence-based. Include specific ZAR amounts and kWh values.`;

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

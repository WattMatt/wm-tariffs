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
      anomalies,
      selectedCsvColumns 
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are an expert electrical metering auditor specializing in South African municipal billing and sub-metering reconciliation. You write detailed, evidence-based audit reports following professional standards. Your writing is formal, technical, quantitative, and action-oriented. Always reference specific meters, consumption values in kWh, and financial impacts in ZAR when relevant.`;

    const sections: any = {};

    // Prepare CSV columns summary for AI context with actual data
    let csvColumnsSummary = '';
    if (selectedCsvColumns && selectedCsvColumns.length > 0) {
      csvColumnsSummary = `\n\n=== CRITICAL: CSV COLUMNS DATA ANALYSIS ===\nThe following CSV columns have been selected and MUST be analyzed in detail:\n${selectedCsvColumns.map((col: any) => 
        `- ${col.columnName} (aggregation: ${col.aggregation}, multiplier: ${col.multiplier})`
      ).join('\n')}`;
      
      // Add actual values for each meter
      csvColumnsSummary += '\n\nMeter-by-Meter CSV Data:\n';
      meterHierarchy.forEach((meter: any) => {
        csvColumnsSummary += `\n${meter.meterNumber} (${meter.name}):\n`;
        
        // Add totals
        if (meter.columnTotals && Object.keys(meter.columnTotals).length > 0) {
          csvColumnsSummary += '  Totals:\n';
          Object.entries(meter.columnTotals).forEach(([key, value]) => {
            csvColumnsSummary += `    - ${key}: ${value}\n`;
          });
        }
        
        // Add max values
        if (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0) {
          csvColumnsSummary += '  Maximum Values:\n';
          Object.entries(meter.columnMaxValues).forEach(([key, value]) => {
            csvColumnsSummary += `    - ${key}: ${value}\n`;
          });
        }
      });
    }

    // Generate Executive Summary
    const executiveSummaryPrompt = `You are a professional technical editor and audit writer. Generate a formal, concise, visually structured executive summary for an audit-ready report for ${siteName}.

CRITICAL FORMATTING INSTRUCTIONS:
- Use PLAIN TEXT ONLY - no markdown formatting
- Do NOT use ## headers or section titles
- Do NOT use ** for bold text  
- Do NOT include any markdown syntax
- Use simple table formatting with pipe separators (|) for the three required tables
- Start directly with content

Audit Period: ${auditPeriodStart} to ${auditPeriodEnd}

Reconciliation Data:
- Council Bulk Supply: ${reconciliationData.councilTotal} kWh
- Solar Generation: ${reconciliationData.solarTotal} kWh
- Total Supply: ${reconciliationData.totalSupply} kWh
- Total Distribution: ${reconciliationData.distributionTotal} kWh
- Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
- Recovery Rate: ${reconciliationData.recoveryRate}%
- Anomalies Detected: ${anomalies?.length || 0}${csvColumnsSummary}

REQUIRED STRUCTURE:

1. ELEVATOR SUMMARY (one sentence, max 20 words):
   State the audit, site, period, and headline result (recovery rate or variance).

2. EXECUTIVE SUMMARY PARAGRAPH (4-6 sentences, max 120 words, formal tone):
   Include: purpose, scope (dates and meters), methodology in one brief phrase, headline supply, headline consumption, variance and recovery rate, one-line financial impact.
   No technical jargon beyond metering terms (P1, P2, kvarh, kWh).

3. KEY METRICS TABLE:
   Columns: Metric | Value | Unit
   Rows must include: Total supply, Council bulk supply (MB-1.1), Solar generation (SOLAR-DB-1.1), Total sub-meter consumption, Unaccounted variance, Loss percentage, Recovery rate, Audit period
   Use actual meter numbers from the data when available.

4. METER ANOMALIES TABLE:
   Columns: Meter ID | Issue | Reading (kWh) | Priority
   Include rows for meters with negative P2 readings or significant anomalies from the data provided.
   Label all priorities as High.

5. FINANCIAL IMPACT TABLE:
   Columns: Item | Calculation | Amount (ZAR)
   Row 1: Estimated cost of variance | ${reconciliationData.variance} kWh × R2.50/kWh | R${(parseFloat(reconciliationData.variance) * 2.50).toFixed(2)}

6. RECOMMENDATIONS (4 action-oriented bullets, 10-14 words each):
   First bullet MUST address investigating negative P2 readings for specific meters.
   Use active voice, direct commands. No hedging language (avoid "may", "could", "might").

7. CLOSING SENTENCE (one line, max 12 words):
   Direct urgent action.

TONE: Formal, audit-ready, active voice. Use consistent numeric formatting (commas and two decimal places for currency). Preserve all numeric values exactly as provided.

LENGTH LIMITS: Executive Summary paragraph max 120 words; entire response max 300 words excluding data.`;

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

CRITICAL FORMATTING INSTRUCTIONS:
- Use PLAIN TEXT ONLY - no markdown formatting
- Do NOT use ## headers or section titles
- Do NOT use ** for bold text
- Do NOT include any markdown syntax
- Start directly with the content
- Use simple paragraphs separated by line breaks

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

Writing style: Technical but clear, structured, with specific meter references. Plain text only.`;

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

    // Generate Observations and Anomalies with CSV data
    const observationsPrompt = `Generate a comprehensive observations and anomalies section for the metering audit.

CRITICAL FORMATTING INSTRUCTIONS:
- Use PLAIN TEXT ONLY - no markdown formatting
- Do NOT use ## headers or numbered section headers (like 3.1, 3.2)
- Do NOT use ** for bold text
- Do NOT include any markdown syntax
- Do NOT repeat the section title "Observations and Anomalies" at the start
- Start directly with the content
- Use simple paragraphs with clear topic sentences
- Separate topics with line breaks

Anomalies Detected:
${JSON.stringify(anomalies, null, 2)}

Reconciliation Data:
${JSON.stringify(reconciliationData, null, 2)}

Meter Breakdown:
${JSON.stringify(meterBreakdown, null, 2)}
${csvColumnsSummary}

Content to include (as separate paragraphs without numbering):

Critical Meter Reading Deficiencies:
- Identify meters with no readings or insufficient readings
- Specify meter numbers and reading counts
- Discuss implications for reconciliation accuracy

${selectedCsvColumns && selectedCsvColumns.length > 0 ? `CSV Data Analysis - MANDATORY:
THIS SECTION IS CRITICAL AND MUST BE INCLUDED.

You MUST analyze the CSV column data provided above. For each selected column (${selectedCsvColumns.map((c: any) => c.columnName).join(', ')}):

a) Present the data clearly showing:
   - Meter number and name
   - Values for each selected CSV column
   - Units and aggregation method used

b) Analyze patterns and anomalies:
   - Compare P1 (kWh) and P2 (kWh) values across meters if present
   - Identify meters with unusually high or low kVA maximum demand
   - Note any missing data or zero values that seem unusual
   - Compare reactive power (kvarh) to active power (kWh) ratios

c) Highlight specific concerns:
   - Any meter where CSV data is missing
   - Unusual power factor implications
   - Demand charges that may be incorrectly billed

` : ''}

Variance Between Supply and Distribution:
- Analyze the ${reconciliationData.variancePercentage}% variance
- Compare to acceptable threshold (~5-7%)
- Discuss magnitude of discrepancy (${reconciliationData.variance} kWh)

Energy Recovery Rate:
- Analyze recovery rate of ${reconciliationData.recoveryRate}%
- Compare to acceptable threshold (90-95%)
- Discuss lost revenue implications

Missing or Inaccessible Meters:
- Identify any meters that appear in hierarchy but have no data
- Discuss potential causes (bypassed, tampered, faulty)

Billing Discrepancies:
- Based on variance and anomalies, infer potential billing issues
- Mention overbilling or underbilling scenarios

For each topic:
- State the issue clearly with data
- List potential causes
- Analyze impact (financial, operational, compliance)
- Connect to other findings if relevant

Writing style: Technical, evidence-based, South African municipal context. Reference specific meters and consumption values. Plain text only.`;

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

CRITICAL FORMATTING INSTRUCTIONS:
- Use PLAIN TEXT ONLY - no markdown formatting
- Do NOT use ## headers or numbered section headers (like 4.1, 4.2)
- Do NOT use ** for bold text
- Do NOT include any markdown syntax
- Start directly with the content
- Use clear topic sentences for each recommendation category
- Separate categories with line breaks

Issues Found:
${JSON.stringify(anomalies, null, 2)}

Reconciliation Data:
${JSON.stringify(reconciliationData, null, 2)}

Content to include (as separate paragraphs with clear topic sentences):

Remedial Actions for Immediate Discrepancies:
Focus: Fix current issues causing variance and low recovery rate
- Address meters with no/insufficient readings
- Investigate and rectify negative consumption meters
- Resolve variance between supply and distribution
Each recommendation should include: Action, Objective, Process steps, Benefits, Priority

Metering Infrastructure Upgrades and Enhancements:
Focus: Long-term infrastructure improvements
- Smart meter installations
- CT ratio verifications
- Meter calibration programs
- Communication system upgrades
Include: Action, Objective, Process, Benefits, Priority, Timeline estimate

Billing Workflow and Data Management Improvements:
Focus: Process and system improvements
- Automated meter reading systems
- Data validation protocols
- Billing reconciliation procedures
- Energy management dashboards
Include: Action, Objective, Process, Benefits, Priority

Preventative Measures for Future Audits:
Focus: Ongoing monitoring and compliance
- Regular audit schedules
- Real-time monitoring systems
- Tamper detection protocols
- Staff training programs
Include: Action, Objective, Process, Benefits, Priority, Frequency

Writing style: Action-oriented, specific, prioritized. Include concrete implementation steps. Reference South African municipal billing context where relevant. Plain text only.`;

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

CRITICAL FORMATTING INSTRUCTIONS:
- Use PLAIN TEXT ONLY - no markdown formatting
- Do NOT use ## headers or numbered section headers
- Do NOT use ** for bold text
- Do NOT include any markdown syntax
- Start directly with the content
- Use clear topic sentences
- Separate topics with line breaks

Extracted Billing Data:
${JSON.stringify(documentExtractions, null, 2)}

Meter Data for Cross-Reference:
${JSON.stringify(meterBreakdown, null, 2)}

Content to include (as paragraphs with clear topic sentences):

Overview:
State purpose of billing validation - cross-checking tenant bills against meter readings to verify accuracy.

Consumption Calculation Verification:
- Compare billed consumption vs. actual meter readings
- Identify discrepancies by tenant/unit
   
Tariff Application Verification:
- Verify correct tariff rates applied
- Check for TOU (Time of Use) application if applicable
- Verify demand charges, fixed charges

Discrepancies and Potential Overbilling or Underbilling:
- List specific cases where bills don't match readings
- Calculate variance amounts in kWh and ZAR
   
Total Amount Verification:
- Cross-check calculated totals vs. billed totals
- Identify mathematical errors

Generator kWh Charge Analysis (if solar present):
- Verify solar credit calculations
- Check net metering accuracy

Tenant-Specific Rate Structures:
- Verify each tenant has correct tariff assignment
- Check for bulk rate vs. municipal rate inconsistencies

Identified Cases:
List specific findings with meter/tenant identification

Recommendations:
Provide 3-5 specific recommendations for billing process improvements

Writing style: Factual, quantitative, evidence-based. Include specific ZAR amounts and kWh values. Plain text only.`;

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

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
    const executiveSummaryPrompt = `Generate a visual executive-style report section following these principles:
- Purpose: Enable rapid decision-making
- Language: Plain, active, directive; bullets and one-line sentences only
- Visuals: Tables with status indicators (✓ ⚠ ✗)
- Format: Clear headings, consistent numbers, minimal jargon

DATA FOR ${siteName}:
Period: ${auditPeriodStart} to ${auditPeriodEnd}
- Total Supply: ${reconciliationData.totalSupply} kWh
- Council Bulk: ${reconciliationData.councilTotal} kWh  
- Solar: ${reconciliationData.solarTotal} kWh
- Consumption: ${reconciliationData.distributionTotal} kWh
- Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
- Recovery: ${reconciliationData.recoveryRate}%
- Financial Impact: R${(parseFloat(reconciliationData.variance) * 2.50).toFixed(2)}

OUTPUT REQUIRED:

One-line headline: [Site name], [period], [critical finding in 10 words or less]

EXECUTIVE BRIEFING
• [One line: audit scope]
• [One line: key finding with number]
• [One line: variance impact in kWh and %]
• [One line: recovery rate with comparison to target]
• [One line: financial exposure in ZAR]

PERFORMANCE SNAPSHOT
| Metric | Value | Status |
|--------|-------|--------|
| Total supply | ${reconciliationData.totalSupply} kWh | ✓ |
| Council bulk supply | ${reconciliationData.councilTotal} kWh | ${parseFloat(reconciliationData.councilTotal) > 0 ? '✓' : '⚠'} |
| Solar generation | ${reconciliationData.solarTotal} kWh | ✓ |
| Sub-meter consumption | ${reconciliationData.distributionTotal} kWh | ✓ |
| Unaccounted variance | ${reconciliationData.variance} kWh | ${Math.abs(parseFloat(reconciliationData.variancePercentage)) < 5 ? '✓' : '⚠'} |
| Recovery rate | ${reconciliationData.recoveryRate}% | ${parseFloat(reconciliationData.recoveryRate) >= 98 ? '✓' : '⚠'} |

CRITICAL FINDINGS
[List exactly 3 findings, one line each]

| Finding | Impact | Priority |
|---------|--------|----------|
| [Finding 1 from data] | [Impact in kWh or ZAR] | HIGH |
| [Finding 2 from data] | [Impact in kWh or ZAR] | HIGH |
| [Finding 3 from data] | [Impact] | MEDIUM |

FINANCIAL IMPACT
| Item | Calculation | Amount |
|------|-------------|--------|
| Variance cost estimate | ${reconciliationData.variance} kWh × R2.50 | R${(parseFloat(reconciliationData.variance) * 2.50).toFixed(2)} |

IMMEDIATE ACTIONS REQUIRED
1. [One-line directive action addressing finding 1]
2. [One-line directive action addressing finding 2]

Use this EXACT structure. Keep all text to one line per point.`;

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
    const hierarchyPrompt = `Generate a visual executive-style metering hierarchy section for ${siteName}.

PRINCIPLES:
- Language: Plain, active, directive; one-line sentences and bullets
- Format: Clear structure with tables where appropriate
- Minimal jargon

Meter Hierarchy Data:
${JSON.stringify(meterHierarchy, null, 2)}

Meter Breakdown:
${JSON.stringify(meterBreakdown, null, 2)}

OUTPUT REQUIRED:

One-line opening: [State total number of meters and basic hierarchy structure]

SUPPLY METERS
• [One line: Council bulk meter number and capacity/consumption]
• [One line: Solar/generation meter if present]

DISTRIBUTION STRUCTURE
• [One line: How power flows from bulk to distribution]
• [One line: Main distribution boards or key connection points]

SUB-METERING BREAKDOWN
| Category | Count | Key Meters |
|----------|-------|------------|
| Tenant/Retail meters | [#] | [List 2-3 meter numbers] |
| Service meters | [#] | [HVAC, utilities] |
| Check meters | [#] | [Active/inactive status] |
| Specialized | [#] | [Signage, ATM, etc.] |

Keep each point to one line. Include meter numbers for traceability.`;

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
    const observationsPrompt = `Generate a visual executive-style observations section.

PRINCIPLES:
- Language: Plain, active; one-line sentences and bullets
- Format: Tables with status indicators (✓ ⚠ ✗)
- Minimal jargon

Anomalies Detected:
${JSON.stringify(anomalies, null, 2)}

Reconciliation Data:
${JSON.stringify(reconciliationData, null, 2)}

Meter Breakdown:
${JSON.stringify(meterBreakdown, null, 2)}
${csvColumnsSummary}

OUTPUT REQUIRED:

One-line opening: [State number of issues found and severity]

METER READING DEFICIENCIES
| Meter | Readings | Status | Impact |
|-------|----------|--------|--------|
| [Meter #] | [Count] | ⚠ | [One-line impact] |
| [Meter #] | [Count] | ✗ | [One-line impact] |

${selectedCsvColumns && selectedCsvColumns.length > 0 ? `
CSV DATA ANALYSIS - MANDATORY
[One line: Overview of CSV columns analyzed]

| Meter | ${selectedCsvColumns.map((c: any) => c.columnName).slice(0, 3).join(' | ')} | Status |
|-------|${selectedCsvColumns.slice(0, 3).map(() => '---').join('|')}|--------|
| [Meter #] | [Value] | [Value] | [Value] | ⚠ |

Key findings from CSV data:
• [One line: P1/P2 comparison finding]
• [One line: kVA demand finding]
• [One line: Power factor or billing concern]
` : ''}

VARIANCE ANALYSIS
• Current variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
• Acceptable threshold: 5-7%
• Status: ${Math.abs(parseFloat(reconciliationData.variancePercentage)) < 5 ? '✓ Within limits' : '⚠ Exceeds threshold'}
• Financial impact: R${(parseFloat(reconciliationData.variance) * 2.50).toFixed(2)}

RECOVERY RATE ANALYSIS
• Current rate: ${reconciliationData.recoveryRate}%
• Target threshold: 90-95%
• Status: ${parseFloat(reconciliationData.recoveryRate) >= 90 ? '✓ Acceptable' : '⚠ Below target'}
• Lost revenue potential: [Calculate based on variance]

MISSING/INACCESSIBLE METERS
[If any meters have no data]
| Meter | Last Reading | Suspected Cause |
|-------|--------------|-----------------|
| [Meter #] | [Date or "None"] | [One-line cause] |

BILLING DISCREPANCIES
• [One line: Overbilling scenario with meter #]
• [One line: Underbilling scenario with meter #]
• [One line: Tariff misapplication with meter #]

Keep all points to one line. Use tables for data. Include meter numbers for traceability.`;

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
    const recommendationsPrompt = `Generate visual executive-style recommendations.

PRINCIPLES:
- Language: Directive, action-oriented; one-line sentences
- Format: Tables with priority indicators
- Each action: what, why, priority

Issues Found:
${JSON.stringify(anomalies, null, 2)}

Reconciliation Data:
${JSON.stringify(reconciliationData, null, 2)}

OUTPUT REQUIRED:

One-line opening: [Number of recommendations across priority levels]

IMMEDIATE ACTIONS (Priority: HIGH)
| Action | Target | Timeline | Impact |
|--------|--------|----------|--------|
| [Action 1: Fix meter readings] | [Specific meters] | [Days/weeks] | [Revenue/accuracy] |
| [Action 2: Investigate variance] | [Area/meters] | [Days/weeks] | [Financial] |

INFRASTRUCTURE UPGRADES (Priority: MEDIUM)
| Upgrade | Scope | Timeline | Benefit |
|---------|-------|----------|---------|
| [Smart meter installation] | [# meters] | [Months] | [One-line benefit] |
| [CT ratio verification] | [# meters] | [Months] | [One-line benefit] |

PROCESS IMPROVEMENTS (Priority: MEDIUM)
• [Action: Implement automated reading system - timeline - benefit]
• [Action: Deploy validation protocols - timeline - benefit]
• [Action: Create reconciliation dashboard - timeline - benefit]

PREVENTATIVE MEASURES (Ongoing)
| Measure | Frequency | Owner | Purpose |
|---------|-----------|-------|---------|
| [Regular audits] | [Monthly/quarterly] | [Role] | [One-line purpose] |
| [Real-time monitoring] | [Continuous] | [Role] | [One-line purpose] |

Keep each action to one line. Include timelines and responsible parties where known.`;

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
      const billingPrompt = `Generate visual executive-style billing validation section.

PRINCIPLES:
- Language: Factual, quantitative; one-line sentences
- Format: Tables for discrepancies
- Each finding: what, amount, priority

Extracted Billing Data:
${JSON.stringify(documentExtractions, null, 2)}

Meter Data for Cross-Reference:
${JSON.stringify(meterBreakdown, null, 2)}

OUTPUT REQUIRED:

One-line opening: [Purpose and number of bills validated]

CONSUMPTION VERIFICATION
| Tenant/Unit | Billed (kWh) | Actual (kWh) | Variance | Status |
|-------------|--------------|--------------|----------|--------|
| [Unit #] | [Value] | [Value] | [Diff] | ⚠ |
| [Unit #] | [Value] | [Value] | [Diff] | ✓ |

TARIFF APPLICATION CHECK
| Tenant | Applied Rate | Correct Rate | Status | Impact |
|--------|--------------|--------------|--------|--------|
| [Tenant] | [Rate] | [Rate] | ⚠ | R[Amount] |

BILLING DISCREPANCIES IDENTIFIED
| Issue | Tenant/Meter | Variance (kWh) | Variance (ZAR) | Priority |
|-------|--------------|----------------|----------------|----------|
| [Overbilling case] | [ID] | [Value] | R[Value] | HIGH |
| [Underbilling case] | [ID] | [Value] | R[Value] | MEDIUM |

SOLAR CREDIT VERIFICATION (if applicable)
• Billed solar credit: [kWh] @ R[rate]
• Actual solar generation: [kWh]
• Status: ${reconciliationData.solarTotal && parseFloat(reconciliationData.solarTotal) > 0 ? '[✓ or ⚠]' : 'N/A'}

TOTAL AMOUNT VERIFICATION
| Tenant | Calculated Total | Billed Total | Variance | Status |
|--------|------------------|--------------|----------|--------|
| [Tenant] | R[Value] | R[Value] | R[Diff] | ⚠ |

IMMEDIATE BILLING CORRECTIONS REQUIRED
1. [One-line directive: tenant, issue, amount]
2. [One-line directive: tenant, issue, amount]
3. [One-line directive: tenant, issue, amount]

Keep each point to one line. Include ZAR amounts for financial traceability.`;

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

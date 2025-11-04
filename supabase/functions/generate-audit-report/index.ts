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

    const systemPrompt = `You are an expert electrical metering auditor specializing in South African municipal billing and sub-metering reconciliation. Generate reports following this exact format with precise tables, status indicators (✓, ⚠, ✗), and one-line statements. Always reference specific meters, consumption values in kWh, and financial impacts in ZAR.`;

    const sections: any = {};

    // Prepare CSV columns summary
    let csvColumnsSummary = '';
    if (selectedCsvColumns && selectedCsvColumns.length > 0) {
      csvColumnsSummary = `\n\nCSV Columns Selected for Analysis:\n${selectedCsvColumns.map((col: any) => 
        `- ${col.columnName} (${col.aggregation}, ×${col.multiplier})`
      ).join('\n')}`;
      
      csvColumnsSummary += '\n\nMeter CSV Data:\n';
      meterHierarchy.forEach((meter: any) => {
        csvColumnsSummary += `\n${meter.meterNumber}:\n`;
        if (meter.columnTotals) {
          Object.entries(meter.columnTotals).forEach(([key, value]) => {
            csvColumnsSummary += `  ${key}: ${value}\n`;
          });
        }
      });
    }

    // 1. EXECUTIVE SUMMARY
    const executiveSummaryPrompt = `Generate Section 1: Executive Summary for ${siteName}.

STRUCTURE REQUIRED (match this exactly):

Single-sentence headline:
[Site Name] [Period] Audit: Critical [X.XX]% Energy Variance and ZAR [Amount] Financial Loss Identified.

---

# Energy Flow Summary

| **GRID SUPPLY (Bulk Check)** | **COMBINED SUPPLY (VIRTUAL - TOTAL INJECTION)** | **SOLAR ENERGY (PV Tie In)** |
|:------------------------------|:------------------------------------------------|:----------------------------|
| **Total: ${reconciliationData.councilTotal.toFixed(2)} kWh** | **Total: ${reconciliationData.totalSupply.toFixed(2)} kWh** | **Total: ${reconciliationData.solarTotal.toFixed(2)} kWh** |
| Source: Municipal/Council Supply | Components: Grid + Solar | Source: On-site Generation |
| Status: [✓/⚠/✗] | **OVER/UNDER: ${reconciliationData.variance.toFixed(2)} kWh** | Status: [✓/⚠/✗] |
| | **% OF TOTAL: ${reconciliationData.variancePercentage}%** | |
| | Status: [✓/⚠/✗] | |

**Note:** Use ✓ for values within acceptable range (<2% variance), ⚠ for caution range (2-5% variance), ✗ for critical issues (>5% variance).

---

# Key Points

- Scope: Audit covers ${auditPeriodStart} to ${auditPeriodEnd}, including council billing verification, main check meter validation, and tenant sub-metering reconciliation
- Finding: [One sentence on primary issue causing financial losses]
- Metering Variance: ${Math.abs(reconciliationData.variancePercentage)}% variance detected between total supply (${reconciliationData.totalSupply.toFixed(2)} kWh) and distribution (${reconciliationData.distributionTotal.toFixed(2)} kWh)
- Financial Impact: Variance of ${Math.abs(reconciliationData.variance).toFixed(2)} kWh represents ZAR [calculate amount] in unaccounted energy

# Performance Snapshot

| Metric | Status | Detail |
|--------|--------|--------|
| Council Bill Accuracy | [✓/⚠/✗] | Grid supply vs council billing variance: [calculate %] |
| Metering System Health | [✓/⚠/✗] | Combined supply (${reconciliationData.totalSupply.toFixed(2)} kWh) vs sub-metered consumption shows ${reconciliationData.variancePercentage}% discrepancy |
| Tenant Billing Accuracy | [✓/⚠/✗] | Recovery rate of ${reconciliationData.recoveryRate.toFixed(2)}% against total supply |
| Data Integrity | [✓/⚠/✗] | [Assess based on data gaps or missing readings] |

# Top 3 Critical Findings

## Finding 1: Energy Variance in Distribution
Impact: ${Math.abs(reconciliationData.variance).toFixed(2)} kWh unaccounted between supply and distribution, representing ZAR [calculate @ 3.20/kWh] potential revenue loss.
Priority: HIGH

## Finding 2: [Title based on recovery rate or specific meter issues]
Impact: [Specific issue description with ZAR amount]
Priority: HIGH

## Finding 3: [Title based on data quality or operational issues]
Impact: [Specific issue description]
Priority: MEDIUM

# Financial Impact Calculation
Energy Variance (${Math.abs(reconciliationData.variance).toFixed(2)} kWh @ ZAR 3.20) = ZAR [Total] Total Loss

# Immediate Actions Required
- Investigate and address ${Math.abs(reconciliationData.variance).toFixed(2)} kWh discrepancy between combined supply and tenant consumption
- [Action 2 - specific to recovery rate or meter issues]

DATA PROVIDED:
Period: ${auditPeriodStart} to ${auditPeriodEnd}
Total Supply (Combined): ${reconciliationData.totalSupply} kWh
Grid Supply (Bulk): ${reconciliationData.councilTotal} kWh
Solar Generation: ${reconciliationData.solarTotal} kWh
Distribution (Consumption): ${reconciliationData.distributionTotal} kWh
Variance (OVER/UNDER): ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
Recovery Rate: ${reconciliationData.recoveryRate}%

Use ✓ for <2% variance, ⚠ for 2-5%, ✗ for >5%. Calculate all financial impacts at ZAR 3.20/kWh.`;

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

    // 2. METERING HIERARCHY OVERVIEW
    const hierarchyPrompt = `Generate Section 2: Metering Hierarchy Overview for ${siteName}.

STRUCTURE REQUIRED (match this exactly):

# Supply and Distribution
[One sentence describing electricity flow sequence]

[Supply Authority Name] → [Council Meter] → [M###: Site Check Meter] → Main DB → [Sub-meters: List] → Tenants

# Sub-metering Breakdown

| Category | Key Meter Numbers | Area / Purpose Covered |
|----------|-------------------|------------------------|
| [Tenant/Unit Name] | [Meter IDs] | [Description of area] |
| [Tenant/Unit Name] | [Meter IDs] | [Description of area] |
| [Other category] | [Meter IDs] | [Description of area] |

DATA PROVIDED:
${JSON.stringify(meterHierarchy, null, 2)}
${JSON.stringify(meterBreakdown, null, 2)}

Create the flow diagram showing the actual meter numbers. Group sub-meters by tenant/purpose in the table.`;

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

    // 3. METERING SYSTEM OBSERVATIONS
    const observationsPrompt = `Generate Section 3: Metering System Observations for ${siteName}.

STRUCTURE REQUIRED (match this exactly):

# Meter Reading Deficiencies

| Meter Number | Deficiency Noted | Impact |
|--------------|------------------|--------|
| [Meter ID] | [One sentence describing deficiency] | [One sentence on impact] |

# Variance Analysis (Check Meter vs Sum of Sub-Meters)

The variance between the main check meter and the sum of sub-meters is [X.XX]%. This [exceeds/is within] the acceptable threshold of 2%.

# Analysis Table

| Description | kWh |
|-------------|-----|
| Total Consumption (Check Meter [ID]) | [Value] |
| Total Sub-metered (Sum of [IDs]) | [Value] |
| **Variance (Unaccounted Energy)** | **[Value]** |

DATA PROVIDED:
Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
Total Supply: ${reconciliationData.totalSupply} kWh
Distribution Total: ${reconciliationData.distributionTotal} kWh
Recovery Rate: ${reconciliationData.recoveryRate}%

Anomalies: ${JSON.stringify(anomalies, null, 2)}
Meter Breakdown: ${JSON.stringify(meterBreakdown, null, 2)}
${csvColumnsSummary}

Identify meters with missing readings. Calculate actual variance percentage. Bold the variance row in the table.`;

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

    // 5. RECOMMENDATIONS
    const recommendationsPrompt = `Generate Section 5: Recommendations for ${siteName}.

STRUCTURE REQUIRED (match this exactly):

# Immediate Actions (HIGH Priority)

| Action | Owner | Timeline |
|--------|-------|----------|
| [Specific action 1] | [Facility Manager/Energy Team/etc.] | [24 Hours/7 Days/etc.] |
| [Specific action 2] | [Owner] | [Timeline] |
| [Specific action 3] | [Owner] | [Timeline] |

# Process Improvements (MEDIUM Priority)

[Action statement as heading]

Implementation Steps:
1. [Concrete step 1]
2. [Concrete step 2]
3. [Concrete step 3]

DATA PROVIDED:
Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
Recovery Rate: ${reconciliationData.recoveryRate}%
Anomalies: ${JSON.stringify(anomalies, null, 2)}

Generate 3-5 immediate actions with specific owners (e.g., "Facility Manager", "Energy Team", "Billing Department") and realistic timelines. For process improvements, provide a clear action statement and 3-5 numbered implementation steps.`;

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

    // 4. BILLING AND INVOICE VALIDATION
    if (documentExtractions?.length > 0) {
      const billingPrompt = `Generate Section 4: Billing and Invoice Validation for ${siteName}.

STRUCTURE REQUIRED (match this exactly):

# A. Council Bill Validation

This check confirms the [Utility Name] utility bill matches our main site meter.

# Consumption Verification

| Description | Council Billed (kWh) | Site Check Meter (kWh) | Difference | Status |
|-------------|---------------------|----------------------|------------|--------|
| [Period description] | [Value] | [Value] | [Diff] | [✓/⚠/✗] |

# B. Tenant Invoice Validation

This check confirms our invoices to tenants are accurate.

# Invoice vs Meter Data Check

| Tenant/Meter | Metered (kWh) | Invoiced (kWh) | Difference | Status |
|--------------|--------------|----------------|------------|--------|
| [Tenant/Meter ID] | [Value] | [Value] | [Diff] | [✓/⚠/✗] |

# Tenant Tariff Check

| Tenant/Meter | Tariff Applied | Correct Tariff | Financial Impact (ZAR) | Status |
|--------------|---------------|----------------|----------------------|--------|
| [Tenant/Meter ID] | [Rate] | [Rate] | [Amount] | [✓/⚠/✗] |

DATA PROVIDED:
Document Extractions: ${JSON.stringify(documentExtractions, null, 2)}
Meter Data: ${JSON.stringify(meterBreakdown, null, 2)}
Council Total: ${reconciliationData.councilTotal} kWh
Total Supply: ${reconciliationData.totalSupply} kWh

Cross-reference council bill with site check meter. Compare tenant invoices with actual metered data. Identify tariff misapplications with financial impact. Use ✓ for matches, ⚠ for <5% variance, ✗ for >5% variance.`;

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

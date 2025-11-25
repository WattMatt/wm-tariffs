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
      siteDetails,
      auditPeriodStart,
      auditPeriodEnd,
      meterHierarchy,
      meterBreakdown,
      reconciliationData,
      documentExtractions,
      anomalies,
      selectedCsvColumns,
      schematics,
      tariffStructures,
      loadProfiles,
      costAnalysis
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are an expert electrical metering auditor specializing in South African municipal billing and sub-metering reconciliation. Generate comprehensive, professional audit reports with precise data, detailed tables, and actionable insights. Always reference specific meters, consumption values in kWh, costs in ZAR, and use clear status indicators (✓ for acceptable, ⚠ for caution, ✗ for critical issues). Ensure all tables are properly formatted in markdown.`;

    const sections: any = {};

    // Helper function to prepare CSV column summary
    const getCsvColumnsSummary = () => {
      if (!selectedCsvColumns || selectedCsvColumns.length === 0) return '';
      
      let summary = `\n\nCSV Columns Selected for Analysis:\n`;
      selectedCsvColumns.forEach((col: any) => {
        summary += `- ${col.columnName} (${col.aggregation}, ×${col.multiplier})\n`;
      });
      
      summary += '\n\nMeter CSV Data:\n';
      meterHierarchy.forEach((meter: any) => {
        if (meter.columnTotals) {
          summary += `\n${meter.meterNumber}:\n`;
          Object.entries(meter.columnTotals).forEach(([key, value]) => {
            summary += `  ${key}: ${value}\n`;
          });
        }
      });
      
      return summary;
    };

    const csvColumnsSummary = getCsvColumnsSummary();

    // 1. EXECUTIVE SUMMARY
    console.log('Generating Executive Summary...');
    const execSummaryPrompt = `Generate Section 1: Executive Summary for ${siteName}.

Period: ${auditPeriodStart} to ${auditPeriodEnd}

Key Metrics:
- Grid Supply: ${reconciliationData.councilTotal} kWh
- Solar Generation: ${reconciliationData.solarTotal} kWh  
- Total Supply: ${reconciliationData.totalSupply} kWh
- Distribution Total: ${reconciliationData.distributionTotal} kWh
- Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
- Recovery Rate: ${reconciliationData.recoveryRate}%
- Anomalies: ${anomalies.length}
${costAnalysis ? `- Total Cost: ZAR ${costAnalysis.totalCost}` : ''}

Create a professional executive summary with:
1. One-sentence headline capturing the key finding
2. Energy flow summary in a table showing Grid/Solar/Combined supply with meter details
3. Key points (scope, primary finding, financial impact, recovery rate)
4. Performance snapshot table (Council Bill Accuracy, System Health, Data Integrity, Cost Tracking)
5. Top 3 critical findings with impact and priority
6. Immediate actions required

Use status indicators: ✓ (<2% variance), ⚠ (2-5%), ✗ (>5%)
Calculate financial impact at ZAR 3.20/kWh`;

    const execResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: execSummaryPrompt }
        ],
      }),
    });

    if (!execResponse.ok) throw new Error(`AI Gateway error: ${execResponse.status}`);
    const execResult = await execResponse.json();
    sections.executiveSummary = execResult.choices[0].message.content;

    // 2. SITE INFRASTRUCTURE  
    console.log('Generating Site Infrastructure section...');
    const infraPrompt = `Generate Section 2: Site Infrastructure for ${siteName}.

Site Details:
${JSON.stringify(siteDetails, null, 2)}

Meters Overview:
- Total: ${meterHierarchy.length}
- Bulk/Grid: ${meterHierarchy.filter((m: any) => m.type === 'council_bulk').length}
- Solar: ${meterHierarchy.filter((m: any) => m.type === 'solar').length}
- Distribution: ${meterHierarchy.filter((m: any) => m.type === 'distribution').length}
- Revenue-Critical: ${meterHierarchy.filter((m: any) => m.isRevenueCritical).length}

Schematics:
${schematics && schematics.length > 0 ? JSON.stringify(schematics, null, 2) : 'None uploaded'}

Meter Data:
${JSON.stringify(meterHierarchy.slice(0, 20), null, 2)}

Create section with:
1. Site details (address, connection point, supply authority)
2. Meter inventory summary with counts by type
3. Schematic documentation list
4. Meter hierarchy showing parent-child relationships
5. Comprehensive meter inventory table with all details (Meter #, Type, Location, Tariff, CT Ratio, Phase, Rating, Confirmation Status, Revenue-Critical flag)`;

    const infraResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: infraPrompt }
        ],
      }),
    });

    if (!infraResponse.ok) throw new Error(`AI Gateway error: ${infraResponse.status}`);
    const infraResult = await infraResponse.json();
    sections.siteInfrastructure = infraResult.choices[0].message.content;

    // 3. TARIFF CONFIGURATION
    console.log('Generating Tariff Configuration section...');
    const tariffPrompt = `Generate Section 3: Tariff Configuration for ${siteName}.

Supply Authority: ${siteDetails?.supplyAuthorityName || 'Not specified'}
Region: ${siteDetails?.supplyAuthorityRegion || 'Not specified'}
NERSA Increase: ${siteDetails?.nersaIncrease || 'Not specified'}%

Tariff Structures:
${tariffStructures && tariffStructures.length > 0 ? JSON.stringify(tariffStructures, null, 2) : 'No tariff data available'}

Meter Tariff Assignments:
${JSON.stringify(meterHierarchy.filter((m: any) => m.assignedTariffName).map((m: any) => ({
  meter: m.meterNumber,
  name: m.name,
  tariff: m.assignedTariffName
})), null, 2)}

Create section with:
1. Supply authority details
2. Assigned tariffs (site-level and meter-level table)
3. For each unique tariff, provide complete details:
   - Tariff name, type, effective dates, voltage level
   - Block structure table (if block tariff)
   - Fixed charges table (basic, demand, other charges)
   - TOU periods table (if TOU tariff) with seasons, day types, periods, hours, rates`;

    const tariffResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: tariffPrompt }
        ],
      }),
    });

    if (!tariffResponse.ok) throw new Error(`AI Gateway error: ${tariffResponse.status}`);
    const tariffResult = await tariffResponse.json();
    sections.tariffConfiguration = tariffResult.choices[0].message.content;

    // 4. METERING DATA ANALYSIS
    console.log('Generating Metering Data Analysis section...');
    const dataAnalysisPrompt = `Generate Section 4: Metering Data Analysis for ${siteName}.

Period: ${auditPeriodStart} to ${auditPeriodEnd}

Meter Breakdown Data:
${JSON.stringify(meterBreakdown, null, 2)}

Load Profiles:
${loadProfiles ? JSON.stringify(loadProfiles, null, 2) : 'No load profile data available'}

${csvColumnsSummary}

Create section with:
1. Data coverage (date range per meter, completeness, reading frequency)
2. Consumption analysis per meter (total kWh, average daily, peak demand if available)
3. Hierarchical analysis (parent totals vs sum of children, energy balance at each level)
4. Load profile characteristics if available (peak hours, usage patterns, demand profiles)
5. CSV column analysis if selected (totals, max values, operations applied)`;

    const dataAnalysisResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dataAnalysisPrompt }
        ],
      }),
    });

    if (!dataAnalysisResponse.ok) throw new Error(`AI Gateway error: ${dataAnalysisResponse.status}`);
    const dataAnalysisResult = await dataAnalysisResponse.json();
    sections.meteringDataAnalysis = dataAnalysisResult.choices[0].message.content;

    // 5. DOCUMENT & INVOICE VALIDATION (if documents available)
    if (documentExtractions && documentExtractions.length > 0) {
      console.log('Generating Document Validation section...');
      const docValidationPrompt = `Generate Section 5: Document & Invoice Validation for ${siteName}.

Documents:
${JSON.stringify(documentExtractions, null, 2)}

Reconciliation Data:
Council Total: ${reconciliationData.councilTotal} kWh
Total Supply: ${reconciliationData.totalSupply} kWh

Meter Breakdown:
${JSON.stringify(meterBreakdown.slice(0, 10), null, 2)}

Create section with:
1. Council Bill Validation
   - Consumption verification table (Council Billed vs Site Meter, Difference, Status)
2. Tenant Invoice Validation  
   - Invoice vs meter data check table (Tenant/Meter, Metered, Invoiced, Difference, Status)
   - Tariff application check table (Tenant/Meter, Tariff Applied, Correct Tariff, Financial Impact, Status)
3. Cost Component Analysis
   - Energy charges breakdown
   - Demand charges (kVA-based) if applicable
   - Fixed charges comparison
   - Total variance analysis with ZAR amounts
4. Variance summary with root causes

Use ✓ for matches, ⚠ for <5% variance, ✗ for >5% variance`;

      const docResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: docValidationPrompt }
          ],
        }),
      });

      if (!docResponse.ok) throw new Error(`AI Gateway error: ${docResponse.status}`);
      const docResult = await docResponse.json();
      sections.documentValidation = docResult.choices[0].message.content;
    }

    // 6. RECONCILIATION RESULTS
    console.log('Generating Reconciliation Results section...');
    const reconPrompt = `Generate Section 6: Reconciliation Results for ${siteName}.

Period: ${auditPeriodStart} to ${auditPeriodEnd}

Reconciliation Summary:
- Grid Supply: ${reconciliationData.councilTotal} kWh
- Solar: ${reconciliationData.solarTotal} kWh
- Total Supply: ${reconciliationData.totalSupply} kWh
- Distribution: ${reconciliationData.distributionTotal} kWh
- Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
- Recovery Rate: ${reconciliationData.recoveryRate}%

Meter Results:
${JSON.stringify(meterBreakdown, null, 2)}

${csvColumnsSummary}

Create section with:
1. Reconciliation summary (run name, date, period)
2. Energy balance (grid, solar, total supply, distribution, recovery rate, variance)
3. Financial summary if available (grid cost, solar cost, tenant revenue, net position, avg cost/kWh)
4. Meter-level results table (Meter #, Name, Type, Location, Total kWh, +/- kWh, Hierarchical Total, Energy Cost, Demand Charges, Fixed Charges, Total Cost, Cost/kWh, Errors)
5. Custom column analysis (selected columns with operations, totals, max values, factors)`;

    const reconResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: reconPrompt }
        ],
      }),
    });

    if (!reconResponse.ok) throw new Error(`AI Gateway error: ${reconResponse.status}`);
    const reconResult = await reconResponse.json();
    sections.reconciliationResults = reconResult.choices[0].message.content;

    // 7. COST ANALYSIS
    if (costAnalysis) {
      console.log('Generating Cost Analysis section...');
      const costPrompt = `Generate Section 7: Cost Analysis for ${siteName}.

Cost Data:
${JSON.stringify(costAnalysis, null, 2)}

Reconciliation:
- Total Supply: ${reconciliationData.totalSupply} kWh
- Recovery Rate: ${reconciliationData.recoveryRate}%

Create section with:
1. Total cost breakdown (by meter type: bulk/solar/tenant, by component: energy/demand/fixed, by tariff)
2. Cost trends if historical data available (month-over-month, cost per kWh trends, demand charge trends)
3. Efficiency metrics (cost per m² if area available, solar offset value, tenant cost recovery %)
4. Cost optimization opportunities`;

      const costResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: costPrompt }
          ],
        }),
      });

      if (!costResponse.ok) throw new Error(`AI Gateway error: ${costResponse.status}`);
      const costResult = await costResponse.json();
      sections.costAnalysis = costResult.choices[0].message.content;
    }

    // 8. FINDINGS & ANOMALIES
    console.log('Generating Findings section...');
    const findingsPrompt = `Generate Section 8: Findings & Anomalies for ${siteName}.

Anomalies:
${JSON.stringify(anomalies, null, 2)}

Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
Recovery Rate: ${reconciliationData.recoveryRate}%

Meters:
${JSON.stringify(meterHierarchy.map((m: any) => ({
  number: m.meterNumber,
  type: m.type,
  status: m.confirmationStatus,
  readingsCount: m.readingsCount
})), null, 2)}

Create section with:
1. Data Quality Issues (missing readings, gaps, unconfirmed meters, meters without readings)
2. Calculation Issues (cost calculation errors, failed tariff applications, low confidence extractions)
3. Billing Anomalies (significant variances >10%, unexpected charges, period mismatches)
4. Configuration Issues (meters without tariffs, orphaned meters, duplicate numbers)
5. Summary table of all anomalies (#, Severity, Meter, Description)`;

    const findingsResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: findingsPrompt }
        ],
      }),
    });

    if (!findingsResponse.ok) throw new Error(`AI Gateway error: ${findingsResponse.status}`);
    const findingsResult = await findingsResponse.json();
    sections.findingsAnomalies = findingsResult.choices[0].message.content;

    // 9. RECOMMENDATIONS
    console.log('Generating Recommendations section...');
    const recoPrompt = `Generate Section 9: Recommendations for ${siteName}.

Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
Recovery Rate: ${reconciliationData.recoveryRate}%
Anomalies: ${anomalies.length}
Critical/High Issues: ${anomalies.filter((a: any) => a.severity === 'CRITICAL' || a.severity === 'HIGH').length}

Create section with:
1. Immediate Actions (HIGH Priority) - table with Action, Owner, Timeline for 3-5 urgent items
2. Metering Improvements (MEDIUM Priority) - specific recommendations for additional sub-metering, meter upgrades, data collection
3. Cost Optimization - tariff optimization opportunities, load shifting potential based on TOU, solar utilization improvements
4. Documentation - schematic updates, meter verification needs, tariff review schedule

Make all recommendations specific, actionable, and tied to findings with clear priorities and timelines.`;

    const recoResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: recoPrompt }
        ],
      }),
    });

    if (!recoResponse.ok) throw new Error(`AI Gateway error: ${recoResponse.status}`);
    const recoResult = await recoResponse.json();
    sections.recommendations = recoResult.choices[0].message.content;

    console.log('✓ Generated all 9 report sections');

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
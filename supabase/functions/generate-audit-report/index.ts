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
      costAnalysis,
      rateComparisonData
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are an expert electrical metering auditor specializing in South African municipal billing and sub-metering reconciliation. Generate comprehensive, professional audit reports with precise data, detailed tables, and actionable insights. Always reference specific meters, consumption values in kWh, costs in ZAR, and use clear status indicators (✓ for acceptable, ⚠ for caution, ✗ for critical issues). Ensure all tables are properly formatted in markdown.`;

    const sections: any = {};

    // Helper function to call AI with timeout and retry logic
    const callAIWithRetry = async (sectionName: string, prompt: string, maxRetries = 2, timeoutMs = 45000): Promise<string> => {
      let lastError: Error | null = null;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
              ],
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            if (response.status === 429) {
              throw new Error(`Rate limited for ${sectionName}`);
            }
            throw new Error(`AI Gateway error ${response.status} for ${sectionName}`);
          }
          
          const result = await response.json();
          return result.choices[0].message.content;
        } catch (error: any) {
          lastError = error;
          console.error(`Attempt ${attempt + 1} failed for ${sectionName}:`, error.message);
          
          if (attempt < maxRetries && error.name !== 'AbortError') {
            // Exponential backoff: 2s, 4s
            const delay = Math.pow(2, attempt) * 2000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      throw lastError || new Error(`Failed to generate ${sectionName}`);
    };

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

    // Track section generation status
    const sectionStatus: Record<string, 'pending' | 'success' | 'failed'> = {};

    // BATCH 1: Generate independent sections in parallel
    console.log('Starting Batch 1: Executive Summary, Site Infrastructure, Tariff Configuration, Metering Data Analysis...');
    
    const batch1Promises = [
      // 1. EXECUTIVE SUMMARY
      callAIWithRetry('Executive Summary', `Generate Section 1: Executive Summary for ${siteName}.

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
Calculate financial impact at ZAR 3.20/kWh`).then(content => {
        sections.executiveSummary = content;
        sectionStatus['executiveSummary'] = 'success';
        console.log('✓ Executive Summary completed');
      }).catch(err => {
        sectionStatus['executiveSummary'] = 'failed';
        sections.executiveSummary = `# Executive Summary\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Executive Summary failed:', err);
      }),

      // 2. SITE INFRASTRUCTURE
      callAIWithRetry('Site Infrastructure', `Generate Section 2: Site Infrastructure for ${siteName}.

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
5. Comprehensive meter inventory table with all details (Meter #, Type, Location, Tariff, CT Ratio, Phase, Rating, Confirmation Status, Revenue-Critical flag)`).then(content => {
        sections.siteInfrastructure = content;
        sectionStatus['siteInfrastructure'] = 'success';
        console.log('✓ Site Infrastructure completed');
      }).catch(err => {
        sectionStatus['siteInfrastructure'] = 'failed';
        sections.siteInfrastructure = `# Site Infrastructure\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Site Infrastructure failed:', err);
      }),

      // 3. TARIFF CONFIGURATION
      callAIWithRetry('Tariff Configuration', `Generate Section 3: Tariff Configuration for ${siteName}.

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
   - TOU periods table (if TOU tariff) with seasons, day types, periods, hours, rates`).then(content => {
        sections.tariffConfiguration = content;
        sectionStatus['tariffConfiguration'] = 'success';
        console.log('✓ Tariff Configuration completed');
      }).catch(err => {
        sectionStatus['tariffConfiguration'] = 'failed';
        sections.tariffConfiguration = `# Tariff Configuration\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Tariff Configuration failed:', err);
      }),

      // 4. TARIFF COMPARISON
      Promise.resolve().then(() => {
        if (!rateComparisonData || Object.keys(rateComparisonData).length === 0) {
          sections.tariffComparison = `# Tariff Comparison\n\nNo rate comparison data available. Please ensure tariff assignments have been saved and cost calculations have been performed.`;
          sectionStatus['tariffComparison'] = 'success';
          console.log('✓ Tariff Comparison completed (no data)');
          return;
        }

        let content = `# Tariff Comparison\n\n`;
        content += `This section compares document-billed rates with assigned tariff rates for each meter.\n\n`;

        for (const [meterId, meterData] of Object.entries(rateComparisonData) as [string, any][]) {
          content += `## Meter: ${meterData.meterNumber}`;
          if (meterData.meterName) {
            content += ` (${meterData.meterName})`;
          }
          content += `\n\n`;

          if (!meterData.documents || meterData.documents.length === 0) {
            content += `*No document comparisons available for this meter.*\n\n`;
            continue;
          }

          for (const doc of meterData.documents) {
            const periodStart = new Date(doc.periodStart).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short' });
            const periodEnd = new Date(doc.periodEnd).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short' });
            
            const varianceBadge = doc.overallVariance !== null 
              ? `**${doc.overallVariance.toFixed(1)}%**`
              : '—';
            
            content += `### Period: ${periodStart} - ${periodEnd} | Overall Variance: ${varianceBadge}\n\n`;

            if (!doc.lineItems || doc.lineItems.length === 0) {
              content += `*No rate comparison data available for this period.*\n\n`;
              continue;
            }

            content += `| Item | Document | Assigned | Variance |\n`;
            content += `|------|----------|----------|----------|\n`;

            for (const item of doc.lineItems) {
              const docValue = item.documentValue !== null 
                ? `R ${item.documentValue.toFixed(4)}${item.unit ? ' ' + item.unit.replace('R/', '') : ''}`
                : '—';
              
              const assignedValue = item.assignedValue !== null 
                ? `R ${item.assignedValue.toFixed(4)}${item.unit ? ' ' + item.unit.replace('R/', '') : ''}`
                : '—';
              
              const variance = item.variancePercent !== null 
                ? `${item.variancePercent > 0 ? '+' : ''}${item.variancePercent.toFixed(1)}%`
                : '—';
              
              content += `| ${item.chargeType} | ${docValue} | ${assignedValue} | ${variance} |\n`;
            }

            content += `\n`;
          }
        }

        sections.tariffComparison = content;
        sectionStatus['tariffComparison'] = 'success';
        console.log('✓ Tariff Comparison completed');
      }).catch(err => {
        sectionStatus['tariffComparison'] = 'failed';
        sections.tariffComparison = `# Tariff Comparison\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Tariff Comparison failed:', err);
      }),

      // 5. METERING DATA ANALYSIS
      callAIWithRetry('Metering Data Analysis', `Generate Section 5: Metering Data Analysis for ${siteName}.

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
5. CSV column analysis if selected (totals, max values, operations applied)`).then(content => {
        sections.meteringDataAnalysis = content;
        sectionStatus['meteringDataAnalysis'] = 'success';
        console.log('✓ Metering Data Analysis completed');
      }).catch(err => {
        sectionStatus['meteringDataAnalysis'] = 'failed';
        sections.meteringDataAnalysis = `# Metering Data Analysis\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Metering Data Analysis failed:', err);
      })
    ];

    // Wait for all batch 1 sections to complete
    await Promise.all(batch1Promises);
    console.log('Batch 1 completed');

    // BATCH 2: Generate sections that can run in parallel after batch 1
    console.log('Starting Batch 2: Document Validation, Reconciliation Results, Cost Analysis...');
    
    const batch2Promises = [];

    // 6. DOCUMENT & INVOICE VALIDATION (if documents available)
    if (documentExtractions && documentExtractions.length > 0) {
      batch2Promises.push(
        callAIWithRetry('Document Validation', `Generate Section 6: Document & Invoice Validation for ${siteName}.

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

Use ✓ for matches, ⚠ for <5% variance, ✗ for >5% variance`).then(content => {
          sections.documentValidation = content;
          sectionStatus['documentValidation'] = 'success';
          console.log('✓ Document Validation completed');
        }).catch(err => {
          sectionStatus['documentValidation'] = 'failed';
          sections.documentValidation = `# Document & Invoice Validation\n\n*This section could not be generated due to an error: ${err.message}*`;
          console.error('✗ Document Validation failed:', err);
        })
      );
    }

    // 7. RECONCILIATION RESULTS
    batch2Promises.push(
      callAIWithRetry('Reconciliation Results', `Generate Section 7: Reconciliation Results for ${siteName}.

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
5. Custom column analysis (selected columns with operations, totals, max values, factors)`).then(content => {
        sections.reconciliationResults = content;
        sectionStatus['reconciliationResults'] = 'success';
        console.log('✓ Reconciliation Results completed');
      }).catch(err => {
        sectionStatus['reconciliationResults'] = 'failed';
        sections.reconciliationResults = `# Reconciliation Results\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Reconciliation Results failed:', err);
      })
    );

    // 7. COST ANALYSIS
    if (costAnalysis) {
      batch2Promises.push(
        callAIWithRetry('Cost Analysis', `Generate Section 8: Cost Analysis for ${siteName}.

Cost Data:
${JSON.stringify(costAnalysis, null, 2)}

Reconciliation:
- Total Supply: ${reconciliationData.totalSupply} kWh
- Recovery Rate: ${reconciliationData.recoveryRate}%

Create section with:
1. Total cost breakdown (by meter type: bulk/solar/tenant, by component: energy/demand/fixed, by tariff)
2. Cost trends if historical data available (month-over-month, cost per kWh trends, demand charge trends)
3. Efficiency metrics (cost per m² if area available, solar offset value, tenant cost recovery %)
4. Cost optimization opportunities`).then(content => {
          sections.costAnalysis = content;
          sectionStatus['costAnalysis'] = 'success';
          console.log('✓ Cost Analysis completed');
        }).catch(err => {
          sectionStatus['costAnalysis'] = 'failed';
          sections.costAnalysis = `# Cost Analysis\n\n*This section could not be generated due to an error: ${err.message}*`;
          console.error('✗ Cost Analysis failed:', err);
        })
      );
    }

    // Wait for all batch 2 sections to complete
    await Promise.all(batch2Promises);
    console.log('Batch 2 completed');

    // BATCH 3: Generate final sections in parallel
    console.log('Starting Batch 3: Findings & Anomalies, Recommendations...');
    
    const batch3Promises = [
      // 8. FINDINGS & ANOMALIES
      callAIWithRetry('Findings & Anomalies', `Generate Section 9: Findings & Anomalies for ${siteName}.

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
5. Summary table of all anomalies (#, Severity, Meter, Description)`).then(content => {
        sections.findingsAnomalies = content;
        sectionStatus['findingsAnomalies'] = 'success';
        console.log('✓ Findings & Anomalies completed');
      }).catch(err => {
        sectionStatus['findingsAnomalies'] = 'failed';
        sections.findingsAnomalies = `# Findings & Anomalies\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Findings & Anomalies failed:', err);
      }),

      // 10. RECOMMENDATIONS
      callAIWithRetry('Recommendations', `Generate Section 10: Recommendations for ${siteName}.

Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
Recovery Rate: ${reconciliationData.recoveryRate}%
Anomalies: ${anomalies.length}
Critical/High Issues: ${anomalies.filter((a: any) => a.severity === 'CRITICAL' || a.severity === 'HIGH').length}

Create section with:
1. Immediate Actions (HIGH Priority) - table with Action, Owner, Timeline for 3-5 urgent items
2. Metering Improvements (MEDIUM Priority) - specific recommendations for additional sub-metering, meter upgrades, data collection
3. Cost Optimization - tariff optimization opportunities, load shifting potential based on TOU, solar utilization improvements
4. Documentation - schematic updates, meter verification needs, tariff review schedule

Make all recommendations specific, actionable, and tied to findings with clear priorities and timelines.`).then(content => {
        sections.recommendations = content;
        sectionStatus['recommendations'] = 'success';
        console.log('✓ Recommendations completed');
      }).catch(err => {
        sectionStatus['recommendations'] = 'failed';
        sections.recommendations = `# Recommendations\n\n*This section could not be generated due to an error: ${err.message}*`;
        console.error('✗ Recommendations failed:', err);
      })
    ];

    // Wait for all batch 3 sections to complete
    await Promise.all(batch3Promises);
    console.log('Batch 3 completed');

    // Log completion status
    const successCount = Object.values(sectionStatus).filter(s => s === 'success').length;
    const failedCount = Object.values(sectionStatus).filter(s => s === 'failed').length;
    console.log(`Report generation complete: ${successCount} sections succeeded, ${failedCount} sections failed`);

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
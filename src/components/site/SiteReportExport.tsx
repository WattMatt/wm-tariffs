import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Loader2, Download, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface SiteReportExportProps {
  siteId: string;
  siteName: string;
}

export default function SiteReportExport({ siteId, siteName }: SiteReportExportProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [periodStart, setPeriodStart] = useState<Date>();
  const [periodEnd, setPeriodEnd] = useState<Date>();
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [isEndOpen, setIsEndOpen] = useState(false);

  // Helper to combine date and time and format as naive timestamp string
  const getFullDateTime = (dateStr: string, time: string = "00:00"): string => {
    const date = new Date(dateStr);
    const [hours, minutes] = time.split(':').map(Number);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hrs = String(hours).padStart(2, '0');
    const mins = String(minutes).padStart(2, '0');
    // Return formatted string without timezone: "YYYY-MM-DD HH:mm:ss"
    return `${year}-${month}-${day} ${hrs}:${mins}:00`;
  };

  const generateReport = async () => {
    if (!periodStart || !periodEnd) {
      toast.error("Please select both start and end dates");
      return;
    }

    setIsGenerating(true);

    try {
      toast.info("Running reconciliation for selected period...");

      // 1. Fetch all meters for this site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select(`
          *,
          parent_connections:meter_connections!meter_connections_child_meter_id_fkey(
            parent_meter_id,
            connection_type,
            parent_meter:meters!meter_connections_parent_meter_id_fkey(
              meter_number,
              name
            )
          ),
          child_connections:meter_connections!meter_connections_parent_meter_id_fkey(
            child_meter_id,
            connection_type,
            child_meter:meters!meter_connections_child_meter_id_fkey(
              meter_number,
              name
            )
          )
        `)
        .eq("site_id", siteId);

      if (metersError) throw metersError;

      // 2. Set up date range with full day coverage
      const fullDateTimeFrom = getFullDateTime(format(periodStart, "yyyy-MM-dd"), "00:00");
      const fullDateTimeTo = getFullDateTime(format(periodEnd, "yyyy-MM-dd"), "23:59");

      // 3. Fetch readings for each meter with pagination and deduplication
      const meterData = await Promise.all(
        meters?.map(async (meter) => {
          let allReadings: any[] = [];
          let from = 0;
          const pageSize = 1000;
          let hasMore = true;

          while (hasMore) {
            const { data: pageData, error: readingsError } = await supabase
              .from("meter_readings")
              .select("kwh_value, reading_timestamp, metadata")
              .eq("meter_id", meter.id)
              .gte("reading_timestamp", fullDateTimeFrom)
              .lte("reading_timestamp", fullDateTimeTo)
              .order("reading_timestamp", { ascending: true })
              .range(from, from + pageSize - 1);

            if (readingsError) {
              console.error(`Error fetching readings for meter ${meter.meter_number}:`, readingsError);
              break;
            }

            if (pageData && pageData.length > 0) {
              allReadings = [...allReadings, ...pageData];
              from += pageSize;
              hasMore = pageData.length === pageSize;
            } else {
              hasMore = false;
            }
          }

          // Deduplicate by timestamp
          const uniqueReadings = Array.from(
            new Map(allReadings.map(r => [r.reading_timestamp, r])).values()
          );

          // Sum all interval readings
          const totalKwh = uniqueReadings.reduce((sum, r) => sum + Number(r.kwh_value || 0), 0);
          
          const columnTotals: Record<string, number> = {};
          const columnMaxValues: Record<string, number> = {};
          
          uniqueReadings.forEach(reading => {
            const importedFields = (reading.metadata as any)?.imported_fields || {};
            Object.entries(importedFields).forEach(([key, value]) => {
              if (key.toLowerCase().includes('time') || key.toLowerCase().includes('date')) return;
              
              const numValue = Number(value);
              if (!isNaN(numValue) && value !== null && value !== '') {
                if (key.toLowerCase().includes('kva')) {
                  columnMaxValues[key] = Math.max(columnMaxValues[key] || 0, numValue);
                } else {
                  columnTotals[key] = (columnTotals[key] || 0) + numValue;
                }
              }
            });
          });

          return {
            ...meter,
            totalKwh,
            columnTotals,
            columnMaxValues,
            readingsCount: uniqueReadings.length,
          };
        }) || []
      );

      // 4. Categorize meters by type
      const councilBulk = meterData.filter((m) => m.meter_type === "council_bulk");
      const checkMeters = meterData.filter((m) => m.meter_type === "check_meter");
      const solarMeters = meterData.filter((m) => m.meter_type === "solar");
      const distribution = meterData.filter((m) => m.meter_type === "distribution");

      const councilTotal = councilBulk.reduce((sum, m) => sum + m.totalKwh, 0);
      const solarTotal = solarMeters.reduce((sum, m) => sum + m.totalKwh, 0);
      const distributionTotal = distribution.reduce((sum, m) => sum + m.totalKwh, 0);
      
      const totalSupply = councilTotal + solarTotal;
      const recoveryRate = totalSupply > 0 ? (distributionTotal / totalSupply) * 100 : 0;
      const discrepancy = totalSupply - distributionTotal;
      const variancePercentage = totalSupply > 0 
        ? ((discrepancy / totalSupply) * 100).toFixed(2)
        : "0";

      // 5. Detect anomalies
      const anomalies: any[] = [];

      // Missing readings
      meterData.forEach(m => {
        if (m.readingsCount === 0) {
          anomalies.push({
            type: "no_readings",
            meter: m.meter_number,
            description: "No readings available for the period",
            severity: "critical"
          });
        } else if (m.readingsCount < 10) {
          anomalies.push({
            type: "insufficient_readings",
            meter: m.meter_number,
            description: `Only ${m.readingsCount} reading(s) available for the period`,
            severity: "high"
          });
        }
      });

      // Negative consumption
      meterData.forEach(m => {
        if (m.totalKwh < 0) {
          anomalies.push({
            type: "negative_consumption",
            meter: m.meter_number,
            consumption: m.totalKwh.toFixed(2),
            description: "Negative consumption detected - possible meter rollback or tampering",
            severity: "critical"
          });
        }
      });

      // High variance
      if (Math.abs(parseFloat(variancePercentage)) > 10) {
        anomalies.push({
          type: "high_variance",
          variance: discrepancy.toFixed(2),
          variancePercentage,
          description: `Variance of ${variancePercentage}% between supply and distribution exceeds acceptable threshold`,
          severity: "high"
        });
      }

      // Low recovery rate
      if (recoveryRate < 90) {
        anomalies.push({
          type: "low_recovery",
          recoveryRate: recoveryRate.toFixed(2),
          description: `Recovery rate of ${recoveryRate.toFixed(2)}% is below acceptable threshold of 90%`,
          severity: "high"
        });
      }

      // 8. Fetch document extractions
      const { data: documents, error: docsError } = await supabase
        .from("site_documents")
        .select(`
          *,
          document_extractions(*)
        `)
        .eq("site_id", siteId)
        .eq("extraction_status", "completed");

      if (docsError) throw docsError;

      const documentExtractions = documents?.map(doc => ({
        fileName: doc.file_name,
        documentType: doc.document_type,
        extraction: doc.document_extractions?.[0]
      })).filter(d => d.extraction) || [];

      // 6. Prepare reconciliation data
      const reconciliationData = {
        councilBulkMeters: councilBulk.map(m => m.meter_number).join(", ") || "N/A",
        councilTotal: councilTotal.toFixed(2),
        solarTotal: solarTotal.toFixed(2),
        totalSupply: totalSupply.toFixed(2),
        distributionTotal: distributionTotal.toFixed(2),
        variance: discrepancy.toFixed(2),
        variancePercentage,
        recoveryRate: recoveryRate.toFixed(2),
        meterCount: meterData.length,
        councilBulkCount: councilBulk.length,
        solarCount: solarMeters.length,
        distributionCount: distribution.length,
        readingsPeriod: `${format(periodStart, "dd MMM yyyy")} - ${format(periodEnd, "dd MMM yyyy")}`
      };

      // 7. Prepare detailed meter breakdown
      const meterBreakdown = meterData.map(m => ({
        meterNumber: m.meter_number,
        name: m.name,
        type: m.meter_type,
        location: m.location,
        consumption: m.totalKwh.toFixed(2),
        readingsCount: m.readingsCount,
        parentMeters: m.parent_connections?.map((pc: any) => 
          pc.parent_meter?.meter_number
        ) || [],
        childMeters: m.child_connections?.map((cc: any) => 
          cc.child_meter?.meter_number
        ) || []
      }));

      // 8. Prepare meter hierarchy
      const meterHierarchy = meters?.map(meter => {
        const meterInfo = meterData.find(m => m.id === meter.id);
        return {
          meterNumber: meter.meter_number,
          name: meter.name,
          type: meter.meter_type,
          location: meter.location,
          consumption: meterInfo?.totalKwh.toFixed(2) || "0.00",
          readingsCount: meterInfo?.readingsCount || 0,
          parentMeters: meter.parent_connections?.map((pc: any) => 
            pc.parent_meter?.meter_number
          ) || [],
          childMeters: meter.child_connections?.map((cc: any) => 
            cc.child_meter?.meter_number
          ) || []
        };
      }) || [];

      // 9. Generate AI narrative sections
      toast.info("Generating report sections with AI...");

      const { data: reportData, error: aiError } = await supabase.functions.invoke(
        "generate-audit-report",
        {
          body: {
            siteName,
            auditPeriodStart: format(periodStart, "dd MMMM yyyy"),
            auditPeriodEnd: format(periodEnd, "dd MMMM yyyy"),
            meterHierarchy,
            meterBreakdown,
            reconciliationData,
            documentExtractions,
            anomalies
          }
        }
      );

      if (aiError) throw aiError;

      // 12. Generate PDF
      toast.info("Generating PDF...");
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      let yPos = margin;

      // Helper function to add text with wrapping
      const addText = (text: string, fontSize: number = 10, isBold: boolean = false) => {
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", isBold ? "bold" : "normal");
        const lines = pdf.splitTextToSize(text, pageWidth - 2 * margin);
        
        lines.forEach((line: string) => {
          if (yPos > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
          }
          pdf.text(line, margin, yPos);
          yPos += fontSize * 0.5;
        });
        yPos += 5;
      };

      // Title Page
      pdf.setFontSize(24);
      pdf.setFont("helvetica", "bold");
      pdf.text("METERING AUDIT REPORT", pageWidth / 2, 60, { align: "center" });
      
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "normal");
      pdf.text(siteName, pageWidth / 2, 80, { align: "center" });
      
      pdf.setFontSize(12);
      pdf.text(
        `Audit Period: ${format(periodStart, "dd MMM yyyy")} - ${format(periodEnd, "dd MMM yyyy")}`,
        pageWidth / 2,
        100,
        { align: "center" }
      );

      pdf.text(`Generated: ${format(new Date(), "dd MMM yyyy HH:mm")}`, pageWidth / 2, 115, { align: "center" });

      // New page for content
      pdf.addPage();
      yPos = margin;

      // 1. Executive Summary
      addText("1. EXECUTIVE SUMMARY", 16, true);
      addText(reportData.sections.executiveSummary);

      // 2. Metering Hierarchy Overview
      addText("2. METERING HIERARCHY OVERVIEW", 16, true);
      addText(reportData.sections.hierarchyOverview);

      // 3. Data Sources and Period
      addText("3. DATA SOURCES AND AUDIT PERIOD", 16, true);
      addText(`Audit Period: ${reconciliationData.readingsPeriod}`, 10, true);
      addText(`Council Bulk Meters: ${reconciliationData.councilBulkMeters}`);
      addText(`Total Meters: ${reconciliationData.meterCount} (${reconciliationData.councilBulkCount} council, ${reconciliationData.solarCount} solar, ${reconciliationData.distributionCount} distribution)`);
      addText(`Documents Analyzed: ${documentExtractions.length}`);

      // 4. Metering Reconciliation
      addText("4. METERING RECONCILIATION", 16, true);
      addText("Supply Summary:", 12, true);
      addText(`Council Bulk Supply: ${reconciliationData.councilTotal} kWh`);
      if (parseFloat(reconciliationData.solarTotal) > 0) {
        addText(`Solar Generation: ${reconciliationData.solarTotal} kWh`);
      }
      addText(`Total Supply: ${reconciliationData.totalSupply} kWh`);
      addText("");
      addText("Distribution Summary:", 12, true);
      addText(`Total Distribution Consumption: ${reconciliationData.distributionTotal} kWh`);
      addText(`Recovery Rate: ${reconciliationData.recoveryRate}%`);
      addText(`Discrepancy: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)`);

      // Meter details table
      yPos += 5;
      addText("Individual Meter Consumption:", 12, true);
      
      if (councilBulk.length > 0) {
        addText("Council Bulk Meters:", 11, true);
        councilBulk.forEach(m => {
          addText(`  ${m.meter_number} (${m.name}): ${m.totalKwh.toFixed(2)} kWh - ${m.readingsCount} readings`);
        });
      }
      
      if (solarMeters.length > 0) {
        addText("Solar Meters:", 11, true);
        solarMeters.forEach(m => {
          addText(`  ${m.meter_number} (${m.name}): ${m.totalKwh.toFixed(2)} kWh - ${m.readingsCount} readings`);
        });
      }
      
      if (distribution.length > 0) {
        addText("Distribution Meters:", 11, true);
        distribution.forEach(m => {
          addText(`  ${m.meter_number} (${m.name}): ${m.totalKwh.toFixed(2)} kWh - ${m.readingsCount} readings`);
        });
      }
      
      if (checkMeters.length > 0) {
        addText("Check Meters:", 11, true);
        checkMeters.forEach(m => {
          addText(`  ${m.meter_number} (${m.name}): ${m.totalKwh.toFixed(2)} kWh - ${m.readingsCount} readings`);
        });
      }

      // 5. Billing Validation
      if (reportData.sections.billingValidation) {
        addText("5. BILLING VALIDATION", 16, true);
        addText(reportData.sections.billingValidation);
      }

      // 6. Observations and Anomalies
      addText("6. OBSERVATIONS AND ANOMALIES", 16, true);
      addText(reportData.sections.observations);
      
      if (anomalies.length > 0) {
        addText("Detected Anomalies:", 12, true);
        anomalies.forEach((anomaly, index) => {
          addText(`${index + 1}. [${anomaly.severity.toUpperCase()}] ${anomaly.description}`);
          if (anomaly.meter) addText(`   Meter: ${anomaly.meter}`);
        });
      }

      // 7. Recommendations
      addText("7. RECOMMENDATIONS", 16, true);
      addText(reportData.sections.recommendations);

      // 8. Appendices
      pdf.addPage();
      yPos = margin;
      addText("8. APPENDICES", 16, true);
      
      addText("Appendix A: Meter Hierarchy", 12, true);
      meterHierarchy.forEach(meter => {
        addText(`${meter.meterNumber} - ${meter.name} (${meter.type})`, 10, true);
        if (meter.parentMeters.length > 0) {
          addText(`  Parent(s): ${meter.parentMeters.join(", ")}`);
        }
        if (meter.childMeters.length > 0) {
          addText(`  Children: ${meter.childMeters.join(", ")}`);
        }
      });

      // Save PDF
      const fileName = `${siteName.replace(/\s+/g, "_")}_Audit_Report_${format(new Date(), "yyyyMMdd")}.pdf`;
      pdf.save(fileName);

      toast.success("Audit report generated successfully!");

    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate audit report");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Generate Audit Report
        </CardTitle>
        <CardDescription>
          Create a comprehensive metering audit report with AI-generated insights
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Audit Period Start</Label>
            <Popover open={isStartOpen} onOpenChange={setIsStartOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !periodStart && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {periodStart ? format(periodStart, "dd MMM yyyy") : "Select start date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={periodStart}
                  onSelect={(date) => {
                    setPeriodStart(date);
                    setIsStartOpen(false);
                  }}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label>Audit Period End</Label>
            <Popover open={isEndOpen} onOpenChange={setIsEndOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !periodEnd && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {periodEnd ? format(periodEnd, "dd MMM yyyy") : "Select end date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={periodEnd}
                  onSelect={(date) => {
                    setPeriodEnd(date);
                    setIsEndOpen(false);
                  }}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="p-4 border rounded-lg bg-muted/30 space-y-2">
          <p className="text-sm font-medium">Report will include:</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Executive Summary</li>
            <li>Metering Hierarchy Overview</li>
            <li>Consumption Reconciliation</li>
            <li>Billing Validation (from uploaded documents)</li>
            <li>Anomaly Detection & Analysis</li>
            <li>AI-Generated Recommendations</li>
            <li>Detailed Appendices</li>
          </ul>
        </div>

        <Button
          onClick={generateReport}
          disabled={isGenerating || !periodStart || !periodEnd}
          className="w-full"
          size="lg"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Report...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Generate Audit Report
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

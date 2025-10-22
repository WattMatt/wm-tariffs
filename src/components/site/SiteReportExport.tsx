import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Loader2, Download } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";

interface SiteReportExportProps {
  siteId: string;
  siteName: string;
}

export default function SiteReportExport({ siteId, siteName }: SiteReportExportProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const generateReport = async () => {
    if (!periodStart || !periodEnd) {
      toast.error("Please select both start and end dates");
      return;
    }

    setIsGenerating(true);

    try {
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

      // 2. Fetch meter readings for the period
      const { data: readings, error: readingsError } = await supabase
        .from("meter_readings")
        .select("*")
        .in("meter_id", meters?.map(m => m.id) || [])
        .gte("reading_timestamp", periodStart)
        .lte("reading_timestamp", periodEnd);

      if (readingsError) throw readingsError;

      // 3. Calculate consumption per meter
      const meterConsumption = meters?.map(meter => {
        const meterReadings = readings?.filter(r => r.meter_id === meter.id) || [];
        
        if (meterReadings.length < 2) {
          return {
            meter,
            consumption: 0,
            readingsCount: meterReadings.length,
            firstReading: null,
            lastReading: null
          };
        }

        meterReadings.sort((a, b) => 
          new Date(a.reading_timestamp).getTime() - new Date(b.reading_timestamp).getTime()
        );

        const firstReading = meterReadings[0];
        const lastReading = meterReadings[meterReadings.length - 1];
        const consumption = lastReading.kwh_value - firstReading.kwh_value;

        return {
          meter,
          consumption,
          readingsCount: meterReadings.length,
          firstReading,
          lastReading
        };
      }) || [];

      // 4. Identify bulk meter (meter with no parent)
      const bulkMeter = meterConsumption.find(
        mc => !mc.meter.parent_connections || mc.meter.parent_connections.length === 0
      );

      // 5. Calculate total sub-meter consumption
      const subMeters = meterConsumption.filter(
        mc => mc.meter.id !== bulkMeter?.meter.id
      );
      const totalSubMeterConsumption = subMeters.reduce((sum, mc) => sum + mc.consumption, 0);

      // 6. Calculate variance
      const bulkConsumption = bulkMeter?.consumption || 0;
      const variance = bulkConsumption - totalSubMeterConsumption;
      const variancePercentage = bulkConsumption > 0 
        ? ((variance / bulkConsumption) * 100).toFixed(2)
        : "0";

      // 7. Detect anomalies
      const anomalies: any[] = [];

      // Missing readings
      meterConsumption.forEach(mc => {
        if (mc.readingsCount < 2) {
          anomalies.push({
            type: "insufficient_readings",
            meter: mc.meter.meter_number,
            description: `Only ${mc.readingsCount} reading(s) available for the period`,
            severity: "high"
          });
        }
      });

      // Negative consumption
      meterConsumption.forEach(mc => {
        if (mc.consumption < 0) {
          anomalies.push({
            type: "negative_consumption",
            meter: mc.meter.meter_number,
            consumption: mc.consumption,
            description: "Negative consumption detected - possible meter rollback or tampering",
            severity: "critical"
          });
        }
      });

      // High variance
      if (Math.abs(parseFloat(variancePercentage)) > 10) {
        anomalies.push({
          type: "high_variance",
          variance: variance.toFixed(2),
          variancePercentage,
          description: `Variance of ${variancePercentage}% between bulk and sub-meters exceeds acceptable threshold`,
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

      // 9. Prepare reconciliation data
      const reconciliationData = {
        bulkMeter: bulkMeter?.meter.meter_number || "N/A",
        bulkConsumption: bulkConsumption.toFixed(2),
        totalSubMeterConsumption: totalSubMeterConsumption.toFixed(2),
        variance: variance.toFixed(2),
        variancePercentage,
        subMeterCount: subMeters.length,
        readingsPeriod: `${format(new Date(periodStart), "dd MMM yyyy")} - ${format(new Date(periodEnd), "dd MMM yyyy")}`
      };

      // 10. Prepare meter hierarchy
      const meterHierarchy = meters?.map(meter => ({
        meterNumber: meter.meter_number,
        name: meter.name,
        type: meter.meter_type,
        location: meter.location,
        parentMeters: meter.parent_connections?.map((pc: any) => 
          pc.parent_meter?.meter_number
        ) || [],
        childMeters: meter.child_connections?.map((cc: any) => 
          cc.child_meter?.meter_number
        ) || []
      })) || [];

      // 11. Generate AI narrative sections
      toast.info("Generating report sections with AI...");

      const { data: reportData, error: aiError } = await supabase.functions.invoke(
        "generate-audit-report",
        {
          body: {
            siteName,
            auditPeriodStart: format(new Date(periodStart), "dd MMMM yyyy"),
            auditPeriodEnd: format(new Date(periodEnd), "dd MMMM yyyy"),
            meterHierarchy,
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
        `Audit Period: ${format(new Date(periodStart), "dd MMM yyyy")} - ${format(new Date(periodEnd), "dd MMM yyyy")}`,
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
      addText(`Bulk Meter: ${reconciliationData.bulkMeter}`);
      addText(`Number of Sub-Meters: ${reconciliationData.subMeterCount}`);
      addText(`Documents Analyzed: ${documentExtractions.length}`);

      // 4. Metering Reconciliation
      addText("4. METERING RECONCILIATION", 16, true);
      addText("Consumption Summary:", 12, true);
      addText(`Bulk Supply Meter: ${reconciliationData.bulkConsumption} kWh`);
      addText(`Total Sub-Meter Consumption: ${reconciliationData.totalSubMeterConsumption} kWh`);
      addText(`Variance: ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)`);

      // Meter details table
      yPos += 5;
      addText("Individual Meter Consumption:", 12, true);
      meterConsumption.forEach(mc => {
        addText(`${mc.meter.meter_number} (${mc.meter.name}): ${mc.consumption.toFixed(2)} kWh - ${mc.readingsCount} readings`);
      });

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
            <Label htmlFor="period-start">Audit Period Start</Label>
            <Input
              id="period-start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period-end">Audit Period End</Label>
            <Input
              id="period-end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
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

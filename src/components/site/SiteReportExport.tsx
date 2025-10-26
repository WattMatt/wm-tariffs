import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Loader2, Download, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SiteReportExportProps {
  siteId: string;
  siteName: string;
}

interface MeterOption {
  id: string;
  meter_number: string;
  name: string;
  meter_type: string;
  location?: string;
}

interface ColumnConfig {
  columnName: string;
  aggregation: 'sum' | 'max';
  multiplier: number;
  selected: boolean;
}

export default function SiteReportExport({ siteId, siteName }: SiteReportExportProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [periodStart, setPeriodStart] = useState<Date>();
  const [periodEnd, setPeriodEnd] = useState<Date>();
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [isEndOpen, setIsEndOpen] = useState(false);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [availableMeters, setAvailableMeters] = useState<MeterOption[]>([]);
  const [selectedMeterIds, setSelectedMeterIds] = useState<Set<string>>(new Set());
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [columnConfigs, setColumnConfigs] = useState<Record<string, ColumnConfig>>({});
  const [isLoadingColumns, setIsLoadingColumns] = useState(false);

  // Fetch available meters on mount
  useEffect(() => {
    const fetchMeters = async () => {
      setIsLoadingMeters(true);
      try {
        const { data: meters, error } = await supabase
          .from("meters")
          .select("id, meter_number, name, meter_type, location")
          .eq("site_id", siteId)
          .order("meter_type", { ascending: true })
          .order("meter_number", { ascending: true });

        if (error) throw error;

        if (meters) {
          setAvailableMeters(meters);
          // Select all meters by default
          setSelectedMeterIds(new Set(meters.map(m => m.id)));
        }
      } catch (error) {
        console.error("Error fetching meters:", error);
        toast.error("Failed to load meters");
      } finally {
        setIsLoadingMeters(false);
      }
    };

    fetchMeters();
  }, [siteId]);

  // Fetch available CSV columns when meters are selected
  useEffect(() => {
    const fetchAvailableColumns = async () => {
      if (selectedMeterIds.size === 0) {
        setAvailableColumns([]);
        setColumnConfigs({});
        return;
      }

      setIsLoadingColumns(true);
      try {
        // Fetch column mappings from CSV files (same approach as Reconciliation tab)
        const { data: csvFiles, error } = await supabase
          .from("meter_csv_files")
          .select("column_mapping, meter_id")
          .in("meter_id", Array.from(selectedMeterIds))
          .not("column_mapping", "is", null)
          .order("parsed_at", { ascending: false });

        if (error) throw error;

        // Extract unique column names from column_mapping.renamedHeaders
        const columnsSet = new Set<string>();
        
        // First try to get columns from column_mapping (most reliable)
        csvFiles?.forEach((csvFile) => {
          const columnMapping = csvFile.column_mapping as any;
          if (columnMapping?.renamedHeaders) {
            Object.values(columnMapping.renamedHeaders).forEach((headerName: any) => {
              if (headerName && typeof headerName === 'string') {
                // More precise filtering: exclude columns that are clearly date/time fields
                const lowerKey = headerName.toLowerCase();
                const isDateTimeColumn = 
                  lowerKey === 'time' || 
                  lowerKey === 'date' || 
                  lowerKey === 'datetime' || 
                  lowerKey === 'timestamp' || 
                  lowerKey.startsWith('time_') ||
                  lowerKey.startsWith('date_') ||
                  lowerKey.endsWith('_time') ||
                  lowerKey.endsWith('_date');

                if (!isDateTimeColumn) {
                  columnsSet.add(headerName);
                }
              }
            });
          }
        });

        // Fallback: If no column mappings found, sample readings
        if (columnsSet.size === 0) {
          const { data: sampleReadings } = await supabase
            .from("meter_readings")
            .select("metadata")
            .in("meter_id", Array.from(selectedMeterIds))
            .not("metadata", "is", null)
            .limit(100);

          sampleReadings?.forEach((reading) => {
            const metadata = reading.metadata as any;
            if (metadata?.imported_fields) {
              Object.keys(metadata.imported_fields).forEach((key) => {
                const lowerKey = key.toLowerCase();
                const isDateTimeColumn = 
                  lowerKey === 'time' || 
                  lowerKey === 'date' || 
                  lowerKey === 'datetime' || 
                  lowerKey === 'timestamp' || 
                  lowerKey.startsWith('time_') ||
                  lowerKey.startsWith('date_') ||
                  lowerKey.endsWith('_time') ||
                  lowerKey.endsWith('_date');

                if (!isDateTimeColumn) {
                  columnsSet.add(key);
                }
              });
            }
          });
        }

        const columns = Array.from(columnsSet).sort();
        setAvailableColumns(columns);

        // Initialize column configs with defaults
        const configs: Record<string, ColumnConfig> = {};
        columns.forEach(col => {
          const isKVA = col.toLowerCase().includes('kva');
          configs[col] = {
            columnName: col,
            aggregation: isKVA ? 'max' : 'sum',
            multiplier: 1,
            selected: true // Select all by default
          };
        });
        setColumnConfigs(configs);

      } catch (error) {
        console.error("Error fetching columns:", error);
        toast.error("Failed to load CSV columns");
      } finally {
        setIsLoadingColumns(false);
      }
    };

    fetchAvailableColumns();
  }, [selectedMeterIds]);

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

      // 1. Fetch all meters for this site (only selected ones)
      if (selectedMeterIds.size === 0) {
        toast.error("Please select at least one meter");
        setIsGenerating(false);
        return;
      }

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
        .eq("site_id", siteId)
        .in("id", Array.from(selectedMeterIds));

      if (metersError) throw metersError;

      // 2. Set up date range with selected times
      const fullDateTimeFrom = getFullDateTime(format(periodStart, "yyyy-MM-dd"), startTime);
      const fullDateTimeTo = getFullDateTime(format(periodEnd, "yyyy-MM-dd"), endTime);

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

      // 5. Prepare reconciliation data with enhanced categorization
      const reconciliationData = {
        councilBulkMeters: councilBulk.map(m => `${m.meter_number} (${m.name})`).join(", ") || "N/A",
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
        checkMeterCount: checkMeters.length,
        readingsPeriod: `${format(periodStart, "dd MMM yyyy")} - ${format(periodEnd, "dd MMM yyyy")}`,
        documentsAnalyzed: 0 // Will be updated after fetching documents
      };

      // 6. Detect anomalies with severity categorization
      const anomalies: any[] = [];

      // Critical: No readings on bulk meters
      councilBulk.forEach(m => {
        if (m.readingsCount === 0) {
          anomalies.push({
            type: "no_readings_bulk",
            meter: m.meter_number,
            name: m.name,
            description: `Council bulk meter ${m.meter_number} has no readings for the audit period`,
            severity: "CRITICAL"
          });
        }
      });

      // Critical: Negative consumption
      meterData.forEach(m => {
        if (m.totalKwh < 0) {
          anomalies.push({
            type: "negative_consumption",
            meter: m.meter_number,
            name: m.name,
            consumption: m.totalKwh.toFixed(2),
            description: `Meter ${m.meter_number} (${m.name}) shows negative consumption of ${m.totalKwh.toFixed(2)} kWh - possible meter rollback or tampering`,
            severity: "CRITICAL"
          });
        }
      });

      // High: Insufficient readings (< 10)
      meterData.forEach(m => {
        if (m.readingsCount > 0 && m.readingsCount < 10) {
          anomalies.push({
            type: "insufficient_readings",
            meter: m.meter_number,
            name: m.name,
            readingsCount: m.readingsCount,
            description: `Meter ${m.meter_number} (${m.name}) has only ${m.readingsCount} reading(s) - insufficient for accurate reconciliation`,
            severity: "HIGH"
          });
        }
      });

      // High: Excessive variance (> 10%)
      if (Math.abs(parseFloat(variancePercentage)) > 10) {
        anomalies.push({
          type: "high_variance",
          variance: discrepancy.toFixed(2),
          variancePercentage,
          description: `Variance of ${variancePercentage}% (${discrepancy.toFixed(2)} kWh) between supply and distribution exceeds acceptable threshold of 5-7%`,
          severity: "HIGH"
        });
      }

      // High: Low recovery rate (< 90%)
      if (recoveryRate < 90) {
        anomalies.push({
          type: "low_recovery",
          recoveryRate: recoveryRate.toFixed(2),
          lostRevenue: (totalSupply - distributionTotal) * 2.5, // Estimate at R2.50/kWh
          description: `Recovery rate of ${recoveryRate.toFixed(2)}% is below acceptable threshold of 90-95% - estimated revenue loss: R${((totalSupply - distributionTotal) * 2.5).toFixed(2)}`,
          severity: "HIGH"
        });
      }

      // Medium: Moderate variance (5-10%)
      if (Math.abs(parseFloat(variancePercentage)) > 5 && Math.abs(parseFloat(variancePercentage)) <= 10) {
        anomalies.push({
          type: "moderate_variance",
          variance: discrepancy.toFixed(2),
          variancePercentage,
          description: `Variance of ${variancePercentage}% (${discrepancy.toFixed(2)} kWh) between supply and distribution is above optimal range of 2-5%`,
          severity: "MEDIUM"
        });
      }

      // Low: No readings on distribution meters (non-critical)
      distribution.forEach(m => {
        if (m.readingsCount === 0) {
          anomalies.push({
            type: "no_readings_distribution",
            meter: m.meter_number,
            name: m.name,
            description: `Distribution meter ${m.meter_number} (${m.name}) has no readings - may be inactive or require investigation`,
            severity: "LOW"
          });
        }
      });

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

      // Update reconciliation data with documents count
      reconciliationData.documentsAnalyzed = documentExtractions.length;

      // 8. Prepare detailed meter breakdown with sorting
      const sortMetersByType = (meters: any[]) => {
        return meters.sort((a, b) => {
          // Sort by type priority: council_bulk > solar > check_meter > distribution
          const typeOrder = { council_bulk: 1, solar: 2, check_meter: 3, distribution: 4 };
          const aOrder = typeOrder[a.meter_type as keyof typeof typeOrder] || 5;
          const bOrder = typeOrder[b.meter_type as keyof typeof typeOrder] || 5;
          if (aOrder !== bOrder) return aOrder - bOrder;
          // Then by meter number
          return (a.meter_number || "").localeCompare(b.meter_number || "");
        });
      };

      const meterBreakdown = sortMetersByType(meterData).map(m => ({
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

      // 9. Prepare meter hierarchy
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

      // 10. Generate AI narrative sections
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

      // 11. Generate PDF with enhanced formatting
      toast.info("Generating PDF...");
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      let yPos = margin;

      // Helper function to add text with wrapping
      const addText = (text: string, fontSize: number = 10, isBold: boolean = false, indent: number = 0) => {
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", isBold ? "bold" : "normal");
        const maxWidth = pageWidth - 2 * margin - indent;
        const lines = pdf.splitTextToSize(text, maxWidth);
        
        lines.forEach((line: string) => {
          if (yPos > pageHeight - margin - 10) {
            pdf.addPage();
            yPos = margin;
          }
          pdf.text(line, margin + indent, yPos);
          yPos += fontSize * 0.5;
        });
        yPos += 3;
      };

      const addSectionHeading = (text: string, fontSize: number = 14) => {
        yPos += 5;
        if (yPos > pageHeight - margin - 20) {
          pdf.addPage();
          yPos = margin;
        }
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", "bold");
        pdf.text(text, margin, yPos);
        yPos += fontSize * 0.6;
        yPos += 3;
      };

      const addSubsectionHeading = (text: string) => {
        yPos += 3;
        addText(text, 11, true);
      };

      const addSpacer = (height: number = 5) => {
        yPos += height;
      };

      // Title Page with enhanced styling
      pdf.setFontSize(28);
      pdf.setFont("helvetica", "bold");
      pdf.text("METERING AUDIT REPORT", pageWidth / 2, 70, { align: "center" });
      
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text(siteName, pageWidth / 2, 95, { align: "center" });
      
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      pdf.text(
        `Audit Period: ${format(periodStart, "dd MMMM yyyy")} - ${format(periodEnd, "dd MMMM yyyy")}`,
        pageWidth / 2,
        115,
        { align: "center" }
      );

      pdf.setFontSize(10);
      pdf.text(`Report Generated: ${format(new Date(), "dd MMMM yyyy HH:mm")}`, pageWidth / 2, 130, { align: "center" });

      // New page for content
      pdf.addPage();
      yPos = margin;

      // Section 1: Executive Summary
      addSectionHeading("1. EXECUTIVE SUMMARY", 16);
      addText(reportData.sections.executiveSummary);
      addSpacer(8);

      // Section 2: Metering Hierarchy Overview
      addSectionHeading("2. METERING HIERARCHY OVERVIEW", 16);
      addText(reportData.sections.hierarchyOverview);
      addSpacer(8);

      // Section 3: Data Sources and Audit Period
      addSectionHeading("3. DATA SOURCES AND AUDIT PERIOD", 16);
      addSubsectionHeading("Audit Period");
      addText(`${format(periodStart, "dd MMMM yyyy")} to ${format(periodEnd, "dd MMMM yyyy")}`);
      addSpacer(3);
      
      addSubsectionHeading("Council Bulk Supply Meters");
      addText(reconciliationData.councilBulkMeters);
      addSpacer(3);
      
      addSubsectionHeading("Metering Infrastructure");
      addText(`Total Meters Analyzed: ${reconciliationData.meterCount}`);
      addText(`  • Council Bulk Meters: ${reconciliationData.councilBulkCount}`, 10, false, 5);
      if (reconciliationData.solarCount > 0) {
        addText(`  • Solar/Generation Meters: ${reconciliationData.solarCount}`, 10, false, 5);
      }
      addText(`  • Distribution Meters: ${reconciliationData.distributionCount}`, 10, false, 5);
      addText(`  • Check Meters: ${reconciliationData.checkMeterCount}`, 10, false, 5);
      addSpacer(3);
      
      addSubsectionHeading("Documents Analyzed");
      addText(`${reconciliationData.documentsAnalyzed} billing documents processed and validated`);
      addSpacer(8);

      // Section 4: Metering Reconciliation
      addSectionHeading("4. METERING RECONCILIATION", 16);
      
      addSubsectionHeading("4.1 Supply Summary");
      addText(`Council Bulk Supply: ${reconciliationData.councilTotal} kWh`, 10, true);
      if (parseFloat(reconciliationData.solarTotal) > 0) {
        addText(`Solar Generation: ${reconciliationData.solarTotal} kWh`, 10, true);
      }
      addText(`Total Supply: ${reconciliationData.totalSupply} kWh`, 10, true);
      addSpacer(5);
      
      addSubsectionHeading("4.2 Distribution Summary");
      addText(`Total Distribution Consumption: ${reconciliationData.distributionTotal} kWh`, 10, true);
      addText(`Recovery Rate: ${reconciliationData.recoveryRate}%`, 10, true);
      const varianceSign = parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : "";
      addText(`Discrepancy: ${varianceSign}${reconciliationData.variance} kWh (${varianceSign}${reconciliationData.variancePercentage}%)`, 10, true);
      addSpacer(5);

      addSubsectionHeading("4.3 Individual Meter Consumption");
      addSpacer(2);
      
      if (councilBulk.length > 0) {
        addText("Council Bulk Meters", 10, true);
        councilBulk.forEach(m => {
          addText(`${m.meter_number} - ${m.name || "N/A"}`, 10, true, 3);
          addText(`${m.totalKwh.toFixed(2)} kWh (${m.readingsCount} readings)`, 9, false, 6);
        });
        addSpacer(3);
      }
      
      if (solarMeters.length > 0) {
        addText("Solar Generation Meters", 10, true);
        solarMeters.forEach(m => {
          addText(`${m.meter_number} - ${m.name || "N/A"}`, 10, true, 3);
          addText(`${m.totalKwh.toFixed(2)} kWh (${m.readingsCount} readings)`, 9, false, 6);
        });
        addSpacer(3);
      }
      
      if (distribution.length > 0) {
        addText("Distribution Meters", 10, true);
        distribution.forEach(m => {
          addText(`${m.meter_number} - ${m.name || m.location || "N/A"}`, 10, true, 3);
          addText(`${m.totalKwh.toFixed(2)} kWh (${m.readingsCount} readings)`, 9, false, 6);
        });
        addSpacer(3);
      }
      
      if (checkMeters.length > 0) {
        addText("Check Meters", 10, true);
        checkMeters.forEach(m => {
          const status = m.readingsCount === 0 ? " [INACTIVE]" : "";
          addText(`${m.meter_number} - ${m.name || "N/A"}${status}`, 10, true, 3);
          addText(`${m.totalKwh.toFixed(2)} kWh (${m.readingsCount} readings)`, 9, false, 6);
        });
        addSpacer(3);
      }
      addSpacer(8);

      // Section 5: Billing Validation (if documents available)
      if (reportData.sections.billingValidation) {
        addSectionHeading("5. BILLING VALIDATION", 16);
        addText(reportData.sections.billingValidation);
        addSpacer(8);
      }

      // Section 6: Observations and Anomalies
      const obsSection = reportData.sections.billingValidation ? "6" : "5";
      addSectionHeading(`${obsSection}. OBSERVATIONS AND ANOMALIES`, 16);
      addText(reportData.sections.observations);
      addSpacer(5);
      
      if (anomalies.length > 0) {
        addSubsectionHeading(`${obsSection}.6 Detected Anomalies`);
        
        // Group by severity
        const criticalAnomalies = anomalies.filter(a => a.severity === "CRITICAL");
        const highAnomalies = anomalies.filter(a => a.severity === "HIGH");
        const mediumAnomalies = anomalies.filter(a => a.severity === "MEDIUM");
        const lowAnomalies = anomalies.filter(a => a.severity === "LOW");
        
        let anomalyIndex = 1;
        
        if (criticalAnomalies.length > 0) {
          addText("Critical Issues:", 10, true);
          criticalAnomalies.forEach(anomaly => {
            addText(`${anomalyIndex}. [CRITICAL] ${anomaly.description}`, 9, false, 3);
            if (anomaly.meter) addText(`   Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 8, false, 6);
            anomalyIndex++;
          });
          addSpacer(3);
        }
        
        if (highAnomalies.length > 0) {
          addText("High Priority Issues:", 10, true);
          highAnomalies.forEach(anomaly => {
            addText(`${anomalyIndex}. [HIGH] ${anomaly.description}`, 9, false, 3);
            if (anomaly.meter) addText(`   Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 8, false, 6);
            anomalyIndex++;
          });
          addSpacer(3);
        }
        
        if (mediumAnomalies.length > 0) {
          addText("Medium Priority Issues:", 10, true);
          mediumAnomalies.forEach(anomaly => {
            addText(`${anomalyIndex}. [MEDIUM] ${anomaly.description}`, 9, false, 3);
            if (anomaly.meter) addText(`   Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 8, false, 6);
            anomalyIndex++;
          });
          addSpacer(3);
        }
        
        if (lowAnomalies.length > 0) {
          addText("Low Priority Issues:", 10, true);
          lowAnomalies.forEach(anomaly => {
            addText(`${anomalyIndex}. [LOW] ${anomaly.description}`, 9, false, 3);
            if (anomaly.meter) addText(`   Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 8, false, 6);
            anomalyIndex++;
          });
        }
      }
      addSpacer(8);

      // Section 7: Recommendations
      const recSection = reportData.sections.billingValidation ? "7" : "6";
      addSectionHeading(`${recSection}. RECOMMENDATIONS`, 16);
      addText(reportData.sections.recommendations);
      addSpacer(8);

      // Section 8: Appendices
      pdf.addPage();
      yPos = margin;
      const appSection = reportData.sections.billingValidation ? "8" : "7";
      addSectionHeading(`${appSection}. APPENDICES`, 16);
      
      addSubsectionHeading(`Appendix A: Complete Meter Hierarchy`);
      addSpacer(2);
      
      // Group meters by type for appendix
      const metersByType = {
        council_bulk: meterHierarchy.filter(m => m.type === "council_bulk"),
        solar: meterHierarchy.filter(m => m.type === "solar"),
        check_meter: meterHierarchy.filter(m => m.type === "check_meter"),
        distribution: meterHierarchy.filter(m => m.type === "distribution")
      };
      
      if (metersByType.council_bulk.length > 0) {
        addText("Council Bulk Supply Meters", 10, true);
        metersByType.council_bulk.forEach(meter => {
          addText(`${meter.meterNumber} - ${meter.name || "N/A"}`, 9, true, 3);
          addText(`Type: ${meter.type} | Location: ${meter.location || "N/A"}`, 8, false, 6);
          addText(`Consumption: ${meter.consumption} kWh | Readings: ${meter.readingsCount}`, 8, false, 6);
          if (meter.childMeters.length > 0) {
            addText(`Supplies: ${meter.childMeters.join(", ")}`, 8, false, 6);
          }
          addSpacer(2);
        });
      }
      
      if (metersByType.solar.length > 0) {
        addText("Solar/Generation Meters", 10, true);
        metersByType.solar.forEach(meter => {
          addText(`${meter.meterNumber} - ${meter.name || "N/A"}`, 9, true, 3);
          addText(`Type: ${meter.type} | Location: ${meter.location || "N/A"}`, 8, false, 6);
          addText(`Generation: ${meter.consumption} kWh | Readings: ${meter.readingsCount}`, 8, false, 6);
          addSpacer(2);
        });
      }
      
      if (metersByType.check_meter.length > 0) {
        addText("Check Meters", 10, true);
        metersByType.check_meter.forEach(meter => {
          const status = meter.readingsCount === 0 ? " [INACTIVE]" : "";
          addText(`${meter.meterNumber} - ${meter.name || "N/A"}${status}`, 9, true, 3);
          addText(`Type: ${meter.type} | Location: ${meter.location || "N/A"}`, 8, false, 6);
          addText(`Consumption: ${meter.consumption} kWh | Readings: ${meter.readingsCount}`, 8, false, 6);
          if (meter.parentMeters.length > 0) {
            addText(`Fed by: ${meter.parentMeters.join(", ")}`, 8, false, 6);
          }
          addSpacer(2);
        });
      }
      
      if (metersByType.distribution.length > 0) {
        addText("Distribution Meters", 10, true);
        metersByType.distribution.forEach(meter => {
          addText(`${meter.meterNumber} - ${meter.name || meter.location || "N/A"}`, 9, true, 3);
          addText(`Type: ${meter.type} | Location: ${meter.location || "N/A"}`, 8, false, 6);
          addText(`Consumption: ${meter.consumption} kWh | Readings: ${meter.readingsCount}`, 8, false, 6);
          if (meter.parentMeters.length > 0) {
            addText(`Fed by: ${meter.parentMeters.join(", ")}`, 8, false, 6);
          }
          addSpacer(2);
        });
      }

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
                  {periodStart ? `${format(periodStart, "dd MMM yyyy")} ${startTime}` : "Select start date"}
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
                  showTime={true}
                  onTimeChange={setStartTime}
                  defaultTime={startTime}
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
                  {periodEnd ? `${format(periodEnd, "dd MMM yyyy")} ${endTime}` : "Select end date"}
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
                  showTime={true}
                  onTimeChange={setEndTime}
                  defaultTime={endTime}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Pane: Meter Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base">Select Meters to Include</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedMeterIds(new Set(availableMeters.map(m => m.id)))}
                  disabled={isLoadingMeters}
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedMeterIds(new Set())}
                  disabled={isLoadingMeters}
                >
                  Deselect All
                </Button>
              </div>
            </div>

            {isLoadingMeters ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="h-[400px] border rounded-lg p-4">
                <div className="space-y-4">
                  {["council_bulk", "solar", "distribution", "check_meter"].map((meterType) => {
                    const metersOfType = availableMeters.filter(m => m.meter_type === meterType);
                    if (metersOfType.length === 0) return null;

                    const typeLabel = {
                      council_bulk: "Council Bulk Supply",
                      solar: "Solar/Generation",
                      distribution: "Distribution",
                      check_meter: "Check Meters"
                    }[meterType];

                    return (
                      <div key={meterType} className="space-y-2">
                        <h4 className="text-sm font-semibold text-muted-foreground">{typeLabel}</h4>
                        <div className="space-y-2 pl-2">
                          {metersOfType.map((meter) => (
                            <div key={meter.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={meter.id}
                                checked={selectedMeterIds.has(meter.id)}
                                onCheckedChange={(checked) => {
                                  const newSet = new Set(selectedMeterIds);
                                  if (checked) {
                                    newSet.add(meter.id);
                                  } else {
                                    newSet.delete(meter.id);
                                  }
                                  setSelectedMeterIds(newSet);
                                }}
                              />
                              <label
                                htmlFor={meter.id}
                                className="text-sm cursor-pointer flex-1"
                              >
                                <span className="font-medium">{meter.meter_number}</span>
                                {meter.name && <span className="text-muted-foreground"> - {meter.name}</span>}
                                {meter.location && <span className="text-xs text-muted-foreground ml-2">({meter.location})</span>}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}

            <p className="text-xs text-muted-foreground">
              {selectedMeterIds.size} of {availableMeters.length} meters selected
            </p>
          </div>

          {/* Right Pane: CSV Column Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base">Available CSV Columns</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const updated = { ...columnConfigs };
                    Object.keys(updated).forEach(key => {
                      updated[key] = { ...updated[key], selected: true };
                    });
                    setColumnConfigs(updated);
                  }}
                  disabled={isLoadingColumns || availableColumns.length === 0}
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const updated = { ...columnConfigs };
                    Object.keys(updated).forEach(key => {
                      updated[key] = { ...updated[key], selected: false };
                    });
                    setColumnConfigs(updated);
                  }}
                  disabled={isLoadingColumns || availableColumns.length === 0}
                >
                  Deselect All
                </Button>
              </div>
            </div>

            {isLoadingColumns ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableColumns.length === 0 ? (
              <div className="h-[400px] border rounded-lg p-4 flex items-center justify-center">
                <p className="text-sm text-muted-foreground text-center">
                  {selectedMeterIds.size === 0 
                    ? "Select meters to view available CSV columns"
                    : "No CSV data found for selected meters"}
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[400px] border rounded-lg p-4">
                <div className="space-y-3">
                  {availableColumns.map((column) => {
                    const config = columnConfigs[column];
                    if (!config) return null;

                    return (
                      <div key={column} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
                        <Checkbox
                          id={`col-${column}`}
                          checked={config.selected}
                          onCheckedChange={(checked) => {
                            setColumnConfigs({
                              ...columnConfigs,
                              [column]: { ...config, selected: checked as boolean }
                            });
                          }}
                        />
                        <label
                          htmlFor={`col-${column}`}
                          className="text-sm font-medium flex-1 cursor-pointer"
                        >
                          {column}
                        </label>
                        <select
                          value={config.aggregation}
                          onChange={(e) => {
                            setColumnConfigs({
                              ...columnConfigs,
                              [column]: { ...config, aggregation: e.target.value as 'sum' | 'max' }
                            });
                          }}
                          className="text-xs border rounded px-2 py-1 bg-background"
                          disabled={!config.selected}
                        >
                          <option value="sum">Sum</option>
                          <option value="max">Max</option>
                        </select>
                        <input
                          type="number"
                          value={config.multiplier}
                          onChange={(e) => {
                            setColumnConfigs({
                              ...columnConfigs,
                              [column]: { ...config, multiplier: parseFloat(e.target.value) || 1 }
                            });
                          }}
                          className="text-xs border rounded px-2 py-1 w-16 bg-background"
                          step="0.1"
                          min="0"
                          disabled={!config.selected}
                        />
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}

            <p className="text-xs text-muted-foreground">
              {Object.values(columnConfigs).filter(c => c.selected).length} of {availableColumns.length} columns selected
            </p>
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
          disabled={isGenerating || !periodStart || !periodEnd || selectedMeterIds.size === 0 || isLoadingMeters}
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

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Loader2, Download, CalendarIcon, Eye } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

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

interface PreviewData {
  siteName: string;
  periodStart: Date;
  periodEnd: Date;
  meterData: any[];
  meterHierarchy: any[];
  meterBreakdown: any[];
  reconciliationData: any;
  documentExtractions: any[];
  anomalies: any[];
  selectedCsvColumns: any[];
  reportData: any;
}

export default function SiteReportExport({ siteId, siteName }: SiteReportExportProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
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
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

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

  const generatePreview = async () => {
    if (!periodStart || !periodEnd) {
      toast.error("Please select both start and end dates");
      return;
    }

    setIsGeneratingPreview(true);

    try {
      toast.info("Running reconciliation for selected period...");

      // 1. Fetch all meters for this site (only selected ones)
      if (selectedMeterIds.size === 0) {
        toast.error("Please select at least one meter");
        setIsGeneratingPreview(false);
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

      // 7. Fetch schematic for the site
      const { data: schematics, error: schematicsError } = await supabase
        .from("schematics")
        .select("id, name, file_path, converted_image_path")
        .eq("site_id", siteId)
        .limit(1);

      if (schematicsError) {
        console.error("Error fetching schematic:", schematicsError);
      }

      const schematicData = schematics && schematics.length > 0 ? schematics[0] : null;
      let schematicImageBase64 = null;

      if (schematicData?.converted_image_path) {
        try {
          const { data: imageData } = await supabase.storage
            .from("schematics")
            .download(schematicData.converted_image_path);
          
          if (imageData) {
            const arrayBuffer = await imageData.arrayBuffer();
            const base64 = btoa(
              new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            schematicImageBase64 = `data:image/png;base64,${base64}`;
          }
        } catch (err) {
          console.error("Error loading schematic image:", err);
        }
      }

      // 8. Calculate site-wide CSV column aggregations
      const csvColumnAggregations: Record<string, { value: number; aggregation: string; multiplier: number }> = {};
      
      Object.entries(columnConfigs)
        .filter(([_, config]) => config.selected)
        .forEach(([columnName, config]) => {
          if (config.aggregation === 'sum') {
            const total = meterData.reduce((sum, meter) => {
              return sum + (meter.columnTotals[columnName] || 0);
            }, 0);
            csvColumnAggregations[columnName] = {
              value: total * config.multiplier,
              aggregation: 'sum',
              multiplier: config.multiplier
            };
          } else if (config.aggregation === 'max') {
            const maxValue = Math.max(...meterData.map(meter => meter.columnMaxValues[columnName] || 0));
            csvColumnAggregations[columnName] = {
              value: maxValue * config.multiplier,
              aggregation: 'max',
              multiplier: config.multiplier
            };
          }
        });

      // 9. Prepare detailed meter breakdown with sorting
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

      // 9. Prepare meter hierarchy with CSV column data
      const meterHierarchy = meters?.map(meter => {
        const meterInfo = meterData.find(m => m.id === meter.id);
        return {
          meterNumber: meter.meter_number,
          name: meter.name,
          type: meter.meter_type,
          location: meter.location,
          consumption: meterInfo?.totalKwh.toFixed(2) || "0.00",
          readingsCount: meterInfo?.readingsCount || 0,
          columnTotals: meterInfo?.columnTotals || {},
          columnMaxValues: meterInfo?.columnMaxValues || {},
          parentMeters: meter.parent_connections?.map((pc: any) => 
            pc.parent_meter?.meter_number
          ) || [],
          childMeters: meter.child_connections?.map((cc: any) => 
            cc.child_meter?.meter_number
          ) || []
        };
      }) || [];

      // Prepare selected CSV columns configuration
      const selectedCsvColumns = Object.entries(columnConfigs)
        .filter(([_, config]) => config.selected)
        .map(([columnName, config]) => ({
          columnName,
          aggregation: config.aggregation,
          multiplier: config.multiplier
        }));

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
            anomalies,
            selectedCsvColumns
          }
        }
      );

      if (aiError) throw aiError;

      // Store preview data with schematic and CSV aggregations
      setPreviewData({
        siteName,
        periodStart,
        periodEnd,
        meterData,
        meterHierarchy,
        meterBreakdown,
        reconciliationData,
        documentExtractions,
        anomalies,
        selectedCsvColumns,
        reportData,
        schematicImageBase64,
        csvColumnAggregations
      } as any);
      
      setCurrentPage(1); // Reset to first page

      toast.success("Preview generated successfully!");

    } catch (error) {
      console.error("Error generating preview:", error);
      toast.error("Failed to generate preview");
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  const generateReport = async () => {
    if (!previewData) {
      toast.error("Please generate a preview first");
      return;
    }

    setIsGenerating(true);

    try {
      // Extract data from preview
      const {
        siteName: previewSiteName,
        periodStart: previewPeriodStart,
        periodEnd: previewPeriodEnd,
        meterData,
        meterHierarchy,
        meterBreakdown,
        reconciliationData,
        documentExtractions,
        anomalies,
        reportData,
        schematicImageBase64,
        csvColumnAggregations
      } = previewData as any;

      // Categorize meters by type for PDF generation
      const councilBulk = meterData.filter((m: any) => m.meter_type === "council_bulk");
      const solarMeters = meterData.filter((m: any) => m.meter_type === "solar");
      const distribution = meterData.filter((m: any) => m.meter_type === "distribution");
      const checkMeters = meterData.filter((m: any) => m.meter_type === "check_meter");

      // 11. Generate PDF with enhanced formatting
      toast.info("Generating PDF...");
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      let yPos = margin;
      let pageNumber = 1;
      const sectionPages: { title: string; page: number }[] = [];
      const indexTerms: { term: string; page: number }[] = [];

      // Helper function to add page number
      const addPageNumber = () => {
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Page ${pageNumber}`, pageWidth - margin, pageHeight - 10, { align: "right" });
        pageNumber++;
      };

      // Helper function to clean markdown formatting
      const cleanMarkdown = (text: string): string => {
        if (!text) return '';
        return text
          .replace(/^##\s+.+$/gm, '') // Remove ## headers
          .replace(/\*\*(.*?)\*\*/g, '$1') // Remove ** bold
          .replace(/^\d+\.\d+\s+/gm, '') // Remove numbered subsections like 3.1, 4.2
          .trim();
      };

      // Helper function to add text with wrapping
      const addText = (text: string, fontSize: number = 10, isBold: boolean = false, indent: number = 0) => {
        const cleanedText = cleanMarkdown(text);
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", isBold ? "bold" : "normal");
        const maxWidth = pageWidth - 2 * margin - indent;
        const lines = pdf.splitTextToSize(cleanedText, maxWidth);
        
        lines.forEach((line: string) => {
          if (yPos > pageHeight - margin - 15) {
            addPageNumber();
            pdf.addPage();
            yPos = margin;
          }
          pdf.text(line, margin + indent, yPos);
          yPos += fontSize * 0.5;
        });
        yPos += 3;
      };

      // Helper function to add bullet point
      const addBullet = (text: string, level: number = 0) => {
        const indent = 5 + (level * 5);
        const bullet = level === 0 ? "•" : "◦";
        
        if (yPos > pageHeight - margin - 15) {
          addPageNumber();
          pdf.addPage();
          yPos = margin;
        }
        
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text(bullet, margin + indent, yPos);
        
        const maxWidth = pageWidth - 2 * margin - indent - 5;
        const lines = pdf.splitTextToSize(text, maxWidth);
        lines.forEach((line: string, index: number) => {
          if (index > 0 && yPos > pageHeight - margin - 15) {
            addPageNumber();
            pdf.addPage();
            yPos = margin;
          }
          pdf.text(line, margin + indent + 5, yPos);
          yPos += 5;
        });
        yPos += 2;
      };

      // Helper function to add table
      const addTable = (headers: string[], rows: string[][], columnWidths?: number[]) => {
        const tableWidth = pageWidth - 2 * margin;
        const defaultColWidth = tableWidth / headers.length;
        const colWidths = columnWidths || headers.map(() => defaultColWidth);
        
        // Check if we need a new page
        if (yPos > pageHeight - margin - 40) {
          addPageNumber();
          pdf.addPage();
          yPos = margin;
        }
        
        // Draw header with brand color
        pdf.setFillColor(41, 128, 185); // Consistent brand color
        pdf.rect(margin, yPos - 5, tableWidth, 10, "F");
        
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(255, 255, 255); // White text on blue header
        let xPos = margin + 2;
        headers.forEach((header, i) => {
          pdf.text(header, xPos, yPos);
          xPos += colWidths[i];
        });
        pdf.setTextColor(0, 0, 0); // Reset to black
        yPos += 7;
        
        // Draw border around header
        pdf.setDrawColor(41, 128, 185);
        pdf.setLineWidth(0.5);
        pdf.rect(margin, yPos - 12, tableWidth, 10);
        
        // Draw rows
        pdf.setFont("helvetica", "normal");
        rows.forEach((row) => {
          if (yPos > pageHeight - margin - 15) {
            addPageNumber();
            pdf.addPage();
            yPos = margin + 15;
          }
          
          xPos = margin + 2;
          row.forEach((cell, i) => {
            const cellLines = pdf.splitTextToSize(cell, colWidths[i] - 4);
            pdf.text(cellLines[0] || "", xPos, yPos);
            xPos += colWidths[i];
          });
          
          // Draw row border
          pdf.setDrawColor(220, 220, 220);
          pdf.rect(margin, yPos - 5, tableWidth, 8);
          
          yPos += 8;
        });
        
        yPos += 5;
      };

      const addSectionHeading = (text: string, fontSize: number = 14, forceNewPage: boolean = false) => {
        // Force new page for major sections
        if (forceNewPage) {
          addPageNumber();
          pdf.addPage();
          yPos = margin;
        }
        
        yPos += 8;
        
        // Track section page for TOC
        sectionPages.push({ title: text, page: pageNumber });
        
        // Add to index
        const cleanTitle = text.replace(/^\d+\.\s*/, ''); // Remove numbering
        indexTerms.push({ term: cleanTitle, page: pageNumber });
        
        // Consistent brand color scheme - professional blue
        pdf.setFillColor(41, 128, 185);
        pdf.rect(margin - 2, yPos - 5, pageWidth - 2 * margin + 4, fontSize + 2, "F");
        
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", "bold");
        pdf.text(text, margin + 2, yPos + 3);
        pdf.setTextColor(0, 0, 0);
        yPos += fontSize + 5;
      };

      const addSubsectionHeading = (text: string) => {
        yPos += 5;
        if (yPos > pageHeight - margin - 20) {
          addPageNumber();
          pdf.addPage();
          yPos = margin;
        }
        
        // Add subsection to index
        indexTerms.push({ term: text, page: pageNumber });
        
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(41, 128, 185); // Consistent brand color
        pdf.text(text, margin, yPos);
        pdf.setTextColor(0, 0, 0);
        yPos += 8;
      };

      const addSpacer = (height: number = 5) => {
        yPos += height;
      };

      // COVER PAGE with professional design
      pdf.setFillColor(41, 128, 185); // Professional blue
      pdf.rect(0, 0, pageWidth, 100, "F");
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(32);
      pdf.setFont("helvetica", "bold");
      pdf.text("METERING AUDIT REPORT", pageWidth / 2, 50, { align: "center" });
      
      pdf.setTextColor(0, 0, 0);
      pdf.setFillColor(245, 245, 245);
      pdf.rect(margin, 120, pageWidth - 2 * margin, 60, "F");
      pdf.setDrawColor(200, 200, 200);
      pdf.rect(margin, 120, pageWidth - 2 * margin, 60);
      
      pdf.setFontSize(20);
      pdf.setFont("helvetica", "bold");
      pdf.text(previewSiteName, pageWidth / 2, 140, { align: "center" });
      
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.text("Audit Period", pageWidth / 2, 155, { align: "center" });
      pdf.setFont("helvetica", "bold");
      pdf.text(
        `${format(previewPeriodStart, "dd MMMM yyyy")} - ${format(previewPeriodEnd, "dd MMMM yyyy")}`,
        pageWidth / 2,
        165,
        { align: "center" }
      );

      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Report Generated: ${format(new Date(), "dd MMMM yyyy 'at' HH:mm")}`, pageWidth / 2, 220, { align: "center" });
      pdf.text(`Document ID: AUD-${format(new Date(), "yyyyMMdd-HHmmss")}`, pageWidth / 2, 228, { align: "center" });
      
      // Footer on cover
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text("Confidential - For Internal Use Only", pageWidth / 2, pageHeight - 15, { align: "center" });

      // TABLE OF CONTENTS PAGE - Placeholder
      // We'll come back and fill this in after we know all page numbers
      const tocPageIndex = pdf.internal.pages.length;
      pdf.addPage();
      const tocYStart = margin;

      // Start main content
      pdf.addPage();
      yPos = margin;

      // Section 1: Executive Summary
      addSectionHeading("1. EXECUTIVE SUMMARY", 16, false);
      addText(reportData.sections.executiveSummary);
      addSpacer(8);

      // Section 2: Metering Hierarchy Overview
      addSectionHeading("2. METERING HIERARCHY OVERVIEW", 16, true);
      addText(reportData.sections.hierarchyOverview);
      addSpacer(5);
      
      // Add schematic if available
      if (schematicImageBase64) {
        if (yPos > pageHeight - 150) {
          addPageNumber();
          pdf.addPage();
          yPos = margin;
        }
        
        try {
          const imgWidth = pageWidth - 2 * margin;
          const imgHeight = 120; // Fixed height for schematic
          pdf.addImage(schematicImageBase64, 'PNG', margin, yPos, imgWidth, imgHeight);
          yPos += imgHeight + 5;
          
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "italic");
          pdf.text("Figure 1: Site Metering Schematic Diagram", pageWidth / 2, yPos, { align: "center" });
          pdf.setFont("helvetica", "normal");
          yPos += 10;
        } catch (err) {
          console.error("Error adding schematic to PDF:", err);
        }
      }
      addSpacer(8);

      // Section 3: Data Sources and Audit Period
      addSectionHeading("3. DATA SOURCES AND AUDIT PERIOD", 16);
      addSubsectionHeading("Audit Period");
      addText(`${format(previewPeriodStart, "dd MMMM yyyy")} to ${format(previewPeriodEnd, "dd MMMM yyyy")}`);
      addSpacer(5);
      
      addSubsectionHeading("Council Bulk Supply Meters");
      addText(reconciliationData.councilBulkMeters);
      addSpacer(5);
      
      addSubsectionHeading("Metering Infrastructure");
      addText(`Total Meters Analyzed: ${reconciliationData.meterCount}`);
      addBullet(`Council Bulk Meters: ${reconciliationData.councilBulkCount}`);
      if (reconciliationData.solarCount > 0) {
        addBullet(`Solar/Generation Meters: ${reconciliationData.solarCount}`);
      }
      addBullet(`Distribution Meters: ${reconciliationData.distributionCount}`);
      addBullet(`Check Meters: ${reconciliationData.checkMeterCount}`);
      addSpacer(5);
      
      addSubsectionHeading("Documents Analyzed");
      addText(`${reconciliationData.documentsAnalyzed} billing documents processed and validated`);
      addSpacer(8);

      // Section 4: Key Metrics
      addSectionHeading("4. KEY METRICS", 16, true);
      
      addSubsectionHeading("4.1 Basic Reconciliation Metrics");
      
      const basicMetricsRows = [
        ["Total Supply", `${reconciliationData.totalSupply} kWh`],
        ["Distribution Total", `${reconciliationData.distributionTotal} kWh`],
        ["Recovery Rate", `${reconciliationData.recoveryRate}%`],
        ["Variance", `${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variance} kWh (${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variancePercentage}%)`]
      ];
      
      addTable(["Metric", "Value"], basicMetricsRows, [100, 70]);
      addSpacer(8);
      
      // Add CSV Column Aggregations if available
      if (csvColumnAggregations && Object.keys(csvColumnAggregations).length > 0) {
        addSubsectionHeading("4.2 CSV Column Aggregations");
        addText("Site-wide aggregated values for selected CSV columns:");
        addSpacer(3);
        
        const csvMetricsRows = Object.entries(csvColumnAggregations).map(([columnName, data]: [string, any]) => [
          columnName,
          data.value.toFixed(2),
          data.aggregation === 'sum' ? 'kWh' : 'kVA',
          data.aggregation.toUpperCase(),
          data.multiplier !== 1 ? `×${data.multiplier}` : '-'
        ]);
        
        addTable(
          ["Column", "Value", "Unit", "Aggregation", "Multiplier"],
          csvMetricsRows,
          [50, 35, 25, 30, 30]
        );
        addSpacer(8);
      }

      // Section 5: Metering Reconciliation
      addSectionHeading("5. METERING RECONCILIATION", 16, true);
      
      addSubsectionHeading("5.1 Supply Summary");
      
      // Create supply table
      const supplyRows = [
        ["Council Bulk Supply", `${reconciliationData.councilTotal} kWh`]
      ];
      if (parseFloat(reconciliationData.solarTotal) > 0) {
        supplyRows.push(["Solar Generation", `${reconciliationData.solarTotal} kWh`]);
      }
      supplyRows.push(["Total Supply", `${reconciliationData.totalSupply} kWh`]);
      
      addTable(["Supply Source", "Energy (kWh)"], supplyRows, [120, 50]);
      addSpacer(5);
      
      addSubsectionHeading("5.2 Distribution Summary");
      
      // Create distribution table
      const distributionRows = [
        ["Total Distribution Consumption", `${reconciliationData.distributionTotal} kWh`],
        ["Recovery Rate", `${reconciliationData.recoveryRate}%`],
        ["Discrepancy", `${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variance} kWh (${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variancePercentage}%)`]
      ];
      
      addTable(["Metric", "Value"], distributionRows, [120, 50]);
      addSpacer(5);

      addSubsectionHeading("5.3 Individual Meter Consumption");
      addSpacer(2);
      
      // Create meter consumption table by category
      if (councilBulk.length > 0) {
        addText("Council Bulk Meters", 10, true);
        const bulkRows = councilBulk.map(m => [
          m.meter_number,
          m.name || "N/A",
          `${m.totalKwh.toFixed(2)} kWh`,
          `${m.readingsCount} readings`
        ]);
        addTable(["Meter Number", "Name", "Consumption", "Readings"], bulkRows, [40, 50, 40, 40]);
        addSpacer(3);
      }
      
      if (solarMeters.length > 0) {
        addText("Solar Generation Meters", 10, true);
        const solarRows = solarMeters.map(m => [
          m.meter_number,
          m.name || "N/A",
          `${m.totalKwh.toFixed(2)} kWh`,
          `${m.readingsCount} readings`
        ]);
        addTable(["Meter Number", "Name", "Generation", "Readings"], solarRows, [40, 50, 40, 40]);
        addSpacer(3);
      }
      
      if (distribution.length > 0) {
        addText("Distribution Meters", 10, true);
        const distRows = distribution.map(m => [
          m.meter_number,
          m.name || m.location || "N/A",
          `${m.totalKwh.toFixed(2)} kWh`,
          `${m.readingsCount} readings`
        ]);
        addTable(["Meter Number", "Name/Location", "Consumption", "Readings"], distRows, [40, 50, 40, 40]);
        addSpacer(3);
      }
      
      if (checkMeters.length > 0) {
        addText("Check Meters", 10, true);
        const checkRows = checkMeters.map(m => [
          m.meter_number,
          m.name || "N/A",
          `${m.totalKwh.toFixed(2)} kWh`,
          m.readingsCount === 0 ? "INACTIVE" : `${m.readingsCount} readings`
        ]);
        addTable(["Meter Number", "Name", "Consumption", "Status"], checkRows, [40, 50, 40, 40]);
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
        addSubsectionHeading(`${obsSection}.6 Detected Anomalies Summary`);
        addSpacer(2);
        
        // Create anomaly summary table
        const anomalySummaryRows = anomalies.map((anomaly, idx) => [
          `${idx + 1}`,
          anomaly.severity,
          anomaly.meter || "General",
          anomaly.description.substring(0, 80) + (anomaly.description.length > 80 ? "..." : "")
        ]);
        
        addTable(["#", "Severity", "Meter", "Description"], anomalySummaryRows, [10, 25, 35, 100]);
        addSpacer(5);
        
        // Detailed anomaly breakdown by severity
        addSubsectionHeading("Detailed Anomaly Breakdown");
        
        const criticalAnomalies = anomalies.filter(a => a.severity === "CRITICAL");
        const highAnomalies = anomalies.filter(a => a.severity === "HIGH");
        const mediumAnomalies = anomalies.filter(a => a.severity === "MEDIUM");
        const lowAnomalies = anomalies.filter(a => a.severity === "LOW");
        
        let anomalyIndex = 1;
        
        if (criticalAnomalies.length > 0) {
          addText("CRITICAL ISSUES", 11, true);
          criticalAnomalies.forEach(anomaly => {
            addBullet(`[${anomalyIndex}] ${anomaly.description}`);
            if (anomaly.meter) addBullet(`Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 1);
            anomalyIndex++;
          });
          addSpacer(3);
        }
        
        if (highAnomalies.length > 0) {
          addText("HIGH PRIORITY ISSUES", 11, true);
          highAnomalies.forEach(anomaly => {
            addBullet(`[${anomalyIndex}] ${anomaly.description}`);
            if (anomaly.meter) addBullet(`Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 1);
            anomalyIndex++;
          });
          addSpacer(3);
        }
        
        if (mediumAnomalies.length > 0) {
          addText("MEDIUM PRIORITY ISSUES", 11, true);
          mediumAnomalies.forEach(anomaly => {
            addBullet(`[${anomalyIndex}] ${anomaly.description}`);
            if (anomaly.meter) addBullet(`Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 1);
            anomalyIndex++;
          });
          addSpacer(3);
        }
        
        if (lowAnomalies.length > 0) {
          addText("LOW PRIORITY ISSUES", 11, true);
          lowAnomalies.forEach(anomaly => {
            addBullet(`[${anomalyIndex}] ${anomaly.description}`);
            if (anomaly.meter) addBullet(`Meter: ${anomaly.meter} (${anomaly.name || "N/A"})`, 1);
            anomalyIndex++;
          });
          addSpacer(3);
        }
      }
      addSpacer(8);

      // Section 8: Recommendations
      const recSection = reportData.sections.billingValidation ? "8" : "7";
      addSectionHeading(`${recSection}. RECOMMENDATIONS`, 16, true);
      addText(reportData.sections.recommendations);
      addSpacer(8);

      // Section 9: Appendices
      const appSection = reportData.sections.billingValidation ? "9" : "8";
      addSectionHeading(`${appSection}. APPENDICES`, 16, true);
      
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
        const bulkAppendixRows = metersByType.council_bulk.map(meter => [
          meter.meterNumber,
          meter.name || "N/A",
          meter.location || "N/A",
          `${meter.consumption} kWh`,
          meter.childMeters.length > 0 ? meter.childMeters.join(", ") : "None"
        ]);
        addTable(
          ["Meter #", "Name", "Location", "Consumption", "Supplies"],
          bulkAppendixRows,
          [30, 35, 30, 30, 45]
        );
        addSpacer(5);
      }
      
      if (metersByType.solar.length > 0) {
        addText("Solar/Generation Meters", 10, true);
        const solarAppendixRows = metersByType.solar.map(meter => [
          meter.meterNumber,
          meter.name || "N/A",
          meter.location || "N/A",
          `${meter.consumption} kWh`,
          `${meter.readingsCount}`
        ]);
        addTable(
          ["Meter #", "Name", "Location", "Generation", "Readings"],
          solarAppendixRows,
          [30, 35, 30, 30, 45]
        );
        addSpacer(5);
      }
      
      if (metersByType.check_meter.length > 0) {
        addText("Check Meters", 10, true);
        const checkAppendixRows = metersByType.check_meter.map(meter => [
          meter.meterNumber,
          meter.name || "N/A",
          meter.location || "N/A",
          `${meter.consumption} kWh`,
          meter.readingsCount === 0 ? "INACTIVE" : `${meter.readingsCount}`
        ]);
        addTable(
          ["Meter #", "Name", "Location", "Consumption", "Status"],
          checkAppendixRows,
          [30, 35, 30, 30, 45]
        );
        addSpacer(5);
      }
      
      if (metersByType.distribution.length > 0) {
        addText("Distribution Meters", 10, true);
        const distAppendixRows = metersByType.distribution.map(meter => [
          meter.meterNumber,
          meter.name || meter.location || "N/A",
          meter.location || "N/A",
          `${meter.consumption} kWh`,
          meter.parentMeters.length > 0 ? meter.parentMeters.join(", ") : "None"
        ]);
        addTable(
          ["Meter #", "Name", "Location", "Consumption", "Fed By"],
          distAppendixRows,
          [30, 35, 30, 30, 45]
        );
        addSpacer(5);
      }

      // Add Document Index at the end
      addSectionHeading("DOCUMENT INDEX", 16, true);
      addText("This index provides quick reference to key topics, meters, and sections within this audit report.");
      addSpacer(5);
      
      // Group index terms alphabetically
      const uniqueTerms = Array.from(new Set(indexTerms.map(t => t.term)));
      const sortedTerms = uniqueTerms.sort((a, b) => a.localeCompare(b));
      
      // Add meter numbers to index
      meterData.forEach(meter => {
        indexTerms.push({ 
          term: `Meter ${meter.meter_number}`, 
          page: sectionPages.find(s => s.title.includes("RECONCILIATION"))?.page || 4 
        });
      });
      
      // Add anomaly types to index
      const anomalyTypes = [...new Set(anomalies.map((a: any) => a.type))];
      anomalyTypes.forEach((type: any) => {
        const displayType = String(type).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        indexTerms.push({ 
          term: displayType, 
          page: sectionPages.find(s => s.title.includes("ANOMALIES"))?.page || 5 
        });
      });
      
      // Sort all index terms
      const allIndexTerms = indexTerms.sort((a, b) => a.term.localeCompare(b.term));
      
      // Create index table
      const indexRows: string[][] = [];
      let currentLetter = '';
      
      allIndexTerms.forEach(item => {
        const firstLetter = item.term.charAt(0).toUpperCase();
        if (firstLetter !== currentLetter) {
          currentLetter = firstLetter;
          // Add letter divider
          indexRows.push([`--- ${currentLetter} ---`, '']);
        }
        indexRows.push([item.term, item.page.toString()]);
      });
      
      addTable(["Topic", "Page"], indexRows, [140, 30]);
      
      // Now go back and fill in the TOC with actual page numbers
      pdf.setPage(tocPageIndex);
      yPos = tocYStart;
      
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(20);
      pdf.setFont("helvetica", "bold");
      pdf.text("TABLE OF CONTENTS", margin, yPos);
      yPos += 15;
      
      pdf.setDrawColor(41, 128, 185);
      pdf.setLineWidth(0.5);
      pdf.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 10;
      
      pdf.setFontSize(11);
      sectionPages.forEach((section, idx) => {
        if (yPos > pageHeight - margin - 15) {
          pdf.addPage();
          yPos = margin + 20;
        }
        
        pdf.setFont("helvetica", idx === 0 || section.title.match(/^\d+\./) ? "bold" : "normal");
        const indent = section.title.match(/^\d+\.\d+/) ? 10 : 0;
        
        pdf.text(section.title, margin + 5 + indent, yPos);
        pdf.text(`${section.page}`, pageWidth - margin - 10, yPos, { align: "right" });
        
        // Dotted line
        const titleWidth = pdf.getTextWidth(section.title);
        const pageNumWidth = pdf.getTextWidth(`${section.page}`);
        const dotSpace = pageWidth - 2 * margin - titleWidth - pageNumWidth - 20 - indent;
        const numDots = Math.floor(dotSpace / 2);
        
        pdf.setFontSize(8);
        const dots = ".".repeat(Math.max(0, numDots));
        pdf.text(dots, margin + 5 + indent + titleWidth + 3, yPos);
        
        yPos += 8;
        pdf.setFontSize(11);
      });
      
      // Add index reference to TOC
      yPos += 5;
      pdf.setFont("helvetica", "bold");
      pdf.text("Document Index", margin + 5, yPos);
      pdf.text(`${pageNumber}`, pageWidth - margin - 10, yPos, { align: "right" });
      
      // Save PDF
      const fileName = `${previewSiteName.replace(/\s+/g, "_")}_Audit_Report_${format(new Date(), "yyyyMMdd")}.pdf`;
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
          onClick={generatePreview}
          disabled={isGeneratingPreview || !periodStart || !periodEnd || selectedMeterIds.size === 0 || isLoadingMeters}
          className="w-full"
          size="lg"
          variant="outline"
        >
          {isGeneratingPreview ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Preview...
            </>
          ) : (
            <>
              <Eye className="w-4 h-4 mr-2" />
              Generate PDF Preview
            </>
          )}
        </Button>

        {previewData && (
          <>
            <Separator className="my-6" />
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Report Preview</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground px-3">
                    Page {currentPage} of {(() => {
                      let totalPages = 1; // Cover page
                      totalPages += 1; // Executive Summary
                      totalPages += 1; // Metering Hierarchy
                      if ((previewData as any).schematicImageBase64) totalPages += 1; // Schematic
                      totalPages += 1; // Key Metrics
                      totalPages += 1; // Observations
                      totalPages += 1; // Recommendations
                      if (previewData.reportData.sections.billingValidation) totalPages += 1;
                      return totalPages;
                    })()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const maxPages = (() => {
                        let totalPages = 1;
                        totalPages += 1;
                        totalPages += 1;
                        if ((previewData as any).schematicImageBase64) totalPages += 1;
                        totalPages += 1;
                        totalPages += 1;
                        totalPages += 1;
                        if (previewData.reportData.sections.billingValidation) totalPages += 1;
                        return totalPages;
                      })();
                      setCurrentPage(Math.min(maxPages, currentPage + 1));
                    }}
                    disabled={currentPage >= (() => {
                      let totalPages = 1;
                      totalPages += 1;
                      totalPages += 1;
                      if ((previewData as any).schematicImageBase64) totalPages += 1;
                      totalPages += 1;
                      totalPages += 1;
                      totalPages += 1;
                      if (previewData.reportData.sections.billingValidation) totalPages += 1;
                      return totalPages;
                    })()}
                  >
                    Next
                  </Button>
                </div>
              </div>

              {/* Page Container with A4-like aspect ratio */}
              <div className="border rounded-lg shadow-lg bg-white overflow-hidden" style={{ aspectRatio: '210/297' }}>
                <div className="h-full w-full p-8 overflow-auto">
                  {/* Page 1: Cover */}
                  {currentPage === 1 && (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                      <div className="w-full bg-primary text-primary-foreground p-8 rounded-lg">
                        <h1 className="text-4xl font-bold mb-2">METERING AUDIT REPORT</h1>
                      </div>
                      <div className="space-y-4 p-8 border rounded-lg bg-muted/30 w-full">
                        <h2 className="text-3xl font-bold">{previewData.siteName}</h2>
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">Audit Period</p>
                          <p className="text-xl font-semibold">
                            {format(previewData.periodStart, "dd MMMM yyyy")} - {format(previewData.periodEnd, "dd MMMM yyyy")}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Report Generated: {format(new Date(), "dd MMMM yyyy 'at' HH:mm")}
                      </p>
                    </div>
                  )}

                  {/* Page 2: Executive Summary */}
                  {currentPage === 2 && (
                    <div className="space-y-4">
                      <div className="bg-primary text-primary-foreground p-4 rounded">
                        <h3 className="text-2xl font-bold">1. EXECUTIVE SUMMARY</h3>
                      </div>
                      <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap">
                        {previewData.reportData.sections.executiveSummary}
                      </div>
                    </div>
                  )}

                  {/* Page 3: Metering Hierarchy */}
                  {currentPage === 3 && (
                    <div className="space-y-4">
                      <div className="bg-primary text-primary-foreground p-4 rounded">
                        <h3 className="text-2xl font-bold">2. METERING HIERARCHY OVERVIEW</h3>
                      </div>
                      <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap">
                        {previewData.reportData.sections.hierarchyOverview}
                      </div>
                    </div>
                  )}

                  {/* Page 4: Schematic (if available) */}
                  {(previewData as any).schematicImageBase64 && currentPage === 4 && (
                    <div className="space-y-4">
                      <div className="bg-primary text-primary-foreground p-4 rounded">
                        <h3 className="text-2xl font-bold">SITE SCHEMATIC DIAGRAM</h3>
                      </div>
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <img 
                          src={(previewData as any).schematicImageBase64} 
                          alt="Site Metering Schematic" 
                          className="max-w-full h-auto rounded-lg border"
                        />
                        <p className="text-xs text-muted-foreground">
                          Figure 1: Site Metering Schematic Diagram
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Page 5 (or 4 if no schematic): Key Metrics */}
                  {currentPage === ((previewData as any).schematicImageBase64 ? 5 : 4) && (
                    <div className="space-y-4">
                      <div className="bg-primary text-primary-foreground p-4 rounded">
                        <h3 className="text-2xl font-bold">3. KEY METRICS</h3>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-sm font-semibold mb-3">Basic Reconciliation Metrics</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="border rounded-lg p-3 space-y-1 bg-muted/30">
                              <p className="text-xs text-muted-foreground">Total Supply</p>
                              <p className="text-xl font-bold">{previewData.reconciliationData.totalSupply} kWh</p>
                            </div>
                            <div className="border rounded-lg p-3 space-y-1 bg-muted/30">
                              <p className="text-xs text-muted-foreground">Distribution Total</p>
                              <p className="text-xl font-bold">{previewData.reconciliationData.distributionTotal} kWh</p>
                            </div>
                            <div className="border rounded-lg p-3 space-y-1 bg-muted/30">
                              <p className="text-xs text-muted-foreground">Recovery Rate</p>
                              <p className="text-xl font-bold">{previewData.reconciliationData.recoveryRate}%</p>
                            </div>
                            <div className="border rounded-lg p-3 space-y-1 bg-muted/30">
                              <p className="text-xs text-muted-foreground">Variance</p>
                              <p className="text-xl font-bold">
                                {previewData.reconciliationData.variance} kWh ({previewData.reconciliationData.variancePercentage}%)
                              </p>
                            </div>
                          </div>
                        </div>

                        {(previewData as any).csvColumnAggregations && Object.keys((previewData as any).csvColumnAggregations).length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold mb-3">CSV Column Aggregations</h4>
                            <div className="border rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-primary text-primary-foreground">
                                  <tr>
                                    <th className="text-left p-2">Column</th>
                                    <th className="text-right p-2">Value</th>
                                    <th className="text-center p-2">Unit</th>
                                    <th className="text-center p-2">Agg</th>
                                    <th className="text-center p-2">Mult</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries((previewData as any).csvColumnAggregations).map(([columnName, data]: [string, any]) => (
                                    <tr key={columnName} className="border-t">
                                      <td className="p-2 font-medium">{columnName}</td>
                                      <td className="p-2 text-right">{data.value.toFixed(2)}</td>
                                      <td className="p-2 text-center">{data.aggregation === 'sum' ? 'kWh' : 'kVA'}</td>
                                      <td className="p-2 text-center uppercase">{data.aggregation}</td>
                                      <td className="p-2 text-center">{data.multiplier !== 1 ? `×${data.multiplier}` : '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Page 6 (or 5): Observations */}
                  {currentPage === ((previewData as any).schematicImageBase64 ? 6 : 5) && (
                    <div className="space-y-4">
                      <div className="bg-primary text-primary-foreground p-4 rounded">
                        <h3 className="text-2xl font-bold">4. OBSERVATIONS AND ANOMALIES</h3>
                      </div>
                      <div className="prose prose-sm max-w-none text-xs whitespace-pre-wrap">
                        {previewData.reportData.sections.observations}
                      </div>
                      {previewData.anomalies.length > 0 && (
                        <div className="space-y-2 mt-4">
                          <h4 className="font-semibold text-sm">Detected Anomalies</h4>
                          {previewData.anomalies.slice(0, 5).map((anomaly: any, idx: number) => (
                            <div key={idx} className="border-l-4 border-destructive pl-3 py-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold px-2 py-0.5 bg-destructive/10 text-destructive rounded">
                                  {anomaly.severity}
                                </span>
                                {anomaly.meter && (
                                  <span className="text-xs text-muted-foreground">
                                    Meter: {anomaly.meter}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs">{anomaly.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Page 7 (or 6): Recommendations */}
                  {currentPage === ((previewData as any).schematicImageBase64 ? 7 : 6) && (
                    <div className="space-y-4">
                      <div className="bg-primary text-primary-foreground p-4 rounded">
                        <h3 className="text-2xl font-bold">5. RECOMMENDATIONS</h3>
                      </div>
                      <div className="prose prose-sm max-w-none text-xs whitespace-pre-wrap">
                        {previewData.reportData.sections.recommendations}
                      </div>
                    </div>
                  )}

                  {/* Page 8 (or 7): Billing Validation (if exists) */}
                  {previewData.reportData.sections.billingValidation && 
                   currentPage === ((previewData as any).schematicImageBase64 ? 8 : 7) && (
                    <div className="space-y-4">
                      <div className="bg-primary text-primary-foreground p-4 rounded">
                        <h3 className="text-2xl font-bold">6. BILLING VALIDATION</h3>
                      </div>
                      <div className="prose prose-sm max-w-none text-xs whitespace-pre-wrap">
                        {previewData.reportData.sections.billingValidation}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Separator className="my-6" />

            <Button
              onClick={generateReport}
              disabled={isGenerating}
              className="w-full"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Generate Audit Report
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Loader2, Download, CalendarIcon, Eye, Edit } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import PdfContentEditor, { PdfSection } from "./PdfContentEditor";

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
  const [availableMeters, setAvailableMeters] = useState<MeterOption[]>([]);
  const [selectedMeterIds, setSelectedMeterIds] = useState<Set<string>>(new Set());
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [columnConfigs, setColumnConfigs] = useState<Record<string, ColumnConfig>>({});
  const [isLoadingColumns, setIsLoadingColumns] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editableSections, setEditableSections] = useState<PdfSection[]>([]);
  
  // New states for required selections
  const [selectedSchematicId, setSelectedSchematicId] = useState<string>("");
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>("");
  const [selectedReconciliationId, setSelectedReconciliationId] = useState<string>("");
  const [availableSchematics, setAvailableSchematics] = useState<any[]>([]);
  const [availableFolders, setAvailableFolders] = useState<any[]>([]);
  const [availableReconciliations, setAvailableReconciliations] = useState<any[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  // Fetch available options on mount
  useEffect(() => {
    const fetchOptions = async () => {
      setIsLoadingOptions(true);
      try {
        // Fetch schematics
        const { data: schematics, error: schematicsError } = await supabase
          .from("schematics")
          .select("id, name, description, page_number, total_pages")
          .eq("site_id", siteId)
          .order("name", { ascending: true });

        if (schematicsError) throw schematicsError;
        setAvailableSchematics(schematics || []);

        // Fetch available folders from document paths
        const { data: documents, error: foldersError } = await supabase
          .from("site_documents")
          .select("folder_path")
          .eq("site_id", siteId);

        if (foldersError) throw foldersError;
        
        // Get unique folder paths (including nested folders)
        const folderSet = new Set<string>();
        folderSet.add(''); // Add root
        
        documents?.forEach(doc => {
          if (doc.folder_path) {
            // Add this folder and all parent folders
            const parts = doc.folder_path.split('/').filter(Boolean);
            let currentPath = '';
            parts.forEach(part => {
              currentPath = currentPath ? `${currentPath}/${part}` : part;
              folderSet.add(currentPath);
            });
          }
        });
        
        const uniqueFolders = Array.from(folderSet).sort();
        setAvailableFolders(uniqueFolders.map(path => ({ 
          path: path || "/", // Use "/" instead of empty string for root
          displayPath: path, // Keep original for filtering
          name: path || "Root" 
        })));

        // Fetch reconciliation runs
        const { data: reconciliations, error: reconciliationsError } = await supabase
          .from("reconciliation_runs")
          .select("id, run_name, run_date, date_from, date_to")
          .eq("site_id", siteId)
          .order("run_date", { ascending: false });

        if (reconciliationsError) throw reconciliationsError;
        setAvailableReconciliations(reconciliations || []);

      } catch (error) {
        console.error("Error fetching options:", error);
        toast.error("Failed to load report options");
      } finally {
        setIsLoadingOptions(false);
      }
    };

    fetchOptions();
  }, [siteId]);

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

  const handleSaveEditedContent = (editedSections: PdfSection[]) => {
    setEditableSections(editedSections);
    setIsEditingContent(false);
    toast.success("Content updated! You can now generate the PDF.");
  };

  const generateMarkdownPreview = async () => {
    if (!selectedSchematicId || !selectedFolderPath || !selectedReconciliationId) {
      toast.error("Please select a schematic, folder, and reconciliation run");
      return;
    }

    setIsGeneratingPreview(true);

    try {
      toast.info("Generating markdown preview...");

      // 1. Fetch selected reconciliation data
      const { data: selectedReconciliation, error: reconError } = await supabase
        .from("reconciliation_runs")
        .select(`
          *,
          reconciliation_meter_results(*)
        `)
        .eq("id", selectedReconciliationId)
        .single();

      if (reconError) throw reconError;
      if (!selectedReconciliation) throw new Error("Selected reconciliation not found");

      // 2. Fetch selected schematic
      const { data: selectedSchematic, error: schematicError } = await supabase
        .from("schematics")
        .select("*")
        .eq("id", selectedSchematicId)
        .single();

      if (schematicError) throw schematicError;
      if (!selectedSchematic) throw new Error("Selected schematic not found");

      // 3. Fetch documents from selected folder
      const folderPath = selectedFolderPath === "/" ? "" : selectedFolderPath;
      const { data: documents, error: docsError } = await supabase
        .from("site_documents")
        .select(`
          *,
          document_extractions(*)
        `)
        .eq("site_id", siteId)
        .eq("folder_path", folderPath)
        .eq("extraction_status", "completed");

      if (docsError) throw docsError;

      const documentExtractions = documents?.map(doc => ({
        fileName: doc.file_name,
        documentType: doc.document_type,
        extraction: doc.document_extractions?.[0]
      })).filter(d => d.extraction) || [];

      // 4. Fetch all meters for this site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select(`
          *,
          parent_connections:meter_connections!meter_connections_child_meter_id_fkey(
            parent_meter_id,
            parent_meter:meters!meter_connections_parent_meter_id_fkey(
              meter_number,
              name
            )
          ),
          child_connections:meter_connections!meter_connections_parent_meter_id_fkey(
            child_meter_id,
            child_meter:meters!meter_connections_child_meter_id_fkey(
              meter_number,
              name
            )
          )
        `)
        .eq("site_id", siteId)
        .in("id", Array.from(selectedMeterIds));

      if (metersError) throw metersError;

      // 2. Fetch all readings without date filtering

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

      // 5. Use data from selected reconciliation
      const reconciliationData = {
        councilBulkMeters: selectedReconciliation.reconciliation_meter_results
          ?.filter((r: any) => r.meter_type === "bulk_meter")
          .map((r: any) => `${r.meter_number} (${r.meter_name})`)
          .join(", ") || "N/A",
        councilTotal: selectedReconciliation.bulk_total.toFixed(2),
        solarTotal: selectedReconciliation.solar_total.toFixed(2),
        totalSupply: selectedReconciliation.total_supply.toFixed(2),
        distributionTotal: selectedReconciliation.tenant_total.toFixed(2),
        variance: selectedReconciliation.discrepancy.toFixed(2),
        variancePercentage: selectedReconciliation.total_supply > 0 
          ? ((selectedReconciliation.discrepancy / selectedReconciliation.total_supply) * 100).toFixed(2)
          : "0",
        recoveryRate: selectedReconciliation.recovery_rate.toFixed(2),
        meterCount: selectedReconciliation.reconciliation_meter_results?.length || 0,
        councilBulkCount: selectedReconciliation.reconciliation_meter_results?.filter((r: any) => r.meter_type === "bulk_meter").length || 0,
        solarCount: selectedReconciliation.reconciliation_meter_results?.filter((r: any) => r.meter_type === "other").length || 0,
        distributionCount: selectedReconciliation.reconciliation_meter_results?.filter((r: any) => r.meter_type === "tenant_meter").length || 0,
        checkMeterCount: selectedReconciliation.reconciliation_meter_results?.filter((r: any) => r.meter_type === "check_meter").length || 0,
        readingsPeriod: `${format(new Date(selectedReconciliation.date_from), "dd MMM yyyy")} - ${format(new Date(selectedReconciliation.date_to), "dd MMM yyyy")}`,
        documentsAnalyzed: documentExtractions.length
      };

      const variancePercentage = reconciliationData.variancePercentage;

      // 6. Detect anomalies based on reconciliation results
      const anomalies: any[] = [];

      selectedReconciliation.reconciliation_meter_results?.forEach((result: any) => {
        // Critical: No readings on bulk meters
        if (result.meter_type === "bulk_meter" && result.readings_count === 0) {
          anomalies.push({
            type: "no_readings_bulk",
            meter: result.meter_number,
            name: result.meter_name,
            description: `Council bulk meter ${result.meter_number} has no readings for the audit period`,
            severity: "CRITICAL"
          });
        }

        // Critical: Negative consumption
        if (result.total_kwh < 0) {
          anomalies.push({
            type: "negative_consumption",
            meter: result.meter_number,
            name: result.meter_name,
            consumption: result.total_kwh.toFixed(2),
            description: `Meter ${result.meter_number} (${result.meter_name}) shows negative consumption of ${result.total_kwh.toFixed(2)} kWh - possible meter rollback or tampering`,
            severity: "CRITICAL"
          });
        }

        // High: Insufficient readings (< 10)
        if (result.readings_count > 0 && result.readings_count < 10) {
          anomalies.push({
            type: "insufficient_readings",
            meter: result.meter_number,
            name: result.meter_name,
            readingsCount: result.readings_count,
            description: `Meter ${result.meter_number} (${result.meter_name}) has only ${result.readings_count} reading(s) - insufficient for accurate reconciliation`,
            severity: "HIGH"
          });
        }

        // Low: No readings on tenant meters (non-critical)
        if (result.meter_type === "tenant_meter" && result.readings_count === 0) {
          anomalies.push({
            type: "no_readings_distribution",
            meter: result.meter_number,
            name: result.meter_name,
            description: `Distribution meter ${result.meter_number} (${result.meter_name}) has no readings - may be inactive or require investigation`,
            severity: "LOW"
          });
        }
      });

      // High: Excessive variance (> 10%)
      if (Math.abs(parseFloat(variancePercentage)) > 10) {
        anomalies.push({
          type: "high_variance",
          variance: reconciliationData.variance,
          variancePercentage,
          description: `Variance of ${variancePercentage}% (${reconciliationData.variance} kWh) between supply and distribution exceeds acceptable threshold of 5-7%`,
          severity: "HIGH"
        });
      }

      // High: Low recovery rate (< 90%)
      if (parseFloat(reconciliationData.recoveryRate) < 90) {
        anomalies.push({
          type: "low_recovery",
          recoveryRate: reconciliationData.recoveryRate,
          lostRevenue: parseFloat(reconciliationData.variance) * 2.5, // Estimate at R2.50/kWh
          description: `Recovery rate of ${reconciliationData.recoveryRate}% is below acceptable threshold of 90-95% - estimated revenue loss: R${(parseFloat(reconciliationData.variance) * 2.5).toFixed(2)}`,
          severity: "HIGH"
        });
      }

      // Medium: Moderate variance (5-10%)
      if (Math.abs(parseFloat(variancePercentage)) > 5 && Math.abs(parseFloat(variancePercentage)) <= 10) {
        anomalies.push({
          type: "moderate_variance",
          variance: reconciliationData.variance,
          variancePercentage,
          description: `Variance of ${variancePercentage}% (${reconciliationData.variance} kWh) between supply and distribution is above optimal range of 2-5%`,
          severity: "MEDIUM"
        });
      }

      // 7. Load schematic image
      let schematicImageBase64 = null;

      if (selectedSchematic?.converted_image_path) {
        try {
          const { data: imageData } = await supabase.storage
            .from("schematics")
            .download(selectedSchematic.converted_image_path);
          
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

      // Keep original Total Supply calculation (council_bulk + solar)
      // CSV aggregations are for display only in section 4.2

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
            auditPeriodStart: format(new Date(selectedReconciliation.date_from), "dd MMM yyyy"),
            auditPeriodEnd: format(new Date(selectedReconciliation.date_to), "dd MMM yyyy"),
            meterHierarchy,
            meterBreakdown,
            reconciliationData,
            documentExtractions,
            anomalies,
            selectedCsvColumns,
            selectedSchematicName: selectedSchematic.name,
            selectedFolderPath,
            selectedReconciliationName: selectedReconciliation.run_name
          }
        }
      );

      if (aiError) throw aiError;

      // Store preview data with schematic and CSV aggregations
      setPreviewData({
        siteName,
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
      
      // Convert report data to editable markdown sections
      const sections: PdfSection[] = [];
      
      // Header section
      sections.push({
        id: 'header',
        title: 'Report Header',
        content: `# Energy Audit Report

**Client:** ${(previewData as any).reportData?.clientName || siteName}
**Site:** ${siteName}
**Audit Period:** ${format(new Date(selectedReconciliation.date_from), "dd MMM yyyy")} - ${format(new Date(selectedReconciliation.date_to), "dd MMM yyyy")}
**Report Date:** ${format(new Date(), "dd MMM yyyy")}`,
        type: 'text',
        editable: true
      });
      
      if (reportData?.sections) {
        if (reportData.sections.executiveSummary) {
          sections.push({
            id: 'executive-summary',
            title: 'Executive Summary',
            content: `## Executive Summary\n\n${reportData.sections.executiveSummary}`,
            type: 'text',
            editable: true
          });
        }
        
        if (reportData.sections.hierarchyOverview) {
          sections.push({
            id: 'hierarchy-overview',
            title: 'Metering Hierarchy Overview',
            content: `## Metering Hierarchy Overview\n\n${reportData.sections.hierarchyOverview}`,
            type: 'text',
            editable: true
          });
        }
        
        if (schematicImageBase64) {
          sections.push({
            id: 'schematic-image',
            title: 'Site Schematic',
            content: `## Site Schematic\n\n*Schematic diagram will be included in the final PDF*`,
            type: 'image',
            editable: false
          });
        }
        
        // Add reconciliation data section
        sections.push({
          id: 'reconciliation-data',
          title: 'Consumption Reconciliation',
          content: `## Consumption Reconciliation

**Reading Period:** ${reconciliationData.readingsPeriod}

### Summary
- **Total Supply:** ${reconciliationData.totalSupply} kWh
- **Council Bulk Total:** ${reconciliationData.councilTotal} kWh
- **Solar Generation:** ${reconciliationData.solarTotal} kWh
- **Distribution Total:** ${reconciliationData.distributionTotal} kWh
- **Variance:** ${reconciliationData.variance} kWh (${reconciliationData.variancePercentage}%)
- **Recovery Rate:** ${reconciliationData.recoveryRate}%

### Meter Counts
- **Council Bulk Meters:** ${reconciliationData.councilBulkCount}
- **Distribution Meters:** ${reconciliationData.distributionCount}
- **Solar Meters:** ${reconciliationData.solarCount}
- **Check Meters:** ${reconciliationData.checkMeterCount}`,
          type: 'text',
          editable: true
        });
        
        if (reportData.sections.observations) {
          sections.push({
            id: 'observations',
            title: 'Observations and Anomalies',
            content: `## Observations and Anomalies\n\n${reportData.sections.observations}`,
            type: 'text',
            editable: true
          });
        }
        
        if (reportData.sections.recommendations) {
          sections.push({
            id: 'recommendations',
            title: 'Recommendations',
            content: `## Recommendations\n\n${reportData.sections.recommendations}`,
            type: 'text',
            editable: true
          });
        }
        
        if (reportData.sections.billingValidation) {
          sections.push({
            id: 'billing-validation',
            title: 'Billing Validation',
            content: `## Billing Validation\n\n${reportData.sections.billingValidation}`,
            type: 'text',
            editable: true
          });
        }
      }
      
      setEditableSections(sections);
      setIsEditingContent(true); // Go directly to editor
      setCurrentPage(1); // Reset to first page

      toast.success("Markdown preview generated - ready to edit!");

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

      // Helper function to get section content (edited or original)
      const getSectionContent = (sectionId: string): string => {
        const editedSection = editableSections.find(s => s.id === sectionId);
        if (editedSection && editedSection.content) {
          return editedSection.content;
        }
        // Fallback to original content
        const sectionMap: Record<string, string> = {
          'executive-summary': reportData.sections.executiveSummary,
          'hierarchy-overview': reportData.sections.hierarchyOverview,
          'observations': reportData.sections.observations,
          'recommendations': reportData.sections.recommendations,
          'billing-validation': reportData.sections.billingValidation
        };
        return sectionMap[sectionId] || '';
      };

      // Get page breaks positions from editableSections
      const pageBreakPositions = editableSections
        .map((section, index) => ({ section, index }))
        .filter(({ section }) => section.type === 'page-break')
        .map(({ index }) => index);

      // Categorize meters by type for PDF generation
      const councilBulk = meterData.filter((m: any) => m.meter_type === "council_bulk");
      const solarMeters = meterData.filter((m: any) => m.meter_type === "solar");
      const distribution = meterData.filter((m: any) => m.meter_type === "distribution");
      const checkMeters = meterData.filter((m: any) => m.meter_type === "check_meter");

      // 11. Generate PDF with template styling
      toast.info("Generating PDF...");
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      // Template styling constants
      const blueBarWidth = 15; // Width of left blue bar
      const leftMargin = 25; // Left margin (accounting for blue bar)
      const rightMargin = 20;
      const topMargin = 20;
      const bottomMargin = 20;
      
      // Template blue color (from the template)
      const templateBlue = [23, 109, 177]; // RGB for #176DB1
      
      // Number formatting helper
      const formatNumber = (value: number, decimals: number = 2): string => {
        return value.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      };
      
      let yPos = topMargin;
      let pageNumber = 1;
      const sectionPages: { title: string; page: number }[] = [];
      const indexTerms: { term: string; page: number }[] = [];
      
      // Helper to add blue sidebar on each page
      const addBlueSidebar = () => {
        pdf.setFillColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        pdf.rect(0, 0, blueBarWidth, pageHeight, "F");
      };
      
      // Helper to add footer
      const addFooter = () => {
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 100, 100);
        const docNumber = `Document Number: AUD-${format(new Date(), "yyyyMMdd-HHmmss")}`;
        const printDate = `Print date: ${format(new Date(), "dd/MM/yyyy HH:mm")}`;
        pdf.text(docNumber, leftMargin, pageHeight - 10);
        pdf.text(printDate, pageWidth - rightMargin, pageHeight - 10, { align: "right" });
        pdf.setTextColor(0, 0, 0);
      };

      // Helper function to add page number
      const addPageNumber = () => {
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 100, 100);
        pdf.text(`Page ${pageNumber} of`, pageWidth / 2, pageHeight - 5, { align: "center" });
        pdf.setTextColor(0, 0, 0);
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
        const maxWidth = pageWidth - leftMargin - rightMargin - indent;
        const lines = pdf.splitTextToSize(cleanedText, maxWidth);
        
        lines.forEach((line: string) => {
          if (yPos > pageHeight - bottomMargin - 15) {
            addBlueSidebar();
            addFooter();
            addPageNumber();
            pdf.addPage();
            addBlueSidebar();
            yPos = topMargin;
          }
          pdf.text(line, leftMargin + indent, yPos);
          yPos += fontSize * 0.5;
        });
        yPos += 3;
      };

      // Helper function to add bullet point
      const addBullet = (text: string, level: number = 0) => {
        const indent = 5 + (level * 5);
        const bullet = level === 0 ? "•" : "◦";
        
        if (yPos > pageHeight - bottomMargin - 15) {
          addBlueSidebar();
          addFooter();
          addPageNumber();
          pdf.addPage();
          addBlueSidebar();
          yPos = topMargin;
        }
        
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text(bullet, leftMargin + indent, yPos);
        
        const maxWidth = pageWidth - leftMargin - rightMargin - indent - 5;
        const lines = pdf.splitTextToSize(text, maxWidth);
        lines.forEach((line: string, index: number) => {
          if (index > 0 && yPos > pageHeight - bottomMargin - 15) {
            addBlueSidebar();
            addFooter();
            addPageNumber();
            pdf.addPage();
            addBlueSidebar();
            yPos = topMargin;
          }
          pdf.text(line, leftMargin + indent + 5, yPos);
          yPos += 5;
        });
        yPos += 2;
      };

      // Helper function to add table
      const addTable = (headers: string[], rows: string[][], columnWidths?: number[]) => {
        const tableWidth = pageWidth - leftMargin - rightMargin;
        const defaultColWidth = tableWidth / headers.length;
        const colWidths = columnWidths || headers.map(() => defaultColWidth);
        
        // Check if we need a new page
        if (yPos > pageHeight - bottomMargin - 40) {
          addBlueSidebar();
          addFooter();
          addPageNumber();
          pdf.addPage();
          addBlueSidebar();
          yPos = topMargin;
        }
        
        // Draw header with template blue color
        pdf.setFillColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        pdf.rect(leftMargin, yPos - 5, tableWidth, 10, "F");
        
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(255, 255, 255); // White text on blue header
        let xPos = leftMargin + 2;
        headers.forEach((header, i) => {
          pdf.text(header, xPos, yPos);
          xPos += colWidths[i];
        });
        pdf.setTextColor(0, 0, 0); // Reset to black
        yPos += 7;
        
        // Draw border around header
        pdf.setDrawColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        pdf.setLineWidth(0.5);
        pdf.rect(leftMargin, yPos - 12, tableWidth, 10);
        
        // Draw rows
        pdf.setFont("helvetica", "normal");
        rows.forEach((row) => {
          if (yPos > pageHeight - bottomMargin - 15) {
            addBlueSidebar();
            addFooter();
            addPageNumber();
            pdf.addPage();
            addBlueSidebar();
            yPos = topMargin + 15;
          }
          
          xPos = leftMargin + 2;
          row.forEach((cell, i) => {
            const cellLines = pdf.splitTextToSize(cell, colWidths[i] - 4);
            pdf.text(cellLines[0] || "", xPos, yPos);
            xPos += colWidths[i];
          });
          
          // Draw row border
          pdf.setDrawColor(220, 220, 220);
          pdf.rect(leftMargin, yPos - 5, tableWidth, 8);
          
          yPos += 8;
        });
        
        yPos += 5;
      };

      const addSectionHeading = (text: string, fontSize: number = 14, forceNewPage: boolean = false) => {
        // Force new page for major sections
        if (forceNewPage) {
          addBlueSidebar();
          addFooter();
          addPageNumber();
          pdf.addPage();
          addBlueSidebar();
          yPos = topMargin;
        }
        
        yPos += 8;
        
        // Track section page for TOC
        sectionPages.push({ title: text, page: pageNumber });
        
        // Add to index
        const cleanTitle = text.replace(/^\d+\.\s*/, ''); // Remove numbering
        indexTerms.push({ term: cleanTitle, page: pageNumber });
        
        // Section heading in template blue (no filled background, just colored text)
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        pdf.text(text, leftMargin, yPos);
        pdf.setTextColor(0, 0, 0);
        yPos += fontSize + 5;
      };

      const addSubsectionHeading = (text: string) => {
        yPos += 5;
        if (yPos > pageHeight - bottomMargin - 20) {
          addBlueSidebar();
          addFooter();
          addPageNumber();
          pdf.addPage();
          addBlueSidebar();
          yPos = topMargin;
        }
        
        // Add subsection to index
        indexTerms.push({ term: text, page: pageNumber });
        
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        pdf.text(text, leftMargin, yPos);
        pdf.setTextColor(0, 0, 0);
        yPos += 8;
      };

      const addSpacer = (height: number = 5) => {
        yPos += height;
      };

      // COVER PAGE matching template style
      addBlueSidebar();
      
      // Title centered on page
      pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
      pdf.setFontSize(32);
      pdf.setFont("helvetica", "bold");
      pdf.text(previewSiteName.toUpperCase(), pageWidth / 2, 80, { align: "center" });
      
      pdf.setFontSize(18);
      pdf.text("METERING AUDIT REPORT", pageWidth / 2, 100, { align: "center" });
      
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "normal");
      pdf.text("Financial Analysis", pageWidth / 2, 115, { align: "center" });
      
      // Audit Period section
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.text("Audit Period", pageWidth / 2, 155, { align: "center" });
      pdf.setFont("helvetica", "bold");
      pdf.text(
        "All Available Readings",
        pageWidth / 2,
        165,
        { align: "center" }
      );

      addFooter();

      // TABLE OF CONTENTS (Single Page)
      addPageNumber();
      pdf.addPage();
      addBlueSidebar();
      yPos = topMargin;
      
      // Add heading
      pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text("1.1 Table of Contents", leftMargin, yPos);
      pdf.setTextColor(0, 0, 0);
      yPos += 12;
      
      // Add table of contents entries
      const tocEntries = [
        "1. EXECUTIVE SUMMARY",
        "2. METERING HIERARCHY OVERVIEW",
        "3. DATA SOURCES AND AUDIT PERIOD",
        "4. KEY METRICS",
        "   4.1 Basic Reconciliation Metrics",
        "   4.2 CSV Column Aggregations",
        "5. METERING RECONCILIATION",
        "   5.1 Supply Summary",
        "   5.2 Distribution Summary",
        "6. METER BREAKDOWN",
        "7. OBSERVATIONS AND ANOMALIES",
        "8. RECOMMENDATIONS"
      ];
      
      if (documentExtractions && documentExtractions.length > 0) {
        tocEntries.push("9. BILLING VALIDATION");
      }
      
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      
      tocEntries.forEach((entry, index) => {
        if (yPos > pageHeight - bottomMargin - 10) {
          addBlueSidebar();
          addFooter();
          addPageNumber();
          pdf.addPage();
          addBlueSidebar();
          yPos = topMargin;
        }
        
        const isSubsection = entry.startsWith("   ");
        const displayEntry = isSubsection ? entry.trim() : entry;
        const xPosition = leftMargin + (isSubsection ? 10 : 0);
        
        if (!isSubsection) {
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        } else {
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(0, 0, 0);
        }
        
        pdf.text(displayEntry, xPosition, yPos);
        yPos += 8;
        
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(0, 0, 0);
      });
      
      addFooter();

      // Start main content
      addPageNumber();
      pdf.addPage();
      addBlueSidebar();
      yPos = topMargin;

      // Section 1: Executive Summary
      addSectionHeading("1. EXECUTIVE SUMMARY", 16, false);
      addText(getSectionContent('executive-summary'));
      addSpacer(8);

      // Section 2: Metering Hierarchy Overview
      addSectionHeading("2. METERING HIERARCHY OVERVIEW", 16, true);
      addText(getSectionContent('hierarchy-overview'));
      addSpacer(5);
      
      // Add schematic if available
      if (schematicImageBase64) {
        if (yPos > pageHeight - 150) {
          addBlueSidebar();
          addFooter();
          addPageNumber();
          pdf.addPage();
          addBlueSidebar();
          yPos = topMargin;
        }
        
        try {
          const imgWidth = pageWidth - leftMargin - rightMargin;
          const imgHeight = 120;
          pdf.addImage(schematicImageBase64, 'PNG', leftMargin, yPos, imgWidth, imgHeight);
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
      addText("All Available Readings");
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
        ["Total Supply", `${formatNumber(parseFloat(reconciliationData.totalSupply))} kWh`],
        ["Distribution Total", `${formatNumber(parseFloat(reconciliationData.distributionTotal))} kWh`],
        ["Recovery Rate", `${formatNumber(parseFloat(reconciliationData.recoveryRate))}%`],
        ["Variance", `${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${formatNumber(parseFloat(reconciliationData.variance))} kWh (${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variancePercentage}%)`]
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
          formatNumber(data.value),
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
        ["Council Bulk Supply", `${formatNumber(parseFloat(reconciliationData.councilTotal))} kWh`]
      ];
      if (parseFloat(reconciliationData.solarTotal) > 0) {
        supplyRows.push(["Solar Generation", `${formatNumber(parseFloat(reconciliationData.solarTotal))} kWh`]);
      }
      supplyRows.push(["Total Supply", `${formatNumber(parseFloat(reconciliationData.totalSupply))} kWh`]);
      
      addTable(["Supply Source", "Energy (kWh)"], supplyRows, [120, 50]);
      addSpacer(5);
      
      addSubsectionHeading("5.2 Distribution Summary");
      
      // Create distribution table
      const distributionRows = [
        ["Total Distribution Consumption", `${formatNumber(parseFloat(reconciliationData.distributionTotal))} kWh`],
        ["Recovery Rate", `${formatNumber(parseFloat(reconciliationData.recoveryRate))}%`],
        ["Discrepancy", `${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${formatNumber(parseFloat(reconciliationData.variance))} kWh (${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variancePercentage}%)`]
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
          `${formatNumber(m.totalKwh)} kWh`,
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
          `${formatNumber(m.totalKwh)} kWh`,
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
          `${formatNumber(m.totalKwh)} kWh`,
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
          `${formatNumber(m.totalKwh)} kWh`,
          m.readingsCount === 0 ? "INACTIVE" : `${m.readingsCount} readings`
        ]);
        addTable(["Meter Number", "Name", "Consumption", "Status"], checkRows, [40, 50, 40, 40]);
        addSpacer(3);
      }
      addSpacer(8);

      // Section 5: Billing Validation (if documents available)
      const billingContent = getSectionContent('billing-validation');
      if (billingContent) {
        addSectionHeading("5. BILLING VALIDATION", 16);
        addText(billingContent);
        addSpacer(8);
      }

      // Section 6: Observations and Anomalies
      const obsSection = billingContent ? "6" : "5";
      addSectionHeading(`${obsSection}. OBSERVATIONS AND ANOMALIES`, 16);
      // Clean any duplicate heading text from AI response
      const cleanedObservations = getSectionContent('observations')
        .replace(/^observations\s+and\s+anomalies[:\s]*/i, '')
        .trim();
      addText(cleanedObservations);
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
      const recSection = billingContent ? "8" : "7";
      addSectionHeading(`${recSection}. RECOMMENDATIONS`, 16, true);
      addText(getSectionContent('recommendations'));
      addSpacer(8);

      // Section 9: Appendices
      const appSection = billingContent ? "9" : "8";
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
        {/* Required Selections */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="schematic-select">Select Schematic *</Label>
            <Select 
              value={selectedSchematicId} 
              onValueChange={setSelectedSchematicId}
              disabled={isLoadingOptions}
            >
              <SelectTrigger id="schematic-select">
                <SelectValue placeholder="Choose a schematic for the report" />
              </SelectTrigger>
              <SelectContent>
                {availableSchematics.length === 0 ? (
                  <SelectItem value="no-schematics" disabled>No schematics available</SelectItem>
                ) : (
                  availableSchematics.map((schematic) => (
                    <SelectItem key={schematic.id} value={schematic.id}>
                      {schematic.name} {schematic.total_pages > 1 ? `(Page ${schematic.page_number}/${schematic.total_pages})` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="folder-select">Select Document Folder *</Label>
            <Select 
              value={selectedFolderPath} 
              onValueChange={setSelectedFolderPath}
              disabled={isLoadingOptions}
            >
              <SelectTrigger id="folder-select">
                <SelectValue placeholder="Choose a folder containing relevant documents" />
              </SelectTrigger>
              <SelectContent>
                {availableFolders.length === 0 ? (
                  <SelectItem value="no-folders" disabled>No folders available</SelectItem>
                ) : (
                  availableFolders.map((folder: any) => (
                    <SelectItem key={folder.path} value={folder.path}>
                      {folder.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reconciliation-select">Select Reconciliation History *</Label>
            <Select 
              value={selectedReconciliationId} 
              onValueChange={setSelectedReconciliationId}
              disabled={isLoadingOptions}
            >
              <SelectTrigger id="reconciliation-select">
                <SelectValue placeholder="Choose a saved reconciliation run" />
              </SelectTrigger>
              <SelectContent>
                {availableReconciliations.length === 0 ? (
                  <SelectItem value="no-reconciliations" disabled>No reconciliation history available</SelectItem>
                ) : (
                  availableReconciliations.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {run.run_name} - {format(new Date(run.run_date), "dd MMM yyyy")}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

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
          onClick={generateMarkdownPreview}
          disabled={
            isGeneratingPreview || 
            isLoadingMeters || 
            isLoadingOptions ||
            !selectedSchematicId || 
            !selectedFolderPath || 
            !selectedReconciliationId
          }
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
              <Edit className="w-4 h-4 mr-2" />
              Generate Markdown Preview
            </>
          )}
        </Button>

        {isEditingContent && editableSections.length > 0 && (
          <PdfContentEditor
            sections={editableSections}
            onSave={handleSaveEditedContent}
            onCancel={() => {
              setIsEditingContent(false);
              setEditableSections([]);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

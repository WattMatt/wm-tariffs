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
import { SplitViewReportEditor } from "./SplitViewReportEditor";
import SaveReportDialog from "./SaveReportDialog";
import SavedReportsList from "./SavedReportsList";
import { ReportGenerationProgress } from "./ReportGenerationProgress";
import { generateMeterTypeChart, generateConsumptionChart } from "./ChartGenerator";

interface BatchStatus {
  batchNumber: number;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  sections: {
    id: string;
    name: string;
    status: 'pending' | 'generating' | 'success' | 'failed';
    error?: string;
  }[];
}

export interface PdfSection {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'page-break' | 'chart';
  editable: boolean;
}

interface SiteReportExportProps {
  siteId: string;
  siteName: string;
  reconciliationRun?: any; // Optional: if provided, use this data instead of fetching
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
  chartImages?: {
    meterTypeChart?: string;
    consumptionChart?: string;
  };
}

export default function SiteReportExport({ siteId, siteName, reconciliationRun }: SiteReportExportProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState("");
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
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [pendingPdfBlob, setPendingPdfBlob] = useState<Blob | null>(null);
  const [refreshReports, setRefreshReports] = useState(0);
  
  // New states for required selections
  const [selectedSchematicId, setSelectedSchematicId] = useState<string>("");
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<string[]>([]);
  const [selectedReconciliationIds, setSelectedReconciliationIds] = useState<string[]>([]);
  const [availableSchematics, setAvailableSchematics] = useState<any[]>([]);
  const [availableFolders, setAvailableFolders] = useState<any[]>([]);
  const [availableReconciliations, setAvailableReconciliations] = useState<any[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [reconciliationDateFrom, setReconciliationDateFrom] = useState<string>("");
  const [reconciliationDateTo, setReconciliationDateTo] = useState<string>("");
  const [batchStatuses, setBatchStatuses] = useState<BatchStatus[]>([]);
  const [currentBatch, setCurrentBatch] = useState<number | undefined>();

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

        // Fetch available folders from document paths with document counts
        // Only include non-folder documents (actual files)
        const { data: documents, error: foldersError } = await supabase
          .from("site_documents")
          .select("folder_path")
          .eq("site_id", siteId)
          .eq("is_folder", false);

        if (foldersError) throw foldersError;
        
        // Get unique folder paths with counts - only count actual documents
        const folderCounts = new Map<string, number>();
        
        documents?.forEach(doc => {
          const docFolder = doc.folder_path || '';
          folderCounts.set(docFolder, (folderCounts.get(docFolder) || 0) + 1);
        });
        
        // Only include folders that have documents (count > 0)
        const uniqueFolders = Array.from(folderCounts.keys())
          .filter(path => (folderCounts.get(path) || 0) > 0)
          .sort((a, b) => {
            // Sort alphabetically
            const aName = a || "Root";
            const bName = b || "Root";
            return aName.localeCompare(bName);
          });
          
        setAvailableFolders(uniqueFolders.map(path => ({ 
          path: path || "/",
          displayPath: path,
          name: path || "Root",
          count: folderCounts.get(path) || 0
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

  const generatePdfPreview = async (sections: PdfSection[]): Promise<string> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!previewData) {
          resolve('');
          return;
        }

        const pdf = new jsPDF({
          compress: true // Enable PDF compression
        });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        
        // Extract data from preview
        const {
          siteName: previewSiteName,
          meterData,
          meterHierarchy,
          reconciliationData,
          documentExtractions,
          anomalies,
          schematicImageBase64,
          csvColumnAggregations
        } = previewData as any;

        // Template styling constants
        const blueBarWidth = 15;
        const leftMargin = 30;
        const rightMargin = 20;
        const topMargin = 15;
        const bottomMargin = 15;
        const templateBlue = [23, 109, 177]; // RGB for #176DB1
        
        let yPos = topMargin;
        let pageNumber = 1;

        // Number formatting helper
        const formatNumber = (value: number, decimals: number = 2): string => {
          return value.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        };
        
        // Helper to add blue sidebar
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
        
        // Helper to add page number
        const addPageNumber = () => {
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(100, 100, 100);
          pdf.text(`Page ${pageNumber}`, pageWidth / 2, pageHeight - 5, { align: "center" });
          pdf.setTextColor(0, 0, 0);
          pageNumber++;
        };
        
        // Helper to parse markdown tables
        const parseMarkdownTable = (text: string): { headers: string[], rows: string[][] } | null => {
          const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
          if (lines.length < 3) return null; // Need header, separator, and at least one row
          
          const parseRow = (line: string) => 
            line.split('|')
              .slice(1, -1) // Remove empty first and last elements from split
              .map(cell => cell.trim());
          
          const headers = parseRow(lines[0]);
          const rows = lines.slice(2).map(parseRow); // Skip separator line
          
          return headers.length > 0 && rows.length > 0 ? { headers, rows } : null;
        };
        
        // Helper to draw pie charts
        const drawPieChart = (chartData: any) => {
          const data = chartData.data?.datasets?.[0]?.data || [];
          const labels = chartData.data?.labels || [];
          const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
          
          if (data.length === 0) return;

          // Check if we need a new page
          if (yPos > pageHeight - bottomMargin - 100) {
            addFooter();
            addPageNumber();
            pdf.addPage();
            yPos = topMargin;
          }

          const centerX = pageWidth / 2;
          const centerY = yPos + 40;
          const radius = 30;
          
          const total = data.reduce((sum: number, val: number) => sum + val, 0);
          let currentAngle = -Math.PI / 2; // Start at top

          // Draw pie slices
          data.forEach((value: number, index: number) => {
            const sliceAngle = (value / total) * 2 * Math.PI;
            const endAngle = currentAngle + sliceAngle;
            
            // Parse color
            const color = colors[index % colors.length];
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            
            pdf.setFillColor(r, g, b);
            
            // Draw wedge using triangles approximation
            const segments = Math.max(3, Math.ceil(sliceAngle / (Math.PI / 18))); // More segments for smoother arc
            const segmentAngle = sliceAngle / segments;
            
            for (let i = 0; i < segments; i++) {
              const angle1 = currentAngle + (i * segmentAngle);
              const angle2 = currentAngle + ((i + 1) * segmentAngle);
              
              const x1 = centerX + radius * Math.cos(angle1);
              const y1 = centerY + radius * Math.sin(angle1);
              const x2 = centerX + radius * Math.cos(angle2);
              const y2 = centerY + radius * Math.sin(angle2);
              
              pdf.triangle(centerX, centerY, x1, y1, x2, y2, 'F');
            }
            
            currentAngle = endAngle;
          });

          // Draw legend
          yPos = centerY + radius + 10;
          labels.forEach((label: string, index: number) => {
            const color = colors[index % colors.length];
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            
            pdf.setFillColor(r, g, b);
            pdf.rect(leftMargin, yPos - 3, 5, 5, 'F');
            pdf.setFontSize(9);
            pdf.setTextColor(60, 60, 60);
            const percentage = ((data[index] / total) * 100).toFixed(1);
            pdf.text(`${label}: ${data[index].toLocaleString()} (${percentage}%)`, leftMargin + 8, yPos);
            yPos += 6;
          });
          
          pdf.setTextColor(0, 0, 0);
          yPos += 5;
        };

        // Helper to draw bar charts
        const drawBarChart = (chartData: any) => {
          const data = chartData.data?.datasets?.[0]?.data || [];
          const labels = chartData.data?.labels || [];
          const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
          
          if (data.length === 0) return;

            // Check if we need a new page
            if (yPos > pageHeight - bottomMargin - 100) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }

          const chartWidth = pageWidth - leftMargin - rightMargin - 20;
          const chartHeight = 60;
          const chartX = leftMargin + 10;
          const chartY = yPos;

          const maxValue = Math.max(...data);
          const barWidth = chartWidth / data.length * 0.6;
          const spacing = chartWidth / data.length;

          // Draw bars
          data.forEach((value: number, index: number) => {
            const barHeight = (value / maxValue) * chartHeight;
            const barX = chartX + index * spacing + (spacing - barWidth) / 2;
            const barY = chartY + chartHeight - barHeight;
            
            const color = colors[index % colors.length];
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            
            pdf.setFillColor(r, g, b);
            pdf.rect(barX, barY, barWidth, barHeight, 'F');
            
            // Draw value on top
            pdf.setFontSize(8);
            pdf.setTextColor(60, 60, 60);
            pdf.text(value.toLocaleString(), barX + barWidth / 2, barY - 2, { align: 'center' });
            
            // Draw label below
            pdf.setFontSize(7);
            const labelText = labels[index] || `Item ${index + 1}`;
            const labelLines = pdf.splitTextToSize(labelText, barWidth + 10);
            pdf.text(labelLines, barX + barWidth / 2, chartY + chartHeight + 5, { 
              align: 'center'
            });
          });

          // Draw axes
          pdf.setDrawColor(200, 200, 200);
          pdf.line(chartX, chartY + chartHeight, chartX + chartWidth, chartY + chartHeight); // X-axis
          pdf.line(chartX, chartY, chartX, chartY + chartHeight); // Y-axis
          
          pdf.setTextColor(0, 0, 0);
          yPos += chartHeight + 25;
        };
        
        // Helper to render content with markdown support
        const renderContent = (text: string, fontSize: number = 9) => {
          if (!text || text.trim() === '') return;
          
          // Check for JSON chart blocks (with or without code fences)
          // First try code-fenced JSON: ```json {...} ```
          let chartMatch = text.match(/```json\s*(\{[\s\S]*?"type":\s*"(pie|bar)"[\s\S]*?\})\s*```/);
          
          // If no code fence, try standalone JSON object
          if (!chartMatch) {
            chartMatch = text.match(/(\{[\s\S]*?"type":\s*"(pie|bar)"[\s\S]*?\})/);
          }
          
          if (chartMatch) {
            const chartJson = chartMatch[1];
            const chartType = chartMatch[2] as 'pie' | 'bar';
            const beforeChart = text.substring(0, chartMatch.index);
            const afterChart = text.substring((chartMatch.index || 0) + chartMatch[0].length);
            
            // Render text before chart
            if (beforeChart.trim()) {
              renderContent(beforeChart, fontSize);
            }
            
            // Parse and render chart
            try {
              const chartData = JSON.parse(chartJson);
              console.log(`Rendering ${chartType} chart:`, chartData);
              
              if (chartData.type === 'pie') {
                drawPieChart(chartData);
              } else if (chartData.type === 'bar') {
                drawBarChart(chartData);
              }
            } catch (e) {
              console.error('Failed to parse chart JSON:', e, chartJson);
              addText(`[Chart rendering error: ${e instanceof Error ? e.message : 'Unknown error'}]`, fontSize, false);
            }
            
            // Render text after chart (recursively)
            if (afterChart.trim()) {
              renderContent(afterChart, fontSize);
            }
            return;
          }
          
          // Check for markdown table
          const tableMatch = text.match(/\|[^\n]+\|\n\|[-:\s|]+\|\n(\|[^\n]+\|\n?)+/);
          if (tableMatch) {
            const tableText = tableMatch[0];
            const beforeTable = text.substring(0, tableMatch.index);
            const afterTable = text.substring((tableMatch.index || 0) + tableText.length);
            
            // Render text before table
            if (beforeTable.trim()) {
              addText(beforeTable, fontSize, false);
              yPos += 3;
            }
            
            // Parse and render table
            const parsed = parseMarkdownTable(tableText);
            if (parsed) {
              addTable(parsed.headers, parsed.rows);
              yPos += 5;
            }
            
            // Render text after table (recursively in case of multiple tables)
            if (afterTable.trim()) {
              renderContent(afterTable, fontSize);
            }
            return;
          }
          
          // No table or chart found, render as text
          addText(text, fontSize, false);
        };
        
        // Helper to add text with wrapping
        const addText = (text: string, fontSize: number = 9, isBold: boolean = false) => {
          const cleanedText = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^##\s+.+$/gm, '').trim();
          pdf.setFontSize(fontSize);
          pdf.setFont("helvetica", isBold ? "bold" : "normal");
          const maxWidth = pageWidth - leftMargin - rightMargin;
          const lines = pdf.splitTextToSize(cleanedText, maxWidth);
          
          lines.forEach((line: string) => {
            if (yPos > pageHeight - bottomMargin - 15) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            pdf.text(line, leftMargin, yPos);
            yPos += fontSize * 0.5;
          });
          yPos += 3;
        };
        
        // Helper to add section heading
        const addSectionHeading = (text: string, fontSize: number = 12, forceNewPage: boolean = false) => {
          // Force new page for major sections
          if (forceNewPage) {
            addFooter();
            addPageNumber();
            pdf.addPage();
            yPos = topMargin;
          }
          
          yPos += 8;
          pdf.setFontSize(fontSize);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
          pdf.text(text, leftMargin, yPos);
          pdf.setTextColor(0, 0, 0);
          yPos += fontSize + 5;
        };

        // Helper to add subsection heading
        const addSubsectionHeading = (text: string) => {
          yPos += 5;
          if (yPos > pageHeight - bottomMargin - 20) {
            addFooter();
            addPageNumber();
            pdf.addPage();
            yPos = topMargin;
          }
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
          pdf.text(text, leftMargin, yPos);
          pdf.setTextColor(0, 0, 0);
          yPos += 8;
        };

        // Helper to add table
        const addTable = (headers: string[], rows: string[][], columnWidths?: number[]) => {
          const tableWidth = pageWidth - leftMargin - rightMargin;
          const defaultColWidth = tableWidth / headers.length;
          const colWidths = columnWidths || headers.map(() => defaultColWidth);
          
          if (yPos > pageHeight - bottomMargin - 40) {
            addFooter();
            addPageNumber();
            pdf.addPage();
            yPos = topMargin;
          }
          
          // Draw header
          pdf.setFillColor(templateBlue[0], templateBlue[1], templateBlue[2]);
          pdf.rect(leftMargin, yPos - 5, tableWidth, 10, "F");
          
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(255, 255, 255);
          let xPos = leftMargin + 2;
          headers.forEach((header, i) => {
            pdf.text(header, xPos, yPos);
            xPos += colWidths[i];
          });
          pdf.setTextColor(0, 0, 0);
          yPos += 7;
          
          // Draw rows
          pdf.setFont("helvetica", "normal");
          rows.forEach((row) => {
            if (yPos > pageHeight - bottomMargin - 15) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin + 15;
            }
            
            xPos = leftMargin + 2;
            row.forEach((cell, i) => {
              const cellLines = pdf.splitTextToSize(cell, colWidths[i] - 4);
              pdf.text(cellLines[0] || "", xPos, yPos);
              xPos += colWidths[i];
            });
            
            pdf.setDrawColor(220, 220, 220);
            pdf.rect(leftMargin, yPos - 5, tableWidth, 8);
            yPos += 8;
          });
          
          yPos += 5;
        };

        const addSpacer = (height: number = 5) => {
          yPos += height;
        };
        
        // COVER PAGE
        addBlueSidebar();
        pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        pdf.setFontSize(24);
        pdf.setFont("helvetica", "bold");
        pdf.text(previewSiteName.toUpperCase(), pageWidth / 2, 80, { align: "center" });
        
        pdf.setFontSize(14);
        pdf.text("METERING", pageWidth / 2, 100, { align: "center" });
        
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "normal");
        pdf.text("Metering Audit", pageWidth / 2, 115, { align: "center" });
        
        pdf.setFontSize(9);
        pdf.text("Audit Period", pageWidth / 2, 155, { align: "center" });
        pdf.setFont("helvetica", "bold");
        pdf.text(reconciliationData?.readingsPeriod || "All Available Readings", pageWidth / 2, 165, { align: "center" });
        
        pdf.setFontSize(10);

        addFooter();
        
        // TABLE OF CONTENTS
        addPageNumber();
        pdf.addPage();
        addBlueSidebar();
        yPos = topMargin;
        
        pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("1.1 Table of Contents", leftMargin, yPos);
        pdf.setTextColor(0, 0, 0);
        yPos += 12;
        
        const tocEntries = [
          "1. EXECUTIVE SUMMARY",
          "2. SITE INFRASTRUCTURE",
          "3. TARIFF CONFIGURATION",
          "4. METERING DATA ANALYSIS",
          "5. DOCUMENT & INVOICE VALIDATION",
          "6. RECONCILIATION RESULTS",
          "7. COST ANALYSIS",
          "8. FINDINGS & ANOMALIES",
          "9. RECOMMENDATIONS",
          "10. APPENDICES"
        ];
        
        pdf.setFontSize(9);
        tocEntries.forEach((entry) => {
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
          pdf.text(entry, leftMargin, yPos);
          pdf.setTextColor(0, 0, 0);
          yPos += 8;
        });
        
        addFooter();
        
        // Start main content (continue on next page when needed)
        yPos = topMargin;
        
        // Get section content helper
        const getSectionContent = (sectionId: string): string => {
          const section = sections.find(s => s.id === sectionId);
          return section?.content || '';
        };
        
        // Helper to render a section (handles both text and chart sections)
        const renderSection = (sectionId: string) => {
          const section = sections.find(s => s.id === sectionId);
          if (!section) return;
          
          // Check if content is a markdown image
          const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
          const imageMatch = section.content.match(imageRegex);
          
          if (imageMatch && section.type === 'chart') {
            // This is a chart image - render it
            const [_, altText, imageUrl] = imageMatch;
            
            try {
              // Check if we need a new page
              if (yPos > pageHeight - 150) {
                addFooter();
                addPageNumber();
                pdf.addPage();
                yPos = topMargin;
              }
              
              const imgWidth = pageWidth - leftMargin - rightMargin;
              const imgHeight = 120;
              pdf.addImage(imageUrl, 'PNG', leftMargin, yPos, imgWidth, imgHeight);
              yPos += imgHeight + 5;
              
              // Add caption if available
              if (altText) {
                pdf.setFontSize(9);
                pdf.setFont("helvetica", "italic");
                pdf.text(altText, pageWidth / 2, yPos, { align: "center" });
                pdf.setFont("helvetica", "normal");
                yPos += 10;
              }
            } catch (err) {
              console.error(`Error adding chart image for ${sectionId}:`, err);
              addText(`[Chart image rendering error: ${err instanceof Error ? err.message : 'Unknown error'}]`, 10, false);
            }
          } else if (section.type === 'chart') {
            // Legacy: For chart sections with JSON content, parse and render the chart
            try {
              const chartData = JSON.parse(section.content);
              console.log(`Rendering chart section ${sectionId}:`, chartData);
              
              if (chartData.type === 'pie') {
                drawPieChart(chartData);
              } else if (chartData.type === 'bar') {
                drawBarChart(chartData);
              }
            } catch (e) {
              console.error(`Failed to render chart section ${sectionId}:`, e);
              addText(`[Chart rendering error: ${e instanceof Error ? e.message : 'Unknown error'}]`, 10, false);
            }
          } else {
            // For text sections, render content (which may contain embedded charts)
            renderContent(section.content);
          }
        };
        
        // Section 1: Executive Summary
        addSectionHeading("1. EXECUTIVE SUMMARY", 16, true);
        renderSection('executive-summary');
        addSpacer(8);
        
        // Section 2: Site Infrastructure
        addSectionHeading("2. SITE INFRASTRUCTURE", 16, true);
        renderSection('site-infrastructure');
        addSpacer(5);
        
        // Add schematic if available
        if (schematicImageBase64) {
          if (yPos > pageHeight - 150) {
            addFooter();
            addPageNumber();
            pdf.addPage();
            yPos = topMargin;
          }
          
          try {
            const imgWidth = pageWidth - leftMargin - rightMargin;
            const imgHeight = 120;
            pdf.addImage(schematicImageBase64, 'JPEG', leftMargin, yPos, imgWidth, imgHeight);
            yPos += imgHeight + 5;
            
            pdf.setFontSize(9);
            pdf.setFont("helvetica", "italic");
            pdf.text("Figure 1: Site Metering Schematic Diagram", pageWidth / 2, yPos, { align: "center" });
            pdf.setFont("helvetica", "normal");
            yPos += 10;
          } catch (err) {
            console.error("Error adding schematic to preview:", err);
          }
        }
        addSpacer(8);
        
        // Section 3: Tariff Configuration
        addSectionHeading("3. TARIFF CONFIGURATION", 16, true);
        renderSection('tariff-configuration');
        addSpacer(8);
        
        // Section 4: Metering Data Analysis
        addSectionHeading("4. METERING DATA ANALYSIS", 16, true);
        renderSection('metering-data-analysis');
        addSpacer(5);
        
        // Add KPI Cards Section for data collection
        addSubsectionHeading("Data Collection Overview");
        
        // Calculate KPIs
        const kpiTotalReadings = meterData.reduce((sum: number, meter: any) => sum + (meter.readingsCount || 0), 0);
        const kpiTotalMeters = meterData.length;
        const kpiTotalConsumption = meterData.reduce((sum: number, meter: any) => sum + (parseFloat(meter.totalKwh) || 0), 0);
        const kpiAvgReadings = kpiTotalMeters > 0 ? Math.round(kpiTotalReadings / kpiTotalMeters) : 0;
        
        // Check if we need a new page for KPI cards
        if (yPos > pageHeight - bottomMargin - 80) {
          addFooter();
          addPageNumber();
          pdf.addPage();
          yPos = topMargin;
        }
        
        // Draw KPI Cards (4 cards in a row)
        const cardWidth = (pageWidth - leftMargin - rightMargin - 15) / 4; // 15 = 3 gaps of 5
        const cardHeight = 28;
        const cardStartY = yPos;
        const iconSize = 8;
        const iconPadding = 2;
        
        // Card 1: Total Data Points
        let cardX = leftMargin;
        pdf.setFillColor(59, 130, 246, 0.05); // primary with 5% opacity
        pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
        
        // Icon background
        pdf.setFillColor(219, 234, 254); // primary/10
        pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
        
        // Icon (simplified analytics icon using text)
        pdf.setFontSize(8);
        pdf.setTextColor(59, 130, 246); // primary
        pdf.text("📊", cardX + 5, cardStartY + 9);
        
        // Label
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139); // muted-foreground
        pdf.text("Total Data Points", cardX + 3, cardStartY + 17);
        
        // Value
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(0, 0, 0);
        pdf.text(kpiTotalReadings.toLocaleString(), cardX + 3, cardStartY + 23);
        
        // Description
        pdf.setFontSize(6);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 116, 139);
        pdf.text("readings analyzed", cardX + 3, cardStartY + 26.5);
        
        // Card 2: Active Meters
        cardX += cardWidth + 5;
        pdf.setFillColor(142, 81, 245, 0.05); // accent
        pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
        
        pdf.setFillColor(237, 233, 254); // accent/10
        pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
        
        pdf.setFontSize(8);
        pdf.setTextColor(142, 81, 245);
        pdf.text("◉", cardX + 5, cardStartY + 9);
        
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text("Active Meters", cardX + 3, cardStartY + 17);
        
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(0, 0, 0);
        pdf.text(kpiTotalMeters.toString(), cardX + 3, cardStartY + 23);
        
        pdf.setFontSize(6);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 116, 139);
        pdf.text("monitored", cardX + 3, cardStartY + 26.5);
        
        // Card 3: Analysis Period
        cardX += cardWidth + 5;
        pdf.setFillColor(100, 116, 139, 0.05); // secondary
        pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
        
        pdf.setFillColor(226, 232, 240); // secondary/10
        pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
        
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text("📅", cardX + 5, cardStartY + 9);
        
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text("Analysis Period", cardX + 3, cardStartY + 17);
        
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(0, 0, 0);
        const dateText = `${reconciliationData.readingsPeriod || 'All Data'}`;
        pdf.text(dateText, cardX + 3, cardStartY + 23, { maxWidth: cardWidth - 6 });
        
        pdf.setFontSize(6);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 116, 139);
        pdf.text("date range", cardX + 3, cardStartY + 26.5);
        
        // Card 4: Total Consumption
        cardX += cardWidth + 5;
        pdf.setFillColor(59, 130, 246, 0.05); // primary
        pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
        
        pdf.setFillColor(219, 234, 254); // primary/10
        pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
        
        pdf.setFontSize(8);
        pdf.setTextColor(59, 130, 246);
        pdf.text("⚡", cardX + 5, cardStartY + 9);
        
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text("Total Consumption", cardX + 3, cardStartY + 17);
        
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${formatNumber(kpiTotalConsumption)} kWh`, cardX + 3, cardStartY + 23, { maxWidth: cardWidth - 6 });
        
        pdf.setFontSize(6);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 116, 139);
        pdf.text("energy used", cardX + 3, cardStartY + 26.5);
        
        yPos += cardHeight + 10;
        pdf.setTextColor(0, 0, 0);
        
        addSpacer(5);
        
        // Render chart sections (if available)
        renderSection('meter-type-chart');
        renderSection('consumption-chart');
        
        addSubsectionHeading("Audit Period");
        addText(`${format(new Date(reconciliationData.readingsPeriod.split(' - ')[0]), 'dd MMM yyyy')} - ${format(new Date(reconciliationData.readingsPeriod.split(' - ')[1]), 'dd MMM yyyy')}`);
        addSpacer(5);
        
        addSubsectionHeading("Metering Infrastructure");
        addText(`Total Meters Analyzed: ${reconciliationData.meterCount}`);
        addSpacer(8);
        
        // Section 5: Document & Invoice Validation (if documents available)
        const docValidationContent = getSectionContent('document-validation');
        if (docValidationContent) {
          addSectionHeading("5. DOCUMENT & INVOICE VALIDATION", 16, true);
          renderSection('document-validation');
          addSpacer(8);
        }
        
        // Section 6: Reconciliation Results
        addSectionHeading("6. RECONCILIATION RESULTS", 16, true);
        renderSection('reconciliation-results');
        addSpacer(5);
        
        addSubsectionHeading("Basic Reconciliation Metrics");
        
        const basicMetricsRows = [
          ["Total Supply", `${formatNumber(parseFloat(reconciliationData.totalSupply))} kWh`],
          ["Distribution Total", `${formatNumber(parseFloat(reconciliationData.distributionTotal))} kWh`],
          ["Recovery Rate", `${formatNumber(parseFloat(reconciliationData.recoveryRate))}%`],
          ["Variance", `${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${formatNumber(parseFloat(reconciliationData.variance))} kWh (${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variancePercentage}%)`]
        ];
        
        addTable(["Metric", "Value"], basicMetricsRows, [100, 70]);
        addSpacer(5);
        
        // KPI Indicators
        addSubsectionHeading("Data Collection KPIs");
        
        // Calculate KPI stats from meter data
        const totalReadingsCount = meterData.reduce((sum: number, meter: any) => sum + (meter.readingsCount || 0), 0);
        const totalMetersCount = meterData.length;
        const totalConsumption = meterData.reduce((sum: number, meter: any) => sum + (parseFloat(meter.totalKwh) || 0), 0);
        
        const kpiRows = [
          ["Total Data Points Reviewed", totalReadingsCount.toLocaleString()],
          ["Active Meters Analyzed", totalMetersCount.toString()],
          ["Total Consumption", `${formatNumber(totalConsumption)} kWh`],
          ["Average Readings per Meter", totalMetersCount > 0 ? Math.round(totalReadingsCount / totalMetersCount).toString() : "0"]
        ];
        
        addTable(["KPI Indicator", "Value"], kpiRows, [100, 70]);
        addSpacer(8);
        
        // CSV Column Aggregations (if available)
        if (csvColumnAggregations && Object.keys(csvColumnAggregations).length > 0) {
          addSubsectionHeading("CSV Column Aggregations");
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
        
        // Section 7: Cost Analysis (if available)
        const costAnalysisContent = getSectionContent('cost-analysis');
        if (costAnalysisContent) {
          addSectionHeading("7. COST ANALYSIS", 16, true);
          renderSection('cost-analysis');
          addSpacer(8);
        }
        
        // Section 8: Findings & Anomalies
        addSectionHeading("8. FINDINGS & ANOMALIES", 16, true);
        renderSection('findings-anomalies');
        addSpacer(5);
        
        // Anomalies detail (if any)
        if (anomalies.length > 0) {
          addSubsectionHeading("Detected Anomalies");
          const anomalySummaryRows = anomalies.slice(0, 10).map((a: any, idx: number) => [
            `${idx + 1}`,
            a.severity,
            a.meter || "General",
            a.description.substring(0, 60) + (a.description.length > 60 ? "..." : "")
          ]);
          addTable(["#", "Severity", "Meter", "Description"], anomalySummaryRows, [10, 25, 35, 100]);
          addSpacer(8);
        }
        
        // Section 9: Recommendations
        addSectionHeading("9. RECOMMENDATIONS", 16, true);
        renderSection('recommendations');
        addSpacer(8);
        
        // Add footer and page number to last page
        addFooter();
        addPageNumber();
        
        const pdfBlob = pdf.output('blob');
        const url = URL.createObjectURL(pdfBlob);
        resolve(url);
      }, 100);
    });
  };

  const generateMarkdownPreview = async () => {
    if (selectedFolderPaths.length === 0) {
      toast.error("Please select at least one document folder");
      return;
    }

    if (!reconciliationRun && selectedReconciliationIds.length === 0) {
      toast.error("Please select at least one reconciliation run");
      return;
    }

    if (!selectedSchematicId) {
      toast.error("Please select a schematic");
      return;
    }

    setIsGeneratingPreview(true);
    setGenerationProgress(0);
    setGenerationStatus("Initializing...");
    
    // Initialize batch statuses
    const initialBatches: BatchStatus[] = [
      {
        batchNumber: 1,
        status: 'pending',
        sections: [
          { id: 'executive-summary', name: 'Executive Summary', status: 'pending' },
          { id: 'site-infrastructure', name: 'Site Infrastructure', status: 'pending' },
          { id: 'tariff-configuration', name: 'Tariff Configuration', status: 'pending' }
        ]
      },
      {
        batchNumber: 2,
        status: 'pending',
        sections: [
          { id: 'metering-data-analysis', name: 'Metering Data Analysis', status: 'pending' },
          { id: 'document-validation', name: 'Document & Invoice Validation', status: 'pending' },
          { id: 'reconciliation-results', name: 'Reconciliation Results', status: 'pending' }
        ]
      },
      {
        batchNumber: 3,
        status: 'pending',
        sections: [
          { id: 'cost-analysis', name: 'Cost Analysis', status: 'pending' },
          { id: 'findings-anomalies', name: 'Findings & Anomalies', status: 'pending' },
          { id: 'recommendations', name: 'Recommendations', status: 'pending' }
        ]
      }
    ];
    setBatchStatuses(initialBatches);
    setCurrentBatch(undefined);

    try {

      // 1. Fetch reconciliation run data
      setGenerationProgress(10);
      setGenerationStatus("Loading reconciliation data...");
      
      let allReconciliations: any[] = [];
      if (reconciliationRun) {
        allReconciliations = [reconciliationRun];
      } else if (selectedReconciliationIds.length > 0) {
        const { data: runData, error: runError } = await supabase
          .from("reconciliation_runs")
          .select(`
            *,
            reconciliation_meter_results(*)
          `)
          .in("id", selectedReconciliationIds)
          .order("date_from", { ascending: true });

        if (runError) throw runError;
        allReconciliations = runData || [];
      }

      if (allReconciliations.length === 0) {
        throw new Error("No reconciliation runs found");
      }

      // Aggregate reconciliation data
      const selectedReconciliation = {
        ...allReconciliations[0],
        runs: allReconciliations,
        isMultiPeriod: allReconciliations.length > 1,
        bulk_total: allReconciliations.reduce((sum, r) => sum + (r.bulk_total || 0), 0),
        solar_total: allReconciliations.reduce((sum, r) => sum + (r.solar_total || 0), 0),
        tenant_total: allReconciliations.reduce((sum, r) => sum + (r.tenant_total || 0), 0),
        total_supply: allReconciliations.reduce((sum, r) => sum + (r.total_supply || 0), 0),
        date_from: allReconciliations[0]?.date_from,
        date_to: allReconciliations[allReconciliations.length - 1]?.date_to,
        reconciliation_meter_results: allReconciliations.flatMap(r => r.reconciliation_meter_results || [])
      };

      // Store reconciliation date range for KPI filtering
      setReconciliationDateFrom(selectedReconciliation.date_from);
      setReconciliationDateTo(selectedReconciliation.date_to);

      // 2. Fetch site details with supply authority
      setGenerationProgress(15);
      setGenerationStatus("Loading site details...");
      
      const { data: siteData, error: siteError } = await supabase
        .from("sites")
        .select(`
          *,
          supply_authorities(*),
          clients(name)
        `)
        .eq("id", siteId)
        .single();

      if (siteError) throw siteError;
      if (!siteData) throw new Error("Site not found");

      const siteDetails = {
        address: siteData.address,
        councilConnectionPoint: siteData.council_connection_point,
        supplyAuthorityName: siteData.supply_authorities?.name,
        supplyAuthorityRegion: siteData.supply_authorities?.region,
        nersaIncrease: siteData.supply_authorities?.nersa_increase_percentage,
        clientName: siteData.clients?.name
      };

      // 3. Fetch all schematics for the site
      setGenerationProgress(18);
      setGenerationStatus("Loading schematics...");
      
      const { data: allSchematics, error: schematicsError } = await supabase
        .from("schematics")
        .select("id, name, description, page_number, total_pages, file_type")
        .eq("site_id", siteId)
        .order("name", { ascending: true });

      if (schematicsError) throw schematicsError;

      const schematics = allSchematics || [];

      // 4. Fetch selected schematic for image
      const { data: selectedSchematic, error: schematicError } = await supabase
        .from("schematics")
        .select("*")
        .eq("id", selectedSchematicId)
        .single();

      if (schematicError) throw schematicError;
      if (!selectedSchematic) throw new Error("Selected schematic not found");


      // 3. Fetch documents from ALL selected folders
      setGenerationProgress(30);
      setGenerationStatus("Loading document extractions...");
      
      const allDocuments: any[] = [];
      for (const selectedPath of selectedFolderPaths) {
        const folderPath = selectedPath === "/" ? "" : selectedPath;
        const { data: docs, error: docsError } = await supabase
          .from("site_documents")
          .select(`
            *,
            document_extractions(*)
          `)
          .eq("site_id", siteId)
          .eq("folder_path", folderPath)
          .eq("extraction_status", "completed");

        if (docsError) throw docsError;
        if (docs) allDocuments.push(...docs);
      }

      // Deduplicate by document ID
      const documents = [...new Map(allDocuments.map(d => [d.id, d])).values()];

      const documentExtractions = documents?.map(doc => ({
        fileName: doc.file_name,
        documentType: doc.document_type,
        extraction: doc.document_extractions?.[0]
      })).filter(d => d.extraction) || [];

      // 4. Fetch tariff structures for all meters
      setGenerationProgress(35);
      setGenerationStatus("Loading tariff data...");
      
      // Get unique tariff structure IDs from meters
      const tariffIds = [...new Set(
        selectedReconciliation.reconciliation_meter_results
          ?.map((r: any) => r.tariff_structure_id)
          .filter((id): id is string => Boolean(id))
      )] as string[];

      let tariffStructures: any[] = [];
      if (tariffIds.length > 0) {
        const { data: tariffs, error: tariffsError } = await supabase
          .from("tariff_structures")
          .select(`
            *,
            tariff_blocks(*),
            tariff_charges(*),
            tariff_time_periods(*),
            supply_authorities(name, region, nersa_increase_percentage)
          `)
          .in("id", tariffIds);

        if (!tariffsError && tariffs) {
          tariffStructures = tariffs;
        }
      }

      // 5. Prepare load profile summary from reconciliation meter results
      setGenerationProgress(38);
      setGenerationStatus("Analyzing load profiles...");
      
      const loadProfiles = selectedReconciliation.reconciliation_meter_results?.map((result: any) => ({
        meterId: result.meter_id,
        meterNumber: result.meter_number,
        meterName: result.meter_name,
        totalKwh: result.total_kwh,
        positiveKwh: result.total_kwh_positive,
        negativeKwh: result.total_kwh_negative,
        readingsCount: result.readings_count,
        avgConsumption: result.readings_count > 0 ? (result.total_kwh / result.readings_count) : 0
      })).filter((lp: any) => lp.readingsCount > 0) || [];

      // 6. Prepare cost analysis from reconciliation data
      const costAnalysis = {
        totalCost: selectedReconciliation.grid_supply_cost + selectedReconciliation.solar_cost,
        gridSupplyCost: selectedReconciliation.grid_supply_cost,
        solarCost: selectedReconciliation.solar_cost,
        tenantRevenue: selectedReconciliation.total_revenue,
        netPosition: selectedReconciliation.total_revenue - (selectedReconciliation.grid_supply_cost + selectedReconciliation.solar_cost),
        avgCostPerKwh: selectedReconciliation.avg_cost_per_kwh,
        revenueEnabled: selectedReconciliation.revenue_enabled,
        costByType: {
          bulk: selectedReconciliation.reconciliation_meter_results
            ?.filter((r: any) => r.meter_type === 'bulk_meter')
            .reduce((sum: number, r: any) => sum + (r.total_cost || 0), 0) || 0,
          solar: selectedReconciliation.reconciliation_meter_results
            ?.filter((r: any) => r.meter_type === 'solar')
            .reduce((sum: number, r: any) => sum + (r.total_cost || 0), 0) || 0,
          tenant: selectedReconciliation.reconciliation_meter_results
            ?.filter((r: any) => r.meter_type === 'tenant_meter')
            .reduce((sum: number, r: any) => sum + (r.total_cost || 0), 0) || 0
        },
        costByComponent: {
          energy: selectedReconciliation.reconciliation_meter_results
            ?.reduce((sum: number, r: any) => sum + (r.energy_cost || 0), 0) || 0,
          demand: selectedReconciliation.reconciliation_meter_results
            ?.reduce((sum: number, r: any) => sum + (r.demand_charges || 0), 0) || 0,
          fixed: selectedReconciliation.reconciliation_meter_results
            ?.reduce((sum: number, r: any) => sum + (r.fixed_charges || 0), 0) || 0
        }
      };

      // 7. Use meter data from reconciliation results
      setGenerationProgress(40);
      setGenerationStatus("Processing meter data...");
      
      const meterData = selectedReconciliation.reconciliation_meter_results?.map((result: any) => ({
        id: result.meter_id,
        meter_number: result.meter_number,
        name: result.meter_name,
        meter_type: result.meter_type,
        location: result.location,
        totalKwh: result.total_kwh,
        columnTotals: result.column_totals || {},
        columnMaxValues: result.column_max_values || {},
        readingsCount: result.readings_count,
        assignment: result.assignment
      })) || [];

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
      setGenerationProgress(50);
      setGenerationStatus("Detecting anomalies...");
      
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

      // 7. Load and compress schematic image
      setGenerationProgress(60);
      setGenerationStatus("Loading schematic image...");
      
      let schematicImageBase64 = null;

      if (selectedSchematic?.converted_image_path) {
        try {
          const { data: imageData } = await supabase.storage
            .from("client-files")
            .download(selectedSchematic.converted_image_path);

          if (imageData) {
            // Create an image element to compress
            const img = new Image();
            const blob = imageData;
            const url = URL.createObjectURL(blob);
            
            await new Promise((resolve, reject) => {
              img.onload = () => {
                // Create canvas for compression
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Set max dimensions (reduce resolution significantly for PDF)
                const maxWidth = 1200;
                const maxHeight = 800;
                let width = img.width;
                let height = img.height;
                
                // Calculate new dimensions maintaining aspect ratio
                if (width > maxWidth || height > maxHeight) {
                  const ratio = Math.min(maxWidth / width, maxHeight / height);
                  width = width * ratio;
                  height = height * ratio;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw and compress image as JPEG with quality 0.6
                ctx?.drawImage(img, 0, 0, width, height);
                schematicImageBase64 = canvas.toDataURL('image/jpeg', 0.6);
                
                URL.revokeObjectURL(url);
                resolve(null);
              };
              img.onerror = reject;
              img.src = url;
            });
          }
        } catch (err) {
          console.error("Error loading schematic image:", err);
        }
      }

      // 8. Prepare meter breakdown from reconciliation data
      const sortMetersByType = (meters: any[]) => {
        return meters.sort((a, b) => {
          const typeOrder = { bulk_meter: 1, other: 2, check_meter: 3, tenant_meter: 4 };
          const aOrder = typeOrder[a.meter_type as keyof typeof typeOrder] || 5;
          const bOrder = typeOrder[b.meter_type as keyof typeof typeOrder] || 5;
          if (aOrder !== bOrder) return aOrder - bOrder;
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
        assignment: m.assignment
      }));

      // 9. Prepare meter hierarchy from reconciliation data
      const meterHierarchy = meterData.map(m => ({
        meterNumber: m.meter_number,
        name: m.name,
        type: m.meter_type,
        location: m.location,
        consumption: m.totalKwh.toFixed(2),
        readingsCount: m.readingsCount,
        columnTotals: m.columnTotals || {},
        columnMaxValues: m.columnMaxValues || {},
        assignment: m.assignment
      }));

      // Calculate CSV column aggregations from meter data
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

      // Prepare selected CSV columns configuration
      const selectedCsvColumns = Object.entries(columnConfigs)
        .filter(([_, config]) => config.selected)
        .map(([columnName, config]) => ({
          columnName,
          aggregation: config.aggregation,
          multiplier: config.multiplier
        }));

      // 10. Generate data-only sections (AI DISABLED)
      setGenerationProgress(70);
      setGenerationStatus("Formatting report data...");
      
      // Mark all batches as complete immediately
      setBatchStatuses(prev => prev.map(b => ({
        ...b,
        status: 'complete' as const,
        sections: b.sections.map(s => ({ ...s, status: 'success' as const }))
      })));

      // Generate sections from real data without AI interpretation
      const formatNumber = (value: number, decimals: number = 2): string => {
        return value.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      };

      const reportData = {
        clientName: siteDetails.clientName,
        sections: {
          executiveSummary: `### Report Summary

| Metric | Value |
|--------|-------|
| Site | ${siteName} |
| Client | ${siteDetails.clientName || 'N/A'} |
| Audit Period | ${format(new Date(selectedReconciliation.date_from), "dd MMM yyyy")} - ${format(new Date(selectedReconciliation.date_to), "dd MMM yyyy")} |
| Grid Supply | ${formatNumber(selectedReconciliation.bulk_total)} kWh |
| Solar Generation | ${formatNumber(selectedReconciliation.solar_total)} kWh |
| Total Supply | ${formatNumber(selectedReconciliation.total_supply)} kWh |
| Distribution | ${formatNumber(selectedReconciliation.tenant_total)} kWh |
| Variance | ${formatNumber(selectedReconciliation.discrepancy)} kWh (${formatNumber((selectedReconciliation.discrepancy / selectedReconciliation.total_supply) * 100)}%) |
| Recovery Rate | ${formatNumber(selectedReconciliation.recovery_rate)}% |`,

          siteInfrastructure: `### Meter Summary

| Meter Type | Count |
|------------|-------|
| Bulk Meters | ${reconciliationData.councilBulkCount} |
| Solar Meters | ${reconciliationData.solarCount} |
| Tenant Meters | ${reconciliationData.distributionCount} |
| Check Meters | ${reconciliationData.checkMeterCount} |
| **Total** | **${reconciliationData.meterCount}** |

### All Meters

| Meter Number | Name | Type | Location | Consumption (kWh) | Readings |
|--------------|------|------|----------|-------------------|----------|
${meterBreakdown.map(m => `| ${m.meterNumber} | ${m.name || 'N/A'} | ${m.type} | ${m.location || 'N/A'} | ${formatNumber(parseFloat(m.consumption))} | ${m.readingsCount} |`).join('\n')}`,

          tariffConfiguration: `### Tariff Structures

${tariffStructures.length > 0 ? tariffStructures.map(tariff => `
**${tariff.name}**
- Type: ${tariff.tariff_type}
- Voltage Level: ${tariff.voltage_level || 'N/A'}
- Effective From: ${format(new Date(tariff.effective_from), "dd MMM yyyy")}
- Effective To: ${tariff.effective_to ? format(new Date(tariff.effective_to), "dd MMM yyyy") : 'Current'}
- Uses TOU: ${tariff.uses_tou ? 'Yes' : 'No'}

${tariff.tariff_blocks?.length > 0 ? `**Energy Blocks:**
| Block | From (kWh) | To (kWh) | Rate (c/kWh) |
|-------|------------|----------|--------------|
${tariff.tariff_blocks.map(block => `| ${block.block_number} | ${formatNumber(block.kwh_from, 0)} | ${block.kwh_to ? formatNumber(block.kwh_to, 0) : 'Unlimited'} | ${formatNumber(block.energy_charge_cents / 100, 4)} |`).join('\n')}` : ''}

${tariff.tariff_charges?.length > 0 ? `**Other Charges:**
| Type | Description | Amount | Unit |
|------|-------------|--------|------|
${tariff.tariff_charges.map(charge => `| ${charge.charge_type} | ${charge.description || 'N/A'} | ${formatNumber(charge.charge_amount)} | ${charge.unit} |`).join('\n')}` : ''}
`).join('\n') : 'No tariff structures configured.'}`,

          meteringDataAnalysis: `### Consumption Analysis

| Meter Number | Name | Type | Total kWh | Readings |
|--------------|------|------|-----------|----------|
${meterData.slice(0, 20).map(m => `| ${m.meter_number} | ${m.name || 'N/A'} | ${m.meter_type} | ${formatNumber(m.totalKwh)} | ${m.readingsCount} |`).join('\n')}
${meterData.length > 20 ? `\n*... and ${meterData.length - 20} more meters*` : ''}

${Object.keys(csvColumnAggregations).length > 0 ? `### Additional Metrics

| Metric | Aggregation | Value |
|--------|-------------|-------|
${Object.entries(csvColumnAggregations).map(([col, data]) => `| ${col} | ${data.aggregation.toUpperCase()} | ${formatNumber(data.value)}${data.multiplier !== 1 ? ` (×${data.multiplier})` : ''} |`).join('\n')}` : ''}`,

          documentValidation: documentExtractions.length > 0 ? `### Documents Analyzed

| Document | Type | Period | Amount | Confidence |
|----------|------|--------|--------|------------|
${documentExtractions.map(doc => `| ${doc.fileName} | ${doc.documentType} | ${doc.extraction?.period_start ? format(new Date(doc.extraction.period_start), "MMM yyyy") : 'N/A'} | ${doc.extraction?.total_amount ? 'R ' + formatNumber(doc.extraction.total_amount) : 'N/A'} | ${doc.extraction?.confidence_score ? (doc.extraction.confidence_score * 100).toFixed(0) + '%' : 'N/A'} |`).join('\n')}

**Total Documents Analyzed:** ${documentExtractions.length}` : 'No documents with extractions found.',

          reconciliationResults: `### Supply vs Distribution

| Category | Value (kWh) |
|----------|-------------|
| Grid Supply (Bulk) | ${formatNumber(selectedReconciliation.bulk_total)} |
| Solar Generation | ${formatNumber(selectedReconciliation.solar_total)} |
| **Total Supply** | **${formatNumber(selectedReconciliation.total_supply)}** |
| Distribution Total | ${formatNumber(selectedReconciliation.tenant_total)} |
| **Variance** | **${formatNumber(selectedReconciliation.discrepancy)} (${formatNumber((selectedReconciliation.discrepancy / selectedReconciliation.total_supply) * 100)}%)** |
| **Recovery Rate** | **${formatNumber(selectedReconciliation.recovery_rate)}%** |

### Meter Results

| Meter | Type | Consumption (kWh) | Cost |
|-------|------|-------------------|------|
${selectedReconciliation.reconciliation_meter_results?.slice(0, 30).map((r: any) => `| ${r.meter_number} | ${r.meter_type} | ${formatNumber(r.total_kwh)} | ${r.total_cost ? 'R ' + formatNumber(r.total_cost) : 'N/A'} |`).join('\n')}
${selectedReconciliation.reconciliation_meter_results?.length > 30 ? `\n*... and ${selectedReconciliation.reconciliation_meter_results.length - 30} more meters*` : ''}`,

          costAnalysis: costAnalysis.revenueEnabled ? `### Cost Breakdown by Type

| Type | Cost (R) |
|------|----------|
| Bulk Supply | ${formatNumber(costAnalysis.costByType.bulk)} |
| Solar | ${formatNumber(costAnalysis.costByType.solar)} |
| Tenant | ${formatNumber(costAnalysis.costByType.tenant)} |

### Cost Breakdown by Component

| Component | Cost (R) |
|-----------|----------|
| Energy Charges | ${formatNumber(costAnalysis.costByComponent.energy)} |
| Demand Charges | ${formatNumber(costAnalysis.costByComponent.demand)} |
| Fixed Charges | ${formatNumber(costAnalysis.costByComponent.fixed)} |
| **Total Cost** | **${formatNumber(costAnalysis.totalCost)}** |

### Financial Summary

| Item | Amount (R) |
|------|------------|
| Total Supply Cost | ${formatNumber(costAnalysis.totalCost)} |
| Tenant Revenue | ${formatNumber(costAnalysis.tenantRevenue)} |
| **Net Position** | **${formatNumber(costAnalysis.netPosition)}** |
| Avg Cost per kWh | ${formatNumber(costAnalysis.avgCostPerKwh, 4)} |` : `Cost analysis requires revenue to be enabled in reconciliation settings.`,

          findingsAnomalies: anomalies.length > 0 ? `### Anomalies Detected

| Severity | Meter | Description |
|----------|-------|-------------|
${anomalies.map(a => `| ${a.severity} | ${a.meter || 'Site-wide'} | ${a.description} |`).join('\n')}

**Total Anomalies:** ${anomalies.length}
- Critical: ${anomalies.filter(a => a.severity === 'CRITICAL').length}
- High: ${anomalies.filter(a => a.severity === 'HIGH').length}
- Medium: ${anomalies.filter(a => a.severity === 'MEDIUM').length}
- Low: ${anomalies.filter(a => a.severity === 'LOW').length}` : 'No anomalies detected.',

          recommendations: `### Key Observations

${anomalies.length > 0 ? `- ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'} detected requiring attention` : '- No critical issues detected'}
- Recovery rate: ${formatNumber(selectedReconciliation.recovery_rate)}%
- Variance: ${formatNumber((selectedReconciliation.discrepancy / selectedReconciliation.total_supply) * 100)}%
- Total meters monitored: ${reconciliationData.meterCount}
- Documents analyzed: ${documentExtractions.length}`
        }
      };

      // Generate chart images for preview
      setGenerationProgress(85);
      setGenerationStatus("Generating chart visualizations...");
      
      const meterTypeChart = generateMeterTypeChart(meterData);
      const consumptionChart = generateConsumptionChart(meterData);

      // Store preview data with schematic and CSV aggregations
      setGenerationProgress(90);
      setGenerationStatus("Finalizing report...");
      
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
        csvColumnAggregations,
        chartImages: {
          meterTypeChart,
          consumptionChart
        }
      } as any);
      
      // Convert report data to editable markdown sections
      const sections: PdfSection[] = [];
      
      // Header section
      sections.push({
        id: 'header',
        title: 'Report Header',
        content: `# Energy Audit Report

**Client:** ${reportData?.clientName || siteName}
**Site:** ${siteName}
**Audit Period:** ${format(new Date(selectedReconciliation.date_from), "dd MMM yyyy")} - ${format(new Date(selectedReconciliation.date_to), "dd MMM yyyy")}
**Report Date:** ${format(new Date(), "dd MMM yyyy")}`,
        type: 'text',
        editable: true
      });
      
      if (reportData?.sections) {
        // Section 1: Executive Summary
        if (reportData.sections.executiveSummary) {
          sections.push({
            id: 'executive-summary',
            title: '1. Executive Summary',
            content: `## 1. Executive Summary\n\n${reportData.sections.executiveSummary}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 2: Site Infrastructure
        if (reportData.sections.siteInfrastructure) {
          sections.push({
            id: 'site-infrastructure',
            title: '2. Site Infrastructure',
            content: `## 2. Site Infrastructure\n\n${reportData.sections.siteInfrastructure}`,
            type: 'text',
            editable: true
          });
        }
        
        if (schematicImageBase64) {
          sections.push({
            id: 'schematic-image',
            title: 'Site Schematic Diagram',
            content: `### Site Schematic Diagram\n\n*Schematic diagram will be included in the final PDF*`,
            type: 'text',
            editable: false
          });
        }
        
        // Section 3: Tariff Configuration
        if (reportData.sections.tariffConfiguration) {
          sections.push({
            id: 'tariff-configuration',
            title: '3. Tariff Configuration',
            content: `## 3. Tariff Configuration\n\n${reportData.sections.tariffConfiguration}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 4: Metering Data Analysis
        if (reportData.sections.meteringDataAnalysis) {
          sections.push({
            id: 'metering-data-analysis',
            title: '4. Metering Data Analysis',
            content: `## 4. Metering Data Analysis\n\n${reportData.sections.meteringDataAnalysis}`,
            type: 'text',
            editable: true
          });
        }
        
        // Add chart images
        if (meterTypeChart) {
          sections.push({
            id: 'meter-type-chart',
            title: 'Meter Type Distribution',
            content: `![Meter Type Distribution](${meterTypeChart})`,
            type: 'chart',
            editable: false
          });
        }
        
        if (consumptionChart) {
          sections.push({
            id: 'consumption-chart',
            title: 'Top 10 Meters by Consumption',
            content: `![Top 10 Meters by Consumption](${consumptionChart})`,
            type: 'chart',
            editable: false
          });
        }
        
        // Section 5: Document & Invoice Validation (if available)
        if (reportData.sections.documentValidation) {
          sections.push({
            id: 'document-validation',
            title: '5. Document & Invoice Validation',
            content: `## 5. Document & Invoice Validation\n\n${reportData.sections.documentValidation}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 6: Reconciliation Results
        if (reportData.sections.reconciliationResults) {
          sections.push({
            id: 'reconciliation-results',
            title: '6. Reconciliation Results',
            content: `## 6. Reconciliation Results\n\n${reportData.sections.reconciliationResults}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 7: Cost Analysis (if available)
        if (reportData.sections.costAnalysis) {
          sections.push({
            id: 'cost-analysis',
            title: '7. Cost Analysis',
            content: `## 7. Cost Analysis\n\n${reportData.sections.costAnalysis}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 8: Findings & Anomalies
        if (reportData.sections.findingsAnomalies) {
          sections.push({
            id: 'findings-anomalies',
            title: '8. Findings & Anomalies',
            content: `## 8. Findings & Anomalies\n\n${reportData.sections.findingsAnomalies}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 9: Recommendations
        if (reportData.sections.recommendations) {
          sections.push({
            id: 'recommendations',
            title: '9. Recommendations',
            content: `## 9. Recommendations\n\n${reportData.sections.recommendations}`,
            type: 'text',
            editable: true
          });
        }
      }
      
      setEditableSections(sections);
      setIsEditingContent(true); // Go directly to editor
      setCurrentPage(1); // Reset to first page

      setGenerationProgress(100);
      setGenerationStatus("Complete!");
      toast.success("✓ Markdown preview generated - ready to edit!");

    } catch (error) {
      console.error("Error generating preview:", error);
      toast.error("Failed to generate preview");
      setGenerationProgress(0);
      setGenerationStatus("");
      
      // Mark current batch as failed
      if (currentBatch !== undefined) {
        setBatchStatuses(prev => prev.map(b => 
          b.batchNumber === currentBatch 
            ? { 
                ...b, 
                status: 'failed',
                sections: b.sections.map(s => ({ 
                  ...s, 
                  status: 'failed',
                  error: 'Generation interrupted'
                }))
              } 
            : b
        ));
      }
    } finally {
      setIsGeneratingPreview(false);
      setCurrentBatch(undefined);
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
          'site-infrastructure': reportData.sections.siteInfrastructure,
          'tariff-configuration': reportData.sections.tariffConfiguration,
          'metering-data-analysis': reportData.sections.meteringDataAnalysis,
          'document-validation': reportData.sections.documentValidation,
          'reconciliation-results': reportData.sections.reconciliationResults,
          'cost-analysis': reportData.sections.costAnalysis,
          'findings-anomalies': reportData.sections.findingsAnomalies,
          'recommendations': reportData.sections.recommendations
        };
        return sectionMap[sectionId] || '';
      };
      
      // Helper to render a section (handles both text and chart sections)
      const renderSection = (sectionId: string) => {
        const editedSection = editableSections.find(s => s.id === sectionId);
        
        // Check if content is a markdown image
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
        const imageMatch = editedSection?.content.match(imageRegex);
        
        if (imageMatch && editedSection?.type === 'chart') {
          // This is a chart image - render it
          const [_, altText, imageUrl] = imageMatch;
          
          try {
            // Check if we need a new page
            if (yPos > pageHeight - 150) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            const imgWidth = pageWidth - leftMargin - rightMargin;
            const imgHeight = 120;
            pdf.addImage(imageUrl, 'PNG', leftMargin, yPos, imgWidth, imgHeight);
            yPos += imgHeight + 5;
            
            // Add caption if available
            if (altText) {
              pdf.setFontSize(9);
              pdf.setFont("helvetica", "italic");
              pdf.text(altText, pageWidth / 2, yPos, { align: "center" });
              pdf.setFont("helvetica", "normal");
              yPos += 10;
            }
          } catch (err) {
            console.error(`Error adding chart image for ${sectionId}:`, err);
            addText(`[Chart image rendering error: ${err instanceof Error ? err.message : 'Unknown error'}]`, 10, false, 0);
          }
        } else if (editedSection && editedSection.type === 'chart') {
          // Legacy: For chart sections with JSON content, parse and render the chart
          try {
            const chartData = JSON.parse(editedSection.content);
            console.log(`Rendering chart section ${sectionId}:`, chartData);
            
            if (chartData.type === 'pie') {
              drawPieChart(chartData);
            } else if (chartData.type === 'bar') {
              drawBarChart(chartData);
            }
          } catch (e) {
            console.error(`Failed to render chart section ${sectionId}:`, e);
            addText(`[Chart rendering error: ${e instanceof Error ? e.message : 'Unknown error'}]`, 10, false, 0);
          }
        } else {
          // For text sections, render content (which may contain embedded charts)
          const content = getSectionContent(sectionId);
          if (content) {
            renderContent(content);
          }
        }
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

      // 11. Generate PDF with template styling and compression
      toast.info("Generating PDF...");
      const pdf = new jsPDF({
        compress: true // Enable PDF compression
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      // Template styling constants
      const blueBarWidth = 15; // Width of left blue bar
      const leftMargin = 30; // Left margin (accounting for blue bar)
      const rightMargin = 20;
      const topMargin = 15;
      const bottomMargin = 15;
      
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

      // Helper to parse markdown tables
      const parseMarkdownTable = (text: string): { headers: string[], rows: string[][] } | null => {
        const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
        if (lines.length < 3) return null; // Need header, separator, and at least one row
        
        const parseRow = (line: string) => 
          line.split('|')
            .slice(1, -1) // Remove empty first and last elements from split
            .map(cell => cell.trim());
        
        const headers = parseRow(lines[0]);
        const rows = lines.slice(2).map(parseRow); // Skip separator line
        
        return headers.length > 0 && rows.length > 0 ? { headers, rows } : null;
      };
      
      // Helper to draw pie charts
      const drawPieChart = (chartData: any) => {
        const data = chartData.data?.datasets?.[0]?.data || [];
        const labels = chartData.data?.labels || [];
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        
        if (data.length === 0) return;

        // Check if we need a new page
        if (yPos > pageHeight - bottomMargin - 100) {
          addFooter();
          addPageNumber();
          pdf.addPage();
          yPos = topMargin;
        }

        const centerX = pageWidth / 2;
        const centerY = yPos + 40;
        const radius = 30;
        
        const total = data.reduce((sum: number, val: number) => sum + val, 0);
        let currentAngle = -Math.PI / 2; // Start at top

        // Draw pie slices
        data.forEach((value: number, index: number) => {
          const sliceAngle = (value / total) * 2 * Math.PI;
          const endAngle = currentAngle + sliceAngle;
          
          // Parse color
          const color = colors[index % colors.length];
          const r = parseInt(color.slice(1, 3), 16);
          const g = parseInt(color.slice(3, 5), 16);
          const b = parseInt(color.slice(5, 7), 16);
          
          pdf.setFillColor(r, g, b);
          
          // Draw wedge using triangles approximation
          const segments = Math.max(3, Math.ceil(sliceAngle / (Math.PI / 18)));
          const segmentAngle = sliceAngle / segments;
          
          for (let i = 0; i < segments; i++) {
            const angle1 = currentAngle + (i * segmentAngle);
            const angle2 = currentAngle + ((i + 1) * segmentAngle);
            
            const x1 = centerX + radius * Math.cos(angle1);
            const y1 = centerY + radius * Math.sin(angle1);
            const x2 = centerX + radius * Math.cos(angle2);
            const y2 = centerY + radius * Math.sin(angle2);
            
            pdf.triangle(centerX, centerY, x1, y1, x2, y2, 'F');
          }
          
          currentAngle = endAngle;
        });

        // Draw legend
        yPos = centerY + radius + 10;
        labels.forEach((label: string, index: number) => {
          const color = colors[index % colors.length];
          const r = parseInt(color.slice(1, 3), 16);
          const g = parseInt(color.slice(3, 5), 16);
          const b = parseInt(color.slice(5, 7), 16);
          
          pdf.setFillColor(r, g, b);
          pdf.rect(leftMargin, yPos - 3, 5, 5, 'F');
          pdf.setFontSize(9);
          pdf.setTextColor(60, 60, 60);
          const percentage = ((data[index] / total) * 100).toFixed(1);
          pdf.text(`${label}: ${data[index].toLocaleString()} (${percentage}%)`, leftMargin + 8, yPos);
          yPos += 6;
        });
        
        pdf.setTextColor(0, 0, 0);
        yPos += 5;
      };

      // Helper to draw bar charts
      const drawBarChart = (chartData: any) => {
        const data = chartData.data?.datasets?.[0]?.data || [];
        const labels = chartData.data?.labels || [];
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        
        if (data.length === 0) return;

        // Check if we need a new page
        if (yPos > pageHeight - bottomMargin - 100) {
          addFooter();
          addPageNumber();
          pdf.addPage();
          yPos = topMargin;
        }

        const chartWidth = pageWidth - leftMargin - rightMargin - 20;
        const chartHeight = 60;
        const chartX = leftMargin + 10;
        const chartY = yPos;

        const maxValue = Math.max(...data);
        const barWidth = chartWidth / data.length * 0.6;
        const spacing = chartWidth / data.length;

        // Draw bars
        data.forEach((value: number, index: number) => {
          const barHeight = (value / maxValue) * chartHeight;
          const barX = chartX + index * spacing + (spacing - barWidth) / 2;
          const barY = chartY + chartHeight - barHeight;
          
          const color = colors[index % colors.length];
          const r = parseInt(color.slice(1, 3), 16);
          const g = parseInt(color.slice(3, 5), 16);
          const b = parseInt(color.slice(5, 7), 16);
          
          pdf.setFillColor(r, g, b);
          pdf.rect(barX, barY, barWidth, barHeight, 'F');
          
          // Draw value on top
          pdf.setFontSize(8);
          pdf.setTextColor(60, 60, 60);
          pdf.text(value.toLocaleString(), barX + barWidth / 2, barY - 2, { align: 'center' });
          
          // Draw label below
          pdf.setFontSize(7);
          const labelText = labels[index] || `Item ${index + 1}`;
          const labelLines = pdf.splitTextToSize(labelText, barWidth + 10);
          pdf.text(labelLines, barX + barWidth / 2, chartY + chartHeight + 5, { 
            align: 'center'
          });
        });

        // Draw axes
        pdf.setDrawColor(200, 200, 200);
        pdf.line(chartX, chartY + chartHeight, chartX + chartWidth, chartY + chartHeight);
        pdf.line(chartX, chartY, chartX, chartY + chartHeight);
        
        pdf.setTextColor(0, 0, 0);
        yPos += chartHeight + 25;
      };
      
      // Helper to render content with markdown support
      const renderContent = (text: string, fontSize: number = 9, indent: number = 0) => {
        if (!text || text.trim() === '') return;
        
        // Check for JSON chart blocks (with or without code fences)
        // First try code-fenced JSON: ```json {...} ```
        let chartMatch = text.match(/```json\s*(\{[\s\S]*?"type":\s*"(pie|bar)"[\s\S]*?\})\s*```/);
        
        // If no code fence, try standalone JSON object
        if (!chartMatch) {
          chartMatch = text.match(/(\{[\s\S]*?"type":\s*"(pie|bar)"[\s\S]*?\})/);
        }
        
        if (chartMatch) {
          const chartJson = chartMatch[1];
          const beforeChart = text.substring(0, chartMatch.index);
          const afterChart = text.substring((chartMatch.index || 0) + chartMatch[0].length);
          
          // Render text before chart
          if (beforeChart.trim()) {
            renderContent(beforeChart, fontSize, indent);
          }
          
          // Parse and render chart
          try {
            const chartData = JSON.parse(chartJson);
            if (chartData.type === 'pie') {
              drawPieChart(chartData);
            } else if (chartData.type === 'bar') {
              drawBarChart(chartData);
            }
          } catch (e) {
            console.error('Failed to parse chart JSON:', e);
            addText(`[Chart rendering error: ${e instanceof Error ? e.message : 'Unknown error'}]`, fontSize, false, indent);
          }
          
          // Render text after chart (recursively)
          if (afterChart.trim()) {
            renderContent(afterChart, fontSize, indent);
          }
          return;
        }
        
        // Check for markdown table
        const tableMatch = text.match(/\|[^\n]+\|\n\|[-:\s|]+\|\n(\|[^\n]+\|\n?)+/);
        if (tableMatch) {
          const tableText = tableMatch[0];
          const beforeTable = text.substring(0, tableMatch.index);
          const afterTable = text.substring((tableMatch.index || 0) + tableText.length);
          
          // Render text before table
          if (beforeTable.trim()) {
            addText(beforeTable, fontSize, false, indent);
            yPos += 3;
          }
          
          // Parse and render table
          const parsed = parseMarkdownTable(tableText);
          if (parsed) {
            addTable(parsed.headers, parsed.rows);
            yPos += 5;
          }
          
          // Render text after table (recursively in case of multiple tables)
          if (afterTable.trim()) {
            renderContent(afterTable, fontSize, indent);
          }
          return;
        }
        
        // No table or chart found, render as text
        addText(text, fontSize, false, indent);
      };

      // Helper function to add text with wrapping
      const addText = (text: string, fontSize: number = 9, isBold: boolean = false, indent: number = 0) => {
        const cleanedText = cleanMarkdown(text);
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", isBold ? "bold" : "normal");
        const maxWidth = pageWidth - leftMargin - rightMargin - indent;
        const lines = pdf.splitTextToSize(cleanedText, maxWidth);
        
        lines.forEach((line: string) => {
          if (yPos > pageHeight - bottomMargin - 15) {
            addFooter();
            addPageNumber();
            pdf.addPage();
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
          addFooter();
          addPageNumber();
          pdf.addPage();
          yPos = topMargin;
        }
        
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text(bullet, leftMargin + indent, yPos);
        
        const maxWidth = pageWidth - leftMargin - rightMargin - indent - 5;
        const lines = pdf.splitTextToSize(text, maxWidth);
        lines.forEach((line: string, index: number) => {
          if (index > 0 && yPos > pageHeight - bottomMargin - 15) {
            addFooter();
            addPageNumber();
            pdf.addPage();
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
          addFooter();
          addPageNumber();
          pdf.addPage();
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
            addFooter();
            addPageNumber();
            pdf.addPage();
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

      const addSectionHeading = (text: string, fontSize: number = 12, forceNewPage: boolean = false) => {
        // Force new page for major sections
        if (forceNewPage) {
          addFooter();
          addPageNumber();
          pdf.addPage();
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
          addFooter();
          addPageNumber();
          pdf.addPage();
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
      pdf.setFontSize(24);
      pdf.setFont("helvetica", "bold");
      pdf.text(previewSiteName.toUpperCase(), pageWidth / 2, 80, { align: "center" });
      
      pdf.setFontSize(14);
      pdf.text("METERING", pageWidth / 2, 100, { align: "center" });
      
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      pdf.text("Metering Audit", pageWidth / 2, 115, { align: "center" });
      
      // Audit Period section
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text("Audit Period", pageWidth / 2, 155, { align: "center" });
      pdf.setFont("helvetica", "bold");
      pdf.text(
        reconciliationData?.readingsPeriod || "All Available Readings",
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
      pdf.setFontSize(12);
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
      
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
      
      tocEntries.forEach((entry, index) => {
        if (yPos > pageHeight - bottomMargin - 10) {
          addFooter();
          addPageNumber();
          pdf.addPage();
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

      // Start main content (continue on next page when needed)
      yPos = topMargin;

      // Section 1: Executive Summary
      addSectionHeading("1. EXECUTIVE SUMMARY", 16, true);
      renderSection('executive-summary');
      addSpacer(8);

      // Section 2: Metering Hierarchy Overview
      addSectionHeading("2. METERING HIERARCHY OVERVIEW", 16, true);
      renderSection('hierarchy-overview');
      addSpacer(5);
      
      // Add schematic if available
      if (schematicImageBase64) {
        if (yPos > pageHeight - 150) {
          addFooter();
          addPageNumber();
          pdf.addPage();
          yPos = topMargin;
        }
        
        try {
          const imgWidth = pageWidth - leftMargin - rightMargin;
          const imgHeight = 120;
          pdf.addImage(schematicImageBase64, 'JPEG', leftMargin, yPos, imgWidth, imgHeight);
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
      addSectionHeading("3. DATA SOURCES AND AUDIT PERIOD", 16, true);
      
      // Add KPI Cards Section
      addSubsectionHeading("Data Collection Overview");
      
      // Calculate KPIs
      const kpiTotalReadings = meterData.reduce((sum: number, meter: any) => sum + (meter.readingsCount || 0), 0);
      const kpiTotalMeters = meterData.length;
      const kpiTotalConsumption = meterData.reduce((sum: number, meter: any) => sum + (parseFloat(meter.totalKwh) || 0), 0);
      const kpiAvgReadings = kpiTotalMeters > 0 ? Math.round(kpiTotalReadings / kpiTotalMeters) : 0;
      
      // Check if we need a new page for KPI cards
      if (yPos > pageHeight - bottomMargin - 80) {
        addFooter();
        addPageNumber();
        pdf.addPage();
        yPos = topMargin;
      }
      
      // Draw KPI Cards (4 cards in a row)
      const cardWidth = (pageWidth - leftMargin - rightMargin - 15) / 4;
      const cardHeight = 28;
      const cardStartY = yPos;
      const iconSize = 8;
      const iconPadding = 2;
      
      // Card 1: Total Data Points
      let cardX = leftMargin;
      pdf.setFillColor(59, 130, 246, 0.05);
      pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
      
      pdf.setFillColor(219, 234, 254);
      pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
      
      pdf.setFontSize(8);
      pdf.setTextColor(59, 130, 246);
      pdf.text("📊", cardX + 5, cardStartY + 9);
      
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text("Total Data Points", cardX + 3, cardStartY + 17);
      
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(0, 0, 0);
      pdf.text(kpiTotalReadings.toLocaleString(), cardX + 3, cardStartY + 23);
      
      pdf.setFontSize(6);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 116, 139);
      pdf.text("readings analyzed", cardX + 3, cardStartY + 26.5);
      
      // Card 2: Active Meters
      cardX += cardWidth + 5;
      pdf.setFillColor(142, 81, 245, 0.05);
      pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
      
      pdf.setFillColor(237, 233, 254);
      pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
      
      pdf.setFontSize(8);
      pdf.setTextColor(142, 81, 245);
      pdf.text("◉", cardX + 5, cardStartY + 9);
      
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text("Active Meters", cardX + 3, cardStartY + 17);
      
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(0, 0, 0);
      pdf.text(kpiTotalMeters.toString(), cardX + 3, cardStartY + 23);
      
      pdf.setFontSize(6);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 116, 139);
      pdf.text("monitored", cardX + 3, cardStartY + 26.5);
      
      // Card 3: Analysis Period
      cardX += cardWidth + 5;
      pdf.setFillColor(100, 116, 139, 0.05);
      pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
      
      pdf.setFillColor(226, 232, 240);
      pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
      
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text("📅", cardX + 5, cardStartY + 9);
      
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text("Analysis Period", cardX + 3, cardStartY + 17);
      
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(0, 0, 0);
      const dateText = `${reconciliationData.readingsPeriod || 'All Data'}`;
      pdf.text(dateText, cardX + 3, cardStartY + 23, { maxWidth: cardWidth - 6 });
      
      pdf.setFontSize(6);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 116, 139);
      pdf.text("date range", cardX + 3, cardStartY + 26.5);
      
      // Card 4: Total Consumption
      cardX += cardWidth + 5;
      pdf.setFillColor(59, 130, 246, 0.05);
      pdf.roundedRect(cardX, cardStartY, cardWidth, cardHeight, 2, 2, 'F');
      
      pdf.setFillColor(219, 234, 254);
      pdf.roundedRect(cardX + 3, cardStartY + 3, iconSize + iconPadding * 2, iconSize + iconPadding * 2, 2, 2, 'F');
      
      pdf.setFontSize(8);
      pdf.setTextColor(59, 130, 246);
      pdf.text("⚡", cardX + 5, cardStartY + 9);
      
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text("Total Consumption", cardX + 3, cardStartY + 17);
      
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(0, 0, 0);
      pdf.text(`${formatNumber(kpiTotalConsumption)} kWh`, cardX + 3, cardStartY + 23, { maxWidth: cardWidth - 6 });
      
      pdf.setFontSize(6);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 116, 139);
      pdf.text("energy used", cardX + 3, cardStartY + 26.5);
      
      yPos += cardHeight + 10;
      pdf.setTextColor(0, 0, 0);
      
      addSpacer(5);
      addSubsectionHeading("Audit Period");
      addText(reconciliationData?.readingsPeriod || "All Available Readings");
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
      
      // KPI Indicators Section
      addSubsectionHeading("4.2 Data Collection KPIs");
      
      // Calculate KPI stats from meter data
      const totalReadingsCount = meterData.reduce((sum: number, meter: any) => sum + (meter.readingsCount || 0), 0);
      const totalMetersCount = meterData.length;
      const totalConsumption = meterData.reduce((sum: number, meter: any) => sum + (parseFloat(meter.totalKwh) || 0), 0);
      
      const kpiRows = [
        ["Total Data Points Reviewed", totalReadingsCount.toLocaleString()],
        ["Active Meters Analyzed", totalMetersCount.toString()],
        ["Total Consumption", `${formatNumber(totalConsumption)} kWh`],
        ["Average Readings per Meter", totalMetersCount > 0 ? Math.round(totalReadingsCount / totalMetersCount).toString() : "0"]
      ];
      
      addTable(["KPI Indicator", "Value"], kpiRows, [100, 70]);
      addSpacer(8);
      
      // Add CSV Column Aggregations if available
      if (csvColumnAggregations && Object.keys(csvColumnAggregations).length > 0) {
        addSubsectionHeading("4.3 CSV Column Aggregations");
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

      // Render chart visualizations
      renderSection('meter-type-chart');
      renderSection('consumption-chart');

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
        addSectionHeading("5. BILLING VALIDATION", 16, true);
        renderSection('billing-validation');
        addSpacer(8);
      }

      // Section 6: Observations and Anomalies
      const obsSection = billingContent ? "6" : "5";
      addSectionHeading(`${obsSection}. OBSERVATIONS AND ANOMALIES`, 16, true);
      renderSection('observations');
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
      renderSection('recommendations');
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
      
      // Convert PDF to Blob and show save dialog
      const pdfBlob = pdf.output('blob');
      setPendingPdfBlob(pdfBlob);
      const defaultFileName = `${previewSiteName.replace(/\s+/g, "_")}_Audit_Report_${format(new Date(), "yyyyMMdd")}`;
      setShowSaveDialog(true);

      toast.success("Report generated! Please name and save it.");

    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate audit report");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveReport = async (fileName: string) => {
    if (!pendingPdfBlob) return;

    try {
      // Ensure .pdf extension
      const finalFileName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
      
      // Generate hierarchical storage path
      const { generateStoragePath } = await import("@/lib/storagePaths");
      const timestamp = Date.now();
      const timestampedFileName = `${timestamp}_${finalFileName}`;
      const { bucket, path: filePath } = await generateStoragePath(siteId, 'Reconciliation', 'Reports', timestampedFileName);
      
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, pendingPdfBlob, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Prepare generation parameters for regeneration
      const generationParameters = {
        selectedMeterIds: Array.from(selectedMeterIds),
        selectedSchematicId,
        selectedFolderPaths,
        selectedReconciliationIds,
        columnConfigs,
        timestamp: Date.now()
      };

      // Create database record
      const { error: dbError } = await supabase
        .from("site_documents")
        .insert({
          file_name: finalFileName,
          file_path: filePath,
          folder_path: "/Reconciliation",
          document_type: "report" as const,
          extraction_status: "not_applicable",
          file_size: pendingPdfBlob.size,
          is_folder: false,
          generation_parameters: generationParameters as any,
          site_id: siteId,
        });

      if (dbError) throw dbError;

      toast.success("Report saved successfully!");
      setPendingPdfBlob(null);
      setRefreshReports(prev => prev + 1);
    } catch (error) {
      console.error("Error saving report:", error);
      toast.error("Failed to save report");
      throw error;
    }
  };

  const handleRegenerateReport = async (report: any) => {
    if (!report.generation_parameters) {
      toast.error("This report doesn't have saved parameters for regeneration");
      return;
    }

    try {
      const params = report.generation_parameters;
      
      // Restore parameters
      setSelectedMeterIds(new Set(params.selectedMeterIds || []));
      setSelectedSchematicId(params.selectedSchematicId || "");
      setSelectedFolderPaths(params.selectedFolderPaths || (params.selectedFolderPath ? [params.selectedFolderPath] : []));
      setSelectedReconciliationIds(params.selectedReconciliationIds || (params.selectedReconciliationId ? [params.selectedReconciliationId] : []));
      setColumnConfigs(params.columnConfigs || {});

      toast.info("Parameters loaded. Regenerating report...");
      
      // Wait for state to update, then generate preview
      setTimeout(async () => {
        await generateMarkdownPreview();
      }, 100);
    } catch (error) {
      console.error("Error regenerating report:", error);
      toast.error("Failed to regenerate report");
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
            <Label>Select Document Folders *</Label>
            <div className="border rounded-lg p-3 max-h-64 overflow-y-auto bg-background">
              <div className="flex justify-between items-center mb-3 pb-2 border-b">
                <span className="text-sm text-muted-foreground font-medium">
                  {selectedFolderPaths.length} of {availableFolders.length} selected
                </span>
                <div className="space-x-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setSelectedFolderPaths(availableFolders.map((f: any) => f.path))}
                  >
                    Select All
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setSelectedFolderPaths([])}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {availableFolders.map((folder: any) => (
                  <div key={folder.path} className="flex items-center space-x-2 p-2 rounded hover:bg-accent">
                    <Checkbox 
                      id={`folder-${folder.path}`}
                      checked={selectedFolderPaths.includes(folder.path)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedFolderPaths([...selectedFolderPaths, folder.path]);
                        } else {
                          setSelectedFolderPaths(selectedFolderPaths.filter(p => p !== folder.path));
                        }
                      }}
                    />
                    <Label htmlFor={`folder-${folder.path}`} className="flex-1 cursor-pointer">
                      {folder.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({folder.count} {folder.count === 1 ? 'doc' : 'docs'})
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {!reconciliationRun && (
            <div className="space-y-2">
              <Label>Select Reconciliation Runs *</Label>
              <div className="border rounded-lg p-3 max-h-64 overflow-y-auto bg-background">
                <div className="flex justify-between items-center mb-3 pb-2 border-b">
                  <span className="text-sm text-muted-foreground font-medium">
                    {selectedReconciliationIds.length} of {availableReconciliations.length} selected
                  </span>
                  <div className="space-x-2">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setSelectedReconciliationIds(availableReconciliations.map(r => r.id))}
                    >
                      Select All
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setSelectedReconciliationIds([])}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {availableReconciliations.map((run) => (
                    <div key={run.id} className="flex items-center space-x-2 p-2 rounded hover:bg-accent">
                      <Checkbox 
                        id={`run-${run.id}`}
                        checked={selectedReconciliationIds.includes(run.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedReconciliationIds([...selectedReconciliationIds, run.id]);
                          } else {
                            setSelectedReconciliationIds(selectedReconciliationIds.filter(id => id !== run.id));
                          }
                        }}
                      />
                      <Label htmlFor={`run-${run.id}`} className="flex-1 cursor-pointer">
                        <div className="font-medium">{run.run_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(run.date_from), 'PP')} to {format(new Date(run.date_to), 'PP')}
                        </div>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {reconciliationRun && (
            <div className="p-4 border rounded-lg bg-muted/30">
              <p className="text-sm font-medium mb-2">Using Reconciliation:</p>
              <p className="text-sm text-muted-foreground">
                {reconciliationRun.run_name} - {format(new Date(reconciliationRun.run_date), "dd MMM yyyy")}
              </p>
            </div>
          )}
        </div>

        <Separator />

        <SavedReportsList 
          siteId={siteId} 
          key={refreshReports} 
          onRegenerate={handleRegenerateReport}
        />

        {isGeneratingPreview && (
          <ReportGenerationProgress
            progress={generationProgress}
            status={generationStatus}
            batches={batchStatuses}
            currentBatch={currentBatch}
            showSectionDetails={true}
          />
        )}

        <Button
          onClick={generateMarkdownPreview}
          disabled={
            isGeneratingPreview || 
            isLoadingMeters || 
            isLoadingOptions ||
            selectedFolderPaths.length === 0 ||
            (selectedReconciliationIds.length === 0 && !reconciliationRun) ||
            !selectedSchematicId
          }
          className="w-full"
          size="lg"
        >
          {isGeneratingPreview ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Report...
            </>
          ) : (
            <>
              <Edit className="w-4 h-4 mr-2" />
              Generate Markdown Preview
            </>
          )}
        </Button>

        {isEditingContent && editableSections.length > 0 && (
          <SplitViewReportEditor
            sections={editableSections}
            siteId={siteId}
            dateFrom={reconciliationDateFrom}
            dateTo={reconciliationDateTo}
            onSave={handleSaveEditedContent}
            onCancel={() => {
              setIsEditingContent(false);
              setEditableSections([]);
            }}
            generatePdfPreview={generatePdfPreview}
            generateFinalPdf={async (sections) => {
              setEditableSections(sections);
              await generateReport();
            }}
          />
        )}

        <SaveReportDialog
          open={showSaveDialog}
          onOpenChange={setShowSaveDialog}
          onSave={handleSaveReport}
          defaultFileName={`${siteName.replace(/\s+/g, "_")}_Audit_Report_${format(new Date(), "yyyyMMdd")}`}
        />
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Loader2, Download, CalendarIcon, Eye, Edit, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SplitViewReportEditor } from "./SplitViewReportEditor";
import SaveReportDialog from "./SaveReportDialog";
import SavedReportsList from "./SavedReportsList";
import { ReportGenerationProgress } from "./ReportGenerationProgress";
import { generateMeterTypeChart, generateConsumptionChart, generateDocumentVsAssignedChart, generateReconciliationVsDocumentChart } from "./ChartGenerator";

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
  const [availableSnippets, setAvailableSnippets] = useState<any[]>([]);
  const [availableFolders, setAvailableFolders] = useState<any[]>([]);
  const [availableReconciliations, setAvailableReconciliations] = useState<any[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [reconciliationDateFrom, setReconciliationDateFrom] = useState<string>("");
  const [reconciliationDateTo, setReconciliationDateTo] = useState<string>("");
  const [batchStatuses, setBatchStatuses] = useState<BatchStatus[]>([]);
  const [currentBatch, setCurrentBatch] = useState<number | undefined>();
  const [snippetExpanded, setSnippetExpanded] = useState(true);
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  const [reconciliationsExpanded, setReconciliationsExpanded] = useState(true);

  // Fetch available options on mount
  useEffect(() => {
    const fetchOptions = async () => {
      setIsLoadingOptions(true);
      try {
        // Fetch schematics
        const { data: schematics, error: schematicsError } = await supabase
          .from("schematics")
          .select("id, name, description, page_number, total_pages, file_path, site_id")
          .eq("site_id", siteId)
          .order("name", { ascending: true });

        if (schematicsError) throw schematicsError;
        
        // List ALL snippet files directly without matching to schematics
        const snippetsWithUrls: any[] = [];
        
        if (schematics && schematics.length > 0) {
          const firstSchematicPath = schematics[0].file_path;
          const pathParts = firstSchematicPath.split('/');
          const siteDirectory = pathParts.slice(0, -1).join('/');
          
        // List all files in the directory, sorted by most recent first
          const { data: fileList, error: listError } = await supabase.storage
            .from('client-files')
            .list(siteDirectory, {
              limit: 1000,
              sortBy: { column: 'created_at', order: 'desc' }
            });
          
          console.log('Storage list result:', { fileList, listError, siteDirectory });
          
          if (fileList) {
            const snippetFiles = fileList.filter(file => file.name.endsWith('_snippet.png'));
            console.log('Snippet files found:', snippetFiles);
            
            // Create entries for EACH snippet file
            snippetFiles.forEach(file => {
              const snippetPath = `${siteDirectory}/${file.name}`;
              const { data: urlData } = supabase.storage
                .from('client-files')
                .getPublicUrl(snippetPath);
              
              // Use filename without extension as display name
              const displayName = file.name.replace('_snippet.png', '');
              
              snippetsWithUrls.push({
                id: file.name, // Use filename as unique ID
                name: displayName,
                snippetUrl: urlData.publicUrl,
                snippetPath: snippetPath
              });
            });
          }
        }
        
        console.log('Final snippets:', snippetsWithUrls);
        setAvailableSnippets(snippetsWithUrls);
        
        // Auto-select the most recently uploaded snippet
        if (snippetsWithUrls.length > 0) {
          setSelectedSchematicId(snippetsWithUrls[0].id);
        }

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
            // Sort chronologically by parsing month-year format (e.g., "February 2025")
            const parseMonthYear = (path: string) => {
              const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                              'july', 'august', 'september', 'october', 'november', 'december'];
              const lower = (path || '').toLowerCase().trim();
              const parts = lower.split(' ');
              if (parts.length >= 2) {
                const monthIndex = months.indexOf(parts[0]);
                const year = parseInt(parts[1]);
                if (monthIndex >= 0 && !isNaN(year)) {
                  return new Date(year, monthIndex, 1);
                }
              }
              return new Date(0); // fallback for non-date folders
            };
            
            const aDate = parseMonthYear(a);
            const bDate = parseMonthYear(b);
            return aDate.getTime() - bDate.getTime(); // Ascending (earliest first)
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
          .order("run_date", { ascending: true });

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
    // Use a small delay to allow UI to update before heavy PDF generation
    await new Promise(resolve => setTimeout(resolve, 0));
    
    if (!previewData) {
      return '';
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

        // Text sanitization for PDF rendering (jsPDF doesn't support all Unicode chars)
        const sanitizeForPdf = (text: string): string => {
          return text
            .replace(/≤/g, '<=')
            .replace(/≥/g, '>=')
            .replace(/°/g, ' deg')
            .replace(/²/g, '2')
            .replace(/³/g, '3')
            .replace(/×/g, 'x')
            .replace(/÷/g, '/')
            .replace(/±/g, '+/-')
            .replace(/•/g, '-')
            .replace(/–/g, '-')
            .replace(/—/g, '-')
            .replace(/'/g, "'")
            .replace(/'/g, "'")
            .replace(/"/g, '"')
            .replace(/"/g, '"');
        };

        // Helper to add an image (handles both PNG/JPEG and SVG data URLs)
        const addImageSafe = async (imageData: string, x: number, y: number, width: number, height: number): Promise<boolean> => {
          if (!imageData || typeof imageData !== 'string') {
            console.warn("Invalid image data provided to addImageSafe");
            return false;
          }
          
          try {
            // Check if it's an SVG data URL
            if (imageData.startsWith('data:image/svg+xml')) {
              // Decode the SVG content
              let svgContent = '';
              if (imageData.includes(',')) {
                const base64Part = imageData.split(',')[1];
                if (imageData.includes(';base64,')) {
                  svgContent = atob(base64Part);
                } else {
                  svgContent = decodeURIComponent(base64Part);
                }
              }
              
              if (svgContent) {
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
                const svgElement = svgDoc.documentElement;
                
                // Check for parse errors
                const parseError = svgDoc.querySelector('parsererror');
                if (parseError) {
                  console.error("SVG parse error in addImageSafe:", parseError.textContent);
                  return false;
                }
                
                await svg2pdf(svgElement, pdf, { x, y, width, height });
                return true;
              }
              return false;
            }
            
            // Handle regular PNG/JPEG images
            if (imageData.startsWith('data:image/png') || imageData.startsWith('data:image/jpeg') || imageData.startsWith('data:image/jpg')) {
              const format = imageData.includes('data:image/jpeg') || imageData.includes('data:image/jpg') ? 'JPEG' : 'PNG';
              
              // Validate base64 content
              const base64Data = imageData.split(',')[1];
              if (!base64Data || base64Data.length < 50) {
                console.warn("Image data appears to be invalid or too small");
                return false;
              }
              
              pdf.addImage(imageData, format, x, y, width, height);
              return true;
            }
            
            // For external URLs or unknown formats, try as PNG
            pdf.addImage(imageData, 'PNG', x, y, width, height);
            return true;
          } catch (err) {
            console.error("Error in addImageSafe:", err);
            return false;
          }
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
        const renderContent = async (text: string, fontSize: number = 9): Promise<void> => {
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
              await renderContent(beforeChart, fontSize);
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
              await renderContent(afterChart, fontSize);
            }
            return;
          }
          
          // Check for markdown headers (### Meter: ...)
          const headerMatch = text.match(/^(#{1,3})\s+(.+?)(?:\n|$)/m);
          if (headerMatch) {
            const [fullMatch, hashes, headerText] = headerMatch;
            const beforeHeader = text.substring(0, headerMatch.index);
            const afterHeader = text.substring((headerMatch.index || 0) + fullMatch.length);
            
            // Render any text before header (recursively to handle images and tables)
            if (beforeHeader.trim()) {
              await renderContent(beforeHeader, fontSize);
            }
            
            // Render header as subheading
            addSubsectionHeading(headerText.replace(/[#*_]/g, '').trim());
            
            // Continue with text after header
            if (afterHeader.trim()) {
              await renderContent(afterHeader, fontSize);
            }
            return;
          }
          
          // Check for markdown image (chart images)
          const imageMatch = text.match(/!\[([^\]]*)\]\(([^)]+)\)/);
          console.log('🔍 Checking for image in text:', text.substring(0, 200), 'Match:', !!imageMatch);
          if (imageMatch) {
            console.log('✅ Image matched:', imageMatch[1]);
            const [fullMatch, altText, imageUrl] = imageMatch;
            const beforeImage = text.substring(0, imageMatch.index);
            const afterImage = text.substring((imageMatch.index || 0) + fullMatch.length);
            
            // Render text before image
            if (beforeImage.trim()) {
              await renderContent(beforeImage, fontSize);
            }
            
            // Render the image using safe handler
            // Check if we need a new page
            if (yPos > pageHeight - bottomMargin - 100) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            const imgWidth = pageWidth - leftMargin - rightMargin;
            // Calculate proportional height based on original chart dimensions (500x320 for tariff charts)
            const imgHeight = (320 / 500) * imgWidth;
            
            const imageAdded = await addImageSafe(imageUrl, leftMargin, yPos, imgWidth, imgHeight);
            if (imageAdded) {
              yPos += imgHeight + 3;
              
              // Add caption if available
              if (altText) {
                pdf.setFontSize(8);
                pdf.setFont("helvetica", "italic");
                pdf.text(altText, pageWidth / 2, yPos, { align: "center" });
                pdf.setFont("helvetica", "normal");
                yPos += 6;
              }
            } else {
              addText(`[Image could not be rendered]`, fontSize, false);
            }
            
            // Render text after image (recursively)
            if (afterImage.trim()) {
              await renderContent(afterImage, fontSize);
            }
            return;
          }
          
          // Check for markdown table
          const tableMatch = text.match(/\|[^\n]+\|\n\|[-:\s|]+\|\n(\|[^\n]+\|\n?)+/);
          console.log('🔍 Checking for table. Text length:', text.length, 'Has table:', !!tableMatch);
          if (tableMatch) {
            const tableText = tableMatch[0];
            const beforeTable = text.substring(0, tableMatch.index);
            const afterTable = text.substring((tableMatch.index || 0) + tableText.length);
            
            console.log('📊 Table found. Before table length:', beforeTable.length, 'Content:', beforeTable.substring(0, 300));
            
            // Render text before table
            if (beforeTable.trim()) {
              await renderContent(beforeTable, fontSize);
              yPos += 3;
            }
            
            // Parse and render table without auto-generated title
            const parsed = parseMarkdownTable(tableText);
            if (parsed) {
              // Don't add any title - the meter title is handled as a header above
              addTable(parsed.headers, parsed.rows);
              yPos += 5;
            }
            
            // Render text after table (recursively in case of multiple tables)
            if (afterTable.trim()) {
              await renderContent(afterTable, fontSize);
            }
            return;
          }
          
          // No table or chart found, render as text
          addText(text, fontSize, false);
        };
        
        // Helper to add text with wrapping
        const addText = (text: string, fontSize: number = 9, isBold: boolean = false) => {
          const sanitizedText = sanitizeForPdf(text);
          const cleanedText = sanitizedText
            .replace(/\*\*(.*?)\*\*/g, '$1')      // Remove bold markers
            .replace(/\*(.*?)\*/g, '$1')           // Remove italic markers
            .replace(/^#{1,6}\s+.*$/gm, '')        // Remove header lines
            .replace(/^---+$/gm, '')               // Remove horizontal rules
            .replace(/^\s*\n/gm, '\n')             // Collapse multiple newlines
            .trim();
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
          
          yPos += 4;
          pdf.setFontSize(fontSize);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
          pdf.text(text, leftMargin, yPos);
          pdf.setTextColor(0, 0, 0);
          yPos += fontSize * 0.6;
        };

        // Helper to add subsection heading
    const addSubsectionHeading = (text: string) => {
      yPos += 3;
      if (yPos > pageHeight - bottomMargin - 20) {
        addFooter();
        addPageNumber();
        pdf.addPage();
        yPos = topMargin;
      }
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
      pdf.text(sanitizeForPdf(text), leftMargin, yPos);
      pdf.setTextColor(0, 0, 0);
      yPos += 5;
    };

        // Table counter for labeling
        let tableCounter = 1;
        
        // Helper to add table caption
        const addTableCaption = (title: string) => {
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "italic");
          pdf.setTextColor(0, 0, 0);
          pdf.text(`Table ${tableCounter}: ${title}`, pageWidth / 2, yPos, { align: "center" });
          pdf.setFont("helvetica", "normal");
          tableCounter++;
          yPos += 8;
        };
        
        // Helper to add table
        const addTable = (headers: string[], rows: string[][], columnWidths?: number[], tableCaption?: string, tableHeader?: string) => {
          const tableWidth = pageWidth - leftMargin - rightMargin;
          const defaultColWidth = tableWidth / headers.length;
          const colWidths = columnWidths || headers.map(() => defaultColWidth);
          
          if (yPos > pageHeight - bottomMargin - 40) {
            addFooter();
            addPageNumber();
            pdf.addPage();
            yPos = topMargin;
          }
          
          // Add title ABOVE table if provided
          if (tableHeader) {
            pdf.setFontSize(11);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(templateBlue[0], templateBlue[1], templateBlue[2]);
            pdf.text(tableHeader, leftMargin, yPos);
            pdf.setTextColor(0, 0, 0);
            yPos += 8;
          }
          
          // Draw header with blue background
          const rowHeight = 7; // Compact row height
          pdf.setFillColor(templateBlue[0], templateBlue[1], templateBlue[2]);
          pdf.rect(leftMargin, yPos, tableWidth, rowHeight, "F");
          
          pdf.setFontSize(8); // Compact font size
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(255, 255, 255);
          let xPos = leftMargin + 2;
          headers.forEach((header, i) => {
            pdf.text(sanitizeForPdf(header), xPos, yPos + 5); // Adjusted vertical position
            xPos += colWidths[i];
          });
          pdf.setTextColor(0, 0, 0);
          yPos += rowHeight;
          
          // Draw rows with alternating colors
          pdf.setFont("helvetica", "normal");
          rows.forEach((row, rowIndex) => {
            if (yPos > pageHeight - bottomMargin - 10) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin + 10;
            }
            
            // Alternating row background
            if (rowIndex % 2 === 0) {
              pdf.setFillColor(248, 250, 252); // Light gray
              pdf.rect(leftMargin, yPos, tableWidth, rowHeight, "F");
            }
            
            xPos = leftMargin + 2;
            row.forEach((cell, i) => {
              const sanitizedCell = sanitizeForPdf(cell);
              const cellLines = pdf.splitTextToSize(sanitizedCell, colWidths[i] - 4);
              pdf.text(cellLines[0] || "", xPos, yPos + 5); // Adjusted vertical position
              xPos += colWidths[i];
            });
            
            // Draw cell borders
            pdf.setDrawColor(226, 232, 240); // Light border
            pdf.setLineWidth(0.3);
            pdf.rect(leftMargin, yPos, tableWidth, rowHeight);
            yPos += rowHeight;
          });
          
          yPos += 3; // Reduced spacing after table
          
          // Add caption at bottom if provided
          if (tableCaption) {
            addTableCaption(tableCaption);
          }
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
        const renderSection = async (sectionId: string): Promise<void> => {
          const section = sections.find(s => s.id === sectionId);
          if (!section) return;
          
          // Check if content is a markdown image
          const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
          const imageMatch = section.content.match(imageRegex);
          
          if (imageMatch && section.type === 'chart') {
            // This is a chart image - render it using safe handler
            const [_, altText, imageUrl] = imageMatch;
            
            // Check if we need a new page
            if (yPos > pageHeight - 150) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            const imgWidth = pageWidth - leftMargin - rightMargin;
            const imgHeight = 120;
            
            const imageAdded = await addImageSafe(imageUrl, leftMargin, yPos, imgWidth, imgHeight);
            if (imageAdded) {
              yPos += imgHeight + 5;
              
              // Add caption if available
              if (altText) {
                pdf.setFontSize(9);
                pdf.setFont("helvetica", "italic");
                pdf.text(altText, pageWidth / 2, yPos, { align: "center" });
                pdf.setFont("helvetica", "normal");
                yPos += 10;
              }
            } else {
              addText(`[Chart image could not be rendered]`, 10, false);
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
            await renderContent(section.content);
          }
        };
        
        // Section 1: Executive Summary
        addSectionHeading("1. EXECUTIVE SUMMARY", 16, true);
        await renderSection('executive-summary');
        addSpacer(8);
        
        // Section 2: Site Infrastructure
        addSectionHeading("2. SITE INFRASTRUCTURE", 16, true);
        
        // Add schematic image as full page first item if available
        if (schematicImageBase64 && typeof schematicImageBase64 === 'string' && schematicImageBase64.startsWith('data:image/')) {
          try {
            // Calculate dimensions for full-page image
            const imgWidth = pageWidth - leftMargin - rightMargin;
            // Leave space for heading (already added), caption, and margins
            const imgHeight = pageHeight - yPos - bottomMargin - 20; // 20 for caption space
            
            // Use addImageSafe to handle both PNG/JPEG and SVG images properly
            const imageAdded = await addImageSafe(schematicImageBase64, leftMargin, yPos, imgWidth, imgHeight);
            
            if (!imageAdded) {
              console.warn("Schematic image could not be added, skipping");
            } else {
              yPos += imgHeight + 5;
              
              // Add caption at bottom
              pdf.setFontSize(9);
              pdf.setFont("helvetica", "italic");
              pdf.text("Figure 1: Site Metering Schematic Diagram", pageWidth / 2, yPos, { align: "center" });
              pdf.setFont("helvetica", "normal");
              
              // Start new page for remaining content
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
          } catch (err) {
            console.error("Error adding schematic to preview:", err);
            // Continue without the schematic image - don't fail the entire PDF
          }
        }
        
        await renderSection('site-infrastructure');
        addSpacer(8);
        
        // Section 3: Tariff Configuration
        addSectionHeading("3. TARIFF CONFIGURATION", 16, true);
        addSpacer(10); // Prevent overlap with first subsection
        
        // Helper functions for formatting
        const formatChargeType = (type: string): string => {
          const labels: Record<string, string> = {
            basic_charge: "Basic Charge",
            energy_high_season: "Energy (High Season)",
            energy_low_season: "Energy (Low Season)",
            demand_high_season: "Demand (High Season)",
            demand_low_season: "Demand (Low Season)",
            network_capacity: "Network Capacity",
            network_demand: "Network Demand"
          };
          return labels[type] || type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        };

        const formatTariffType = (type: string): string => {
          return type.charAt(0).toUpperCase() + type.slice(1);
        };
        
        // Render tariff charts and tables - 2 tariffs per page
        const tariffChartImages = (previewData as any).tariffChartImages;
        const tariffsByName = (previewData as any).tariffsByName || {};
        
        if (tariffChartImages && Object.keys(tariffChartImages).length > 0) {
          const contentWidth = pageWidth - leftMargin - rightMargin;
          const contentHeight = pageHeight - topMargin - bottomMargin;
          const halfPageHeight = contentHeight / 2;
          
          // 2x2 grid layout: 2 charts per row, with details in bottom-right
          const chartSpacing = 6;
          const chartWidth = (contentWidth - chartSpacing) / 2;
          const chartHeight = chartWidth * 0.55; // Aspect ratio for 2-column layout
          
          let tariffCountOnPage = 0;
          const tariffsPerPage = 2;
          
          for (const tariffName of Object.keys(tariffChartImages)) {
            const charts = tariffChartImages[tariffName];
            const tariffPeriods = tariffsByName[tariffName] || [];
            const latestPeriod = tariffPeriods[tariffPeriods.length - 1];
            
            if (!charts && !latestPeriod) continue;
            
            // Check if we need a new page (after 2 tariffs)
            if (tariffCountOnPage >= tariffsPerPage) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              tariffCountOnPage = 0;
            }
            
            // Calculate fixed yPos based on which half of the page
            const tariffStartY = topMargin + (tariffCountOnPage * halfPageHeight);
            // Add offset for section heading on first tariff to prevent overlap
            yPos = tariffCountOnPage === 0 ? tariffStartY + 18 : tariffStartY;
            
            // Add horizontal separator before second tariff
            if (tariffCountOnPage === 1) {
              pdf.setDrawColor(200, 200, 200);
              pdf.line(leftMargin, yPos - 3, pageWidth - rightMargin, yPos - 3);
            }
            
            // Add tariff subheading
            addSubsectionHeading(tariffName);
            
            // Helper to add chart (handles both SVG and PNG)
            const addChartToPdf = async (chartData: any, x: number, chartY: number, width: number, height: number): Promise<boolean> => {
              if (!chartData) return false;
              
              try {
                if (chartData.type === 'svg') {
                  // Parse SVG and embed using svg2pdf
                  const parser = new DOMParser();
                  const svgDoc = parser.parseFromString(chartData.content, 'image/svg+xml');
                  const svgElement = svgDoc.documentElement;
                  
                  // Check for parse errors
                  const parseError = svgDoc.querySelector('parsererror');
                  if (parseError) {
                    console.error("SVG parse error:", parseError.textContent);
                    return false;
                  }
                  
                  await svg2pdf(svgElement, pdf, { x, y: chartY, width, height });
                  return true;
                } else if (chartData.type === 'png' || typeof chartData === 'string') {
                  // Legacy PNG support (chartData is base64 string or has content property)
                  const imgData = typeof chartData === 'string' ? chartData : chartData.content;
                  return await addImageSafe(imgData, x, chartY, width, height);
                }
              } catch (err) {
                console.error("Error adding chart:", err);
              }
              return false;
            };
            
            // Render 2x2 grid: Top row = 2 charts, Bottom row = 1 chart + details
            if (charts && (charts.basic || charts.energy || charts.demand)) {
              const chart1X = leftMargin;
              const chart2X = leftMargin + chartWidth + chartSpacing;
              const topRowY = yPos;
              const bottomRowY = yPos + chartHeight + 4;
              
              // Top row: Basic Charge (left) and Energy Charge (right)
              await addChartToPdf(charts.basic, chart1X, topRowY, chartWidth, chartHeight);
              await addChartToPdf(charts.energy, chart2X, topRowY, chartWidth, chartHeight);
              
              // Bottom row: Demand Charge (left)
              await addChartToPdf(charts.demand, chart1X, bottomRowY, chartWidth, chartHeight);
              
              // Bottom row: Tariff Details (right) - in same cell as would be 4th chart
              if (latestPeriod) {
                const detailsX = chart2X;
                const detailsY = bottomRowY + 2;
                const detailsWidth = chartWidth;
                
                // Tariff Overview heading
                pdf.setFontSize(9);
                pdf.setFont("helvetica", "bold");
                pdf.text("Tariff Overview", detailsX, detailsY);
                
                pdf.setFontSize(8);
                pdf.setFont("helvetica", "normal");
                const overviewY = detailsY + 5;
                pdf.text(`Type: ${formatTariffType(latestPeriod.tariff_type || 'N/A')} / ${latestPeriod.meter_configuration || 'N/A'}`, detailsX, overviewY);
                pdf.text(`Voltage: ${latestPeriod.voltage_level || 'N/A'} / Zone: ${latestPeriod.transmission_zone || 'N/A'}`, detailsX, overviewY + 4);
                pdf.text(`Period: ${format(new Date(latestPeriod.effective_from), "dd MMM yy")} - ${latestPeriod.effective_to ? format(new Date(latestPeriod.effective_to), "dd MMM yy") : 'Current'}`, detailsX, overviewY + 8);
                
                // Current Charges heading
                const chargesY = overviewY + 16;
                pdf.setFont("helvetica", "bold");
                pdf.text("Current Charges", detailsX, chargesY);
                pdf.setFont("helvetica", "normal");
                
                const charges = latestPeriod.tariff_charges || [];
                charges.slice(0, 6).forEach((charge: any, idx: number) => {
                  const chargeText = `${formatChargeType(charge.charge_type)}: ${formatNumber(charge.charge_amount)} ${charge.unit}`;
                  pdf.text(chargeText.substring(0, 55), detailsX, chargesY + 4 + (idx * 4));
                });
              }
              
              // Advance yPos past the 2x2 grid
              yPos = bottomRowY + chartHeight + 4;
            } else {
              // No charts available - add text placeholder
              pdf.setFontSize(8);
              pdf.setFont("helvetica", "italic");
              pdf.setTextColor(128, 128, 128);
              pdf.text("No chart data available for this tariff", leftMargin, yPos);
              pdf.setTextColor(0, 0, 0);
              pdf.setFont("helvetica", "normal");
              yPos += 10;
              
              // Still render tariff details if available
              if (latestPeriod) {
                pdf.setFontSize(9);
                pdf.setFont("helvetica", "bold");
                pdf.text("Tariff Overview", leftMargin, yPos);
                yPos += 5;
                
                pdf.setFontSize(8);
                pdf.setFont("helvetica", "normal");
                pdf.text(`Type: ${formatTariffType(latestPeriod.tariff_type || 'N/A')} / ${latestPeriod.meter_configuration || 'N/A'}`, leftMargin, yPos);
                pdf.text(`Voltage: ${latestPeriod.voltage_level || 'N/A'} / Zone: ${latestPeriod.transmission_zone || 'N/A'}`, leftMargin, yPos + 4);
                yPos += 12;
              }
            }
            
            tariffCountOnPage++;
          }
          
          // Reset yPos to end of current page content
          yPos = topMargin + (tariffCountOnPage * halfPageHeight);
        } else {
          // Fallback if no charts - render the markdown section
          await renderSection('tariff-configuration');
        }
        
        addSpacer(8);
        
        // Section 4: Tariff Comparison
        addSectionHeading("4. TARIFF COMPARISON", 16, true);
        addText("Document values compared against assigned tariff rates for each meter.");
        addSpacer(5);
        
        const rateComparisonCharts = (previewData as any).rateComparisonCharts;
        if (rateComparisonCharts && Object.keys(rateComparisonCharts).length > 0) {
          const meterIds = Object.keys(rateComparisonCharts);
          const metersPerPage = 2;
          
          // Calculate dimensions for condensed layout (2 meters per page, 2x2 charts each)
          const contentWidth = pageWidth - leftMargin - rightMargin;
          const chartSpacing = 4;
          const chartWidth = (contentWidth - chartSpacing) / 2;
          const chartHeight = chartWidth * 0.55; // More compact aspect ratio
          const meterBlockHeight = (chartHeight * 2) + chartSpacing + 20; // 2 rows of charts + heading
          
          for (let meterIdx = 0; meterIdx < meterIds.length; meterIdx++) {
            const meterId = meterIds[meterIdx];
            const meterChartData = rateComparisonCharts[meterId];
            const meterPositionOnPage = meterIdx % metersPerPage;
            
            // Start new page for every 2 meters (except first)
            if (meterIdx > 0 && meterPositionOnPage === 0) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            // Check if we need page break for this meter block
            if (yPos + meterBlockHeight > pageHeight - bottomMargin) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            // Add meter subheading
            addSubsectionHeading(`Meter: ${meterChartData.meterNumber}${meterChartData.meterName ? ` (${meterChartData.meterName})` : ''}`);
            addSpacer(2);
            
            // Render charts in 2x2 grid (always 4 positions for consistent layout)
            const chartEntries = Object.entries(meterChartData.charts || {}).slice(0, 4);
            
            // Always render 2 rows of 2 charts (4 total positions) - empty positions reserve space without visible placeholder
            for (let row = 0; row < 2; row++) {
              for (let col = 0; col < 2; col++) {
                const chartIndex = row * 2 + col;
                const chartX = leftMargin + (col * (chartWidth + chartSpacing));
                
                if (chartIndex < chartEntries.length) {
                  const [chargeType, chartImage] = chartEntries[chartIndex];
                  if (chartImage) {
                    await addImageSafe(chartImage as string, chartX, yPos, chartWidth, chartHeight);
                  }
                  // If chartImage is null/undefined, just skip - space is reserved
                }
                // Empty positions: just skip drawing, space is reserved by yPos increment
              }
              yPos += chartHeight + chartSpacing;
            }
            
            addSpacer(5);
          }
        }
        
        // Start new page for comparison tables
        addFooter();
        addPageNumber();
        pdf.addPage();
        yPos = topMargin;
        
        // Render comparison tables with smart pagination:
        // - Fit 2 tables per page if both are small enough
        // - Use 1 table per page if table is large
        const tariffComparisonSection = sections.find(s => s.id === 'tariff-comparison');
        if (tariffComparisonSection) {
          const content = tariffComparisonSection.content;
          
          // Split content by meter sections (### Meter: ...)
          const meterSections = content.split(/(?=###\s*Meter:)/).filter(s => s.trim().startsWith('###'));
          
          // Helper to estimate table height based on row count
          const estimateTableHeight = (meterContent: string): number => {
            const lines = meterContent.split('\n');
            const tableRows = lines.filter(l => l.trim().startsWith('|') && !l.includes('---')).length;
            const headerHeight = 25; // Meter header
            const tableHeaderHeight = 20;
            const rowHeight = 12;
            return headerHeight + tableHeaderHeight + (tableRows * rowHeight) + 15; // 15 for spacing
          };
          
          // Maximum height that allows 2 tables to fit on one page
          const usablePageHeight = pageHeight - topMargin - bottomMargin - 20;
          const maxHeightForTwo = usablePageHeight / 2 - 10; // Half page minus spacing
          
          let i = 0;
          while (i < meterSections.length) {
            const currentContent = meterSections[i].trim();
            const currentHeight = estimateTableHeight(currentContent);
            
            // Check if we need a new page
            if (yPos > topMargin + 10) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            // Check if current table is "large" (takes more than half the page)
            const isCurrentLarge = currentHeight > maxHeightForTwo;
            
            if (isCurrentLarge) {
              // Large table: render alone on this page
              await renderContent(currentContent);
              addSpacer(8);
              i++;
            } else {
              // Small table: try to fit another one on the same page
              await renderContent(currentContent);
              addSpacer(8);
              i++;
              
              // Check if there's a next table and if it would fit
              if (i < meterSections.length) {
                const nextContent = meterSections[i].trim();
                const nextHeight = estimateTableHeight(nextContent);
                const combinedHeight = currentHeight + nextHeight + 16; // 16 for spacing between
                
                if (combinedHeight <= usablePageHeight) {
                  // Both fit on one page - render the second one
                  await renderContent(nextContent);
                  addSpacer(8);
                  i++;
                }
                // Otherwise, next iteration will start a new page
              }
            }
          }
        }
        addSpacer(8);
        
        // Section 5: Tariff Analysis
        addSectionHeading("5. TARIFF ANALYSIS", 16, true);
        addText("Analysis of billing trends and cost breakdowns for each meter.");
        addSpacer(5);

        const tariffAnalysisCharts = (previewData as any).tariffAnalysisCharts;
        if (tariffAnalysisCharts && Object.keys(tariffAnalysisCharts).length > 0) {
          const meterIds = Object.keys(tariffAnalysisCharts);
          for (let meterIndex = 0; meterIndex < meterIds.length; meterIndex++) {
            const meterId = meterIds[meterIndex];
            const meterCharts = tariffAnalysisCharts[meterId];
            const meter = meterData.find(m => m.id === meterId);
            
            if (!meter) continue;
            
            // Start each meter on a new page (except first meter which follows section heading)
            if (meterIndex > 0) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            // Add meter subheading
            addSubsectionHeading(`Meter: ${meter.meter_number}${meter.name ? ` (${meter.name})` : ''}`);
            addSpacer(3);
            
            // Render charts (filter first to avoid white space)
            const metrics = ['Total Amount', 'Basic Charge', 'kVA Charge', 'kWh Charge', 'kVA Consumption', 'kWh Consumption'];
            const availableCharts = metrics
              .filter(metric => meterCharts[metric])
              .map(metric => ({ metric, chartImage: meterCharts[metric] }));
            
            const chartWidth = (pageWidth - leftMargin - rightMargin - 5) / 2; // 5 = 1 gap
            const chartHeight = chartWidth * 0.75;
            
            for (let i = 0; i < availableCharts.length; i += 2) {
              // Check for page break
              if (yPos > pageHeight - bottomMargin - chartHeight - 20) {
                addFooter();
                addPageNumber();
                pdf.addPage();
                yPos = topMargin;
              }
              
              // Render up to 2 charts in a row
              for (let j = 0; j < 2 && (i + j) < availableCharts.length; j++) {
                const { chartImage } = availableCharts[i + j];
                const chartX = leftMargin + (j * (chartWidth + 5));
                await addImageSafe(chartImage, chartX, yPos, chartWidth - 2, chartHeight);
              }
              yPos += chartHeight + 2;
            }
          }
        } else {
          addText("No tariff analysis data available.");
        }
        addSpacer(8);
        
        // Section 6: Billing Comparison Charts
        addSectionHeading("6. BILLING COMPARISON CHARTS", 16, true);
        addText("Reconciliation costs compared against document billed amounts for each meter.");
        addSpacer(5);
        
        const billingComparisonCharts = (previewData as any).billingComparisonCharts;
        if (billingComparisonCharts && Object.keys(billingComparisonCharts).length > 0) {
          const billingMeterIds = Object.keys(billingComparisonCharts);
          for (let meterIndex = 0; meterIndex < billingMeterIds.length; meterIndex++) {
            const meterId = billingMeterIds[meterIndex];
            const meterChartData = billingComparisonCharts[meterId];
            
            // Start each meter on a new page (except first meter which follows section heading)
            if (meterIndex > 0) {
              addFooter();
              addPageNumber();
              pdf.addPage();
              yPos = topMargin;
            }
            
            addSubsectionHeading(`Meter: ${meterChartData.meterNumber}${meterChartData.meterName ? ` (${meterChartData.meterName})` : ''}`);
            addSpacer(3);
            
            // Render charts in rows of 2 for better readability
            const chartEntries = Object.entries(meterChartData.charts || {});
            const chartWidth = (pageWidth - leftMargin - rightMargin - 5) / 2;
            const chartHeight = chartWidth * 0.75;
            
            for (let i = 0; i < chartEntries.length; i += 2) {
              // Check for page break
              if (yPos > pageHeight - bottomMargin - chartHeight - 20) {
                addFooter();
                addPageNumber();
                pdf.addPage();
                yPos = topMargin;
              }
              
              // Render up to 2 charts per row
              for (let j = 0; j < 2 && (i + j) < chartEntries.length; j++) {
                const [metricTitle, chartImage] = chartEntries[i + j];
                if (chartImage) {
                  const chartX = leftMargin + (j * (chartWidth + 5));
                  await addImageSafe(chartImage as string, chartX, yPos, chartWidth - 2, chartHeight);
                }
              }
              yPos += chartHeight + 2;
            }
          }
        } else {
          addText("No billing comparison data available.");
        }
        addSpacer(8);
        
        // Section 7: Metering Data Analysis (renumbered from 6)
        addSectionHeading("7. METERING DATA ANALYSIS", 16, true);
        await renderSection('metering-data-analysis');
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
        await renderSection('meter-type-chart');
        await renderSection('consumption-chart');
        
        addSubsectionHeading("Audit Period");
        addText(`${format(new Date(reconciliationData.readingsPeriod.split(' - ')[0]), 'dd MMM yyyy')} - ${format(new Date(reconciliationData.readingsPeriod.split(' - ')[1]), 'dd MMM yyyy')}`);
        addSpacer(5);
        
        addSubsectionHeading("Metering Infrastructure");
        addText(`Total Meters Analyzed: ${reconciliationData.meterCount}`);
        addSpacer(8);
        
        // Section 8: Document & Invoice Validation (if documents available) (renumbered from 7)
        const docValidationContent = getSectionContent('document-validation');
        if (docValidationContent) {
          addSectionHeading("8. DOCUMENT & INVOICE VALIDATION", 16, true);
          await renderSection('document-validation');
          addSpacer(8);
        }
        
        // Section 9: Reconciliation Results (renumbered from 8)
        addSectionHeading("9. RECONCILIATION RESULTS", 16, true);
        await renderSection('reconciliation-results');
        addSpacer(5);
        
        addSubsectionHeading("Basic Reconciliation Metrics");
        
        const basicMetricsRows = [
          ["Total Supply", `${formatNumber(parseFloat(reconciliationData.totalSupply))} kWh`],
          ["Distribution Total", `${formatNumber(parseFloat(reconciliationData.distributionTotal))} kWh`],
          ["Recovery Rate", `${formatNumber(parseFloat(reconciliationData.recoveryRate))}%`],
          ["Variance", `${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${formatNumber(parseFloat(reconciliationData.variance))} kWh (${parseFloat(reconciliationData.variancePercentage) > 0 ? "+" : ""}${reconciliationData.variancePercentage}%)`]
        ];
        
        addTable(["Metric", "Value"], basicMetricsRows, [100, 70], "Basic Reconciliation Metrics");
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
        
        addTable(["KPI Indicator", "Value"], kpiRows, [100, 70], "Data Collection KPIs");
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
            [50, 35, 25, 30, 30],
            "CSV Column Aggregations"
          );
          addSpacer(8);
        }
        
        // Section 10: Cost Analysis (if available) (renumbered from 9)
        const costAnalysisContent = getSectionContent('cost-analysis');
        if (costAnalysisContent) {
          addSectionHeading("10. COST ANALYSIS", 16, true);
          await renderSection('cost-analysis');
          addSpacer(8);
        }
        
        // Section 11: Findings & Anomalies (renumbered from 10)
        addSectionHeading("11. FINDINGS & ANOMALIES", 16, true);
        await renderSection('findings-anomalies');
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
          addTable(["#", "Severity", "Meter", "Description"], anomalySummaryRows, [10, 25, 35, 100], "Detected Anomalies");
          addSpacer(8);
        }
        
        // Section 12: Recommendations (renumbered from 11)
        addSectionHeading("12. RECOMMENDATIONS", 16, true);
        await renderSection('recommendations');
        addSpacer(8);
        
        // Add footer and page number to last page
        addFooter();
        addPageNumber();
        
        const pdfBlob = pdf.output('blob');
        const url = URL.createObjectURL(pdfBlob);
        return url;
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

      // 4. Fetch ALL tariff periods for assigned tariff names
      setGenerationProgress(35);
      setGenerationStatus("Loading tariff data...");
      
      // Get unique assigned tariff names from meters
      const uniqueTariffNames = [...new Set(
        selectedReconciliation.reconciliation_meter_results
          ?.map((r: any) => r.tariff_name)
          .filter(Boolean)
      )] as string[];

      let tariffStructures: any[] = [];
      let tariffsByName: Record<string, any[]> = {};
      
      if (uniqueTariffNames.length > 0 && siteData.supply_authority_id) {
        const { data: allTariffPeriods } = await supabase
          .from("tariff_structures")
          .select(`
            *,
            tariff_blocks(*),
            tariff_charges(*),
            tariff_time_periods(*),
            supply_authorities(name, region, nersa_increase_percentage)
          `)
          .in("name", uniqueTariffNames)
          .eq("supply_authority_id", siteData.supply_authority_id)
          .order("effective_from");
        
        tariffStructures = allTariffPeriods || [];
        
        // Group by tariff name
        tariffsByName = (allTariffPeriods || []).reduce((acc, tariff) => {
          if (!acc[tariff.name]) acc[tariff.name] = [];
          acc[tariff.name].push(tariff);
          return acc;
        }, {} as Record<string, any[]>);
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

      // 7. Use meter data from reconciliation results - deduplicate meters
      setGenerationProgress(40);
      setGenerationStatus("Processing meter data...");
      
      // Fetch additional meter details (area, rating, serial_number)
      const meterIds = [...new Set(
        selectedReconciliation.reconciliation_meter_results?.map((r: any) => r.meter_id).filter(Boolean)
      )] as string[];

      const { data: meterDetails } = await supabase
        .from("meters")
        .select("id, area, rating, serial_number, tariff_structure_id")
        .in("id", meterIds);

      const meterDetailsMap = new Map(meterDetails?.map(m => [m.id, m]) || []);

      // 6b. Fetch rate comparison data
      setGenerationProgress(42);
      setGenerationStatus("Loading rate comparison data...");
      
      // Fetch document tariff calculations
      const { data: documentCalculations } = await supabase
        .from("document_tariff_calculations")
        .select("*")
        .in("meter_id", meterIds)
        .order("period_start", { ascending: false });

      // Fetch document extractions with line items for rate comparison
      const rateCompDocumentIds = [...new Set(documentCalculations?.map(c => c.document_id) || [])];
      const { data: rateCompExtractions } = await supabase
        .from("document_extractions")
        .select("document_id, extracted_data, period_start, period_end")
        .in("document_id", rateCompDocumentIds);

      // Fetch all tariff charges for assigned tariffs
      const tariffIds = [...new Set(documentCalculations?.map(c => c.tariff_structure_id).filter(Boolean) || [])];
      const { data: allTariffCharges } = await supabase
        .from("tariff_charges")
        .select("*")
        .in("tariff_structure_id", tariffIds);

      // Group meter results by meter_number (not meter_id) to ensure proper deduplication
      // Use meter_number as the unique key since it's what identifies the meter in reports
      const meterDataMap = new Map();
      selectedReconciliation.reconciliation_meter_results?.forEach((result: any) => {
        const meterKey = result.meter_number; // Use meter_number as unique key
        if (!meterDataMap.has(meterKey)) {
          const meterDetail = meterDetailsMap.get(result.meter_id);
          meterDataMap.set(meterKey, {
            id: result.meter_id,
            meter_number: result.meter_number,
            name: result.meter_name,
            meter_type: result.meter_type,
            location: result.location,
            area: meterDetail?.area || null,
            rating: meterDetail?.rating || null,
            serial_number: meterDetail?.serial_number || null,
            tariff_structure_id: result.tariff_structure_id || meterDetail?.tariff_structure_id || null,
            totalKwh: 0,
            columnTotals: {},
            columnMaxValues: {},
            readingsCount: 0,
            assignment: result.assignment
          });
        }
        
        const meterEntry = meterDataMap.get(meterKey);
        // Aggregate totals across multiple reconciliation runs
        meterEntry.totalKwh += result.total_kwh || 0;
        meterEntry.readingsCount += result.readings_count || 0;
        
        // Aggregate column totals
        if (result.column_totals) {
          Object.entries(result.column_totals).forEach(([key, value]) => {
            meterEntry.columnTotals[key] = (meterEntry.columnTotals[key] || 0) + (value as number);
          });
        }
        
        // Keep max values for column max values
        if (result.column_max_values) {
          Object.entries(result.column_max_values).forEach(([key, value]) => {
            meterEntry.columnMaxValues[key] = Math.max(meterEntry.columnMaxValues[key] || 0, value as number);
          });
        }
      });
      
      const meterData = Array.from(meterDataMap.values());

      // Build rate comparison data using the same logic as TariffAssignmentTab
      const rateComparisonData: Record<string, any> = {};
      
      console.log('Meter data loaded:', meterData.length, 'meters');
      
      if (documentCalculations && documentCalculations.length > 0) {
        console.log('Document calculations found:', documentCalculations.length);
        
        // Group by meter and filter by assigned tariff to avoid duplicates
        const meterGroups = documentCalculations.reduce((acc: any, calc: any) => {
          const meter = meterData.find(m => m.id === calc.meter_id);
          const assignedTariffId = meter?.tariff_structure_id;
          
          // Only include calculations for the currently assigned tariff
          if (assignedTariffId && calc.tariff_structure_id !== assignedTariffId) {
            return acc; // Skip calculations for non-assigned tariffs
          }
          
          if (!acc[calc.meter_id]) {
            acc[calc.meter_id] = {
              meterNumber: meter?.meter_number || 'Unknown',
              meterName: meter?.name || '',
              calculations: []
            };
          }
          acc[calc.meter_id].calculations.push(calc);
          return acc;
        }, {});

        // Collect all unique tariff_structure_ids to batch fetch
        const uniqueTariffIds = new Set<string>();
        for (const calc of documentCalculations) {
          if (calc.tariff_structure_id) {
            uniqueTariffIds.add(calc.tariff_structure_id);
          }
        }
        const tariffIdArray = Array.from(uniqueTariffIds);
        console.log('Batch fetching tariff details for', tariffIdArray.length, 'unique tariffs');
        
        // Batch fetch ALL tariff details upfront in 3 parallel queries
        const [
          { data: allBlocks },
          { data: allPeriods },
          { data: allCharges }
        ] = await Promise.all([
          supabase.from("tariff_blocks").select("*").in("tariff_structure_id", tariffIdArray).order("block_number"),
          supabase.from("tariff_time_periods").select("*").in("tariff_structure_id", tariffIdArray),
          supabase.from("tariff_charges").select("*").in("tariff_structure_id", tariffIdArray)
        ]);
        
        // Build lookup cache for instant access
        const tariffCache = new Map<string, { blocks: any[], periods: any[], charges: any[] }>();
        tariffIdArray.forEach(id => {
          tariffCache.set(id, {
            blocks: (allBlocks || []).filter(b => b.tariff_structure_id === id),
            periods: (allPeriods || []).filter(p => p.tariff_structure_id === id),
            charges: (allCharges || []).filter(c => c.tariff_structure_id === id)
          });
        });
        console.log('Tariff cache built with', tariffCache.size, 'tariffs');

        // Process each meter's calculations using TariffAssignmentTab approach
        for (const [meterId, meterInfo] of Object.entries(meterGroups) as any) {
          const documents = [];
          
          for (const calc of meterInfo.calculations) {
            // Find matching extraction
            const extraction = rateCompExtractions?.find(e => e.document_id === calc.document_id);
            const extractedData = extraction?.extracted_data as any;
            const lineItems = extractedData?.line_items || [];
            
            if (lineItems.length === 0) continue;
            
            // Use cached tariff details - NO database calls
            const tariffDetails = tariffCache.get(calc.tariff_structure_id) || {
              blocks: [],
              periods: [],
              charges: []
            };
            
            // Determine season based on billing period
            const periodMonth = new Date(calc.period_start).getMonth() + 1;
            const isHighSeason = periodMonth >= 6 && periodMonth <= 8;
            const touSeason = isHighSeason ? 'winter' : 'summer';
            const chargeSeason = isHighSeason ? 'high' : 'low';
            
            // Build comparison items using same logic as TariffAssignmentTab (lines 2980-3098)
            const comparisonItems = [];
            
            for (const item of lineItems) {
              const description = (item.description || '').toLowerCase();
              const itemUnit = item.unit || 'kWh';
              const isEmergency = item.supply === 'Emergency';
              
              let tariffRate: number | null = null;
              let documentValue = item.rate && item.rate > 0 ? item.rate : item.amount || 0;
              
              // Skip Emergency supply - no standard tariff
              if (!isEmergency) {
                const isDemandCharge = itemUnit.toLowerCase() === 'kva';
                const isEnergyCharge = itemUnit.toLowerCase() === 'kwh';
                // Only treat as basic charge if unit is explicitly Monthly
                const isBasicCharge = itemUnit === 'Monthly';
                
                if (isBasicCharge || (item.amount && !item.rate)) {
                  // Basic/fixed charge
                  const matchingCharge = tariffDetails.charges.find((charge: any) => {
                    const chargeDesc = (charge.description || charge.charge_type).toLowerCase();
                    return description.includes('basic') && chargeDesc.includes('basic');
                  });
                  if (matchingCharge) {
                    tariffRate = matchingCharge.charge_amount;
                  }
                } else if (isDemandCharge && item.rate && item.rate > 0) {
                  // Demand charge
                  const demandCharge = tariffDetails.charges.find((charge: any) => 
                    charge.charge_type === `demand_${chargeSeason}_season` ||
                    (charge.charge_type.toLowerCase().includes('demand') && 
                     charge.charge_type.toLowerCase().includes(chargeSeason))
                  );
                  if (demandCharge && (demandCharge.unit === 'R/kVA' || demandCharge.unit === 'c/kVA')) {
                    const rateValue = demandCharge.unit === 'c/kVA' 
                      ? demandCharge.charge_amount / 100 
                      : demandCharge.charge_amount;
                    tariffRate = rateValue;
                  }
                } else if (!isDemandCharge && item.rate && item.rate > 0) {
                  // Energy charge - try TOU periods first
                  if (tariffDetails.periods.length > 0) {
                    const seasonalPeriods = tariffDetails.periods.filter((p: any) => 
                      p.season.toLowerCase().includes(touSeason)
                    );
                    
                    if (seasonalPeriods.length > 0) {
                      const standardPeriod = seasonalPeriods.find((p: any) => 
                        p.period_type.toLowerCase().includes('standard') || 
                        p.period_type.toLowerCase().includes('off')
                      );
                      
                      if (standardPeriod) {
                        tariffRate = standardPeriod.energy_charge_cents / 100;
                      } else {
                        const avgRate = seasonalPeriods.reduce((sum: number, p: any) => sum + p.energy_charge_cents, 0) / seasonalPeriods.length;
                        tariffRate = avgRate / 100;
                      }
                    }
                  }
                  
                  // Try blocks if no TOU rate found
                  if (tariffRate === null && tariffDetails.blocks.length > 0 && item.consumption) {
                    const matchingBlock = tariffDetails.blocks.find((block: any) => {
                      if (block.kwh_to === null) {
                        return item.consumption >= block.kwh_from;
                      }
                      return item.consumption >= block.kwh_from && item.consumption <= block.kwh_to;
                    });
                    if (matchingBlock) {
                      tariffRate = matchingBlock.energy_charge_cents / 100;
                    }
                  }
                  
                  // Try tariff_charges as last resort
                  if (tariffRate === null && tariffDetails.charges.length > 0) {
                    const seasonalCharge = tariffDetails.charges.find((charge: any) => {
                      const chargeTypeLower = charge.charge_type.toLowerCase();
                      return (chargeTypeLower === `energy_${chargeSeason}_season`) ||
                             (chargeTypeLower.includes('energy') && chargeTypeLower.includes(chargeSeason)) ||
                             (chargeTypeLower.includes('energy') && (chargeTypeLower.includes('both') || chargeTypeLower.includes('all')));
                    });
                    
                    if (seasonalCharge && seasonalCharge.unit === 'c/kWh') {
                      tariffRate = seasonalCharge.charge_amount / 100;
                    }
                  }
                }
              }
              
              // Calculate variance
              let variancePercent: number | null = null;
              if (item.rate && item.rate > 0 && tariffRate !== null) {
                variancePercent = ((tariffRate - item.rate) / item.rate) * 100;
              } else if (itemUnit === 'Monthly' && item.amount && item.amount > 0 && tariffRate !== null) {
                variancePercent = ((tariffRate - item.amount) / item.amount) * 100;
              }
              
              const getChargeTypeLabel = (unit: string) => {
                switch(unit) {
                  case 'Monthly': return 'Basic Charge';
                  case 'kVA': return `Demand Charge ${isHighSeason ? '(Winter)' : '(Summer)'}`;
                  case 'kWh': return `Seasonal Charge ${isHighSeason ? '(Winter)' : '(Summer)'}`;
                  default: return 'Other';
                }
              };
              
              comparisonItems.push({
                chargeType: `${item.supply || 'Normal'} (R/${itemUnit}) - ${getChargeTypeLabel(itemUnit)}`,
                unit: itemUnit,
                supply: item.supply || 'Normal',
                documentValue,
                assignedValue: tariffRate,
                variancePercent
              });
            }
            
            // Calculate overall variance for document
            const validVariances = comparisonItems
              .filter(item => item.variancePercent !== null)
              .map(item => Math.abs(item.variancePercent!));
            
            const overallVariance = validVariances.length > 0
              ? validVariances.reduce((sum, v) => sum + v, 0) / validVariances.length
              : null;
            
            documents.push({
              documentId: calc.document_id,
              periodStart: calc.period_start,
              periodEnd: calc.period_end,
              season: isHighSeason ? 'winter' : 'summer',
              lineItems: comparisonItems,
              overallVariance
            });
          }
          
          rateComparisonData[meterId] = {
            meterNumber: meterInfo.meterNumber,
            meterName: meterInfo.meterName,
            documents
          };
        }
      }
      
      // Debug logging for rate comparison data
      console.log('Rate comparison data meters:', Object.keys(rateComparisonData));
      for (const [meterId, data] of Object.entries(rateComparisonData)) {
        console.log(`Meter ${meterId}: ${(data as any).meterNumber} - ${(data as any).documents?.length} documents`);
      }

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
        meterCount: meterData.length,
        councilBulkCount: meterData.filter((m: any) => m.meter_type === "bulk_meter").length,
        councilMeterCount: meterData.filter((m: any) => m.meter_type === "council_meter").length,
        otherCount: meterData.filter((m: any) => m.meter_type === "other").length,
        distributionCount: meterData.filter((m: any) => m.meter_type === "tenant_meter").length,
        checkMeterCount: meterData.filter((m: any) => m.meter_type === "check_meter").length,
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

      // 7. Load and compress snippet image
      setGenerationProgress(60);
      setGenerationStatus("Loading snippet image...");
      
      let schematicImageBase64 = null;

      // Find the selected snippet from availableSnippets
      const selectedSnippet = availableSnippets.find(s => s.id === selectedSchematicId);

      if (selectedSnippet?.snippetUrl) {
        try {
          // Fetch the snippet image directly from the public URL
          const response = await fetch(selectedSnippet.snippetUrl);
          const blob = await response.blob();
          
          // Create an image element to compress
          const img = new Image();
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
              
              // Fill canvas with white background (JPEG doesn't support transparency)
              if (ctx) {
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, width, height);
              }
              
              // Draw image on top of white background - PNG for lossless quality
              ctx?.drawImage(img, 0, 0, width, height);
              schematicImageBase64 = canvas.toDataURL('image/png');
              
              URL.revokeObjectURL(url);
              resolve(null);
            };
            img.onerror = reject;
            img.src = url;
          });
        } catch (err) {
          console.error("Error loading snippet image:", err);
        }
      }

      // 8. Prepare meter breakdown from reconciliation data using saved schematic order
      const sortMetersBySchematicOrder = (meters: any[]) => {
        if (!selectedReconciliation.meter_order || selectedReconciliation.meter_order.length === 0) {
          // Fallback to type-based sorting if no meter_order is saved
          return meters.sort((a, b) => {
            const typeOrder = { council_meter: 1, bulk_meter: 2, check_meter: 3, tenant_meter: 4, other: 5 };
            const aOrder = typeOrder[a.meter_type as keyof typeof typeOrder] || 99;
            const bOrder = typeOrder[b.meter_type as keyof typeof typeOrder] || 99;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return (a.meter_number || "").localeCompare(b.meter_number || "");
          });
        }

        // Create a map for quick lookup
        const meterMap = new Map(meters.map(m => [m.id, m]));
        const orderedMeters: any[] = [];
        
        // Add meters in the saved order
        selectedReconciliation.meter_order.forEach(meterId => {
          const meter = meterMap.get(meterId);
          if (meter) {
            orderedMeters.push(meter);
            meterMap.delete(meterId);
          }
        });
        
        // Add any remaining meters not in the saved order (safety fallback)
        meterMap.forEach(meter => orderedMeters.push(meter));
        
        return orderedMeters;
      };

      // Helper to format meter type
      const formatMeterType = (type: string) => {
        const labels: Record<string, string> = {
          council_meter: "Council Meter",
          bulk_meter: "Bulk Meter",
          check_meter: "Check Meter",
          tenant_meter: "Tenant Meter",
          other: "Other"
        };
        return labels[type] || type;
      };

      // Helper to format charge type
      const formatChargeType = (type: string): string => {
        const labels: Record<string, string> = {
          basic_charge: "Basic Charge",
          energy_high_season: "Energy (High Season)",
          energy_low_season: "Energy (Low Season)",
          demand_high_season: "Demand (High Season)",
          demand_low_season: "Demand (Low Season)",
          network_capacity: "Network Capacity",
          network_demand: "Network Demand"
        };
        return labels[type] || type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      };

      // Helper to format tariff type
      const formatTariffType = (type: string): string => {
        return type.charAt(0).toUpperCase() + type.slice(1);
      };

      // Helper to format period
          const formatPeriod = (from: string, to: string | null): string => {
            const fromDate = new Date(from);
            const toDate = to ? new Date(to) : null;
            return `${format(fromDate, "MMM yyyy")} - ${toDate ? format(toDate, "MMM yyyy") : 'Present'}`;
          };

          const formatPeriodLabel = (from: string): string => {
            return format(new Date(from), "yyyy");
          };

      const meterBreakdown = sortMetersBySchematicOrder(meterData).map(m => ({
        meterNumber: m.meter_number,
        name: m.name,
        type: m.meter_type,
        area: m.area,
        rating: m.rating,
        serialNumber: m.serial_number
      }));

      // Helper to convert blob to base64 data URL
      const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      };

      // Fetch pre-captured tariff charts from storage (SVG format)
      const tariffChartImages: Record<string, { basic?: string; energy?: string; demand?: string }> = {};

      // Sanitize names for file paths
      const sanitizeForPath = (str: string) => str
        .replace(/≥/g, 'gte')
        .replace(/≤/g, 'lte')
        .replace(/&/g, 'and')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/[^\x00-\x7F]/g, '')
        .trim();

      const supplyAuthorityName = siteDetails.supplyAuthorityName || '';
      const supplyAuthorityRegion = siteDetails.supplyAuthorityRegion || '';

      if (supplyAuthorityName && supplyAuthorityRegion && uniqueTariffNames.length > 0) {
        const sanitizedProvince = sanitizeForPath(supplyAuthorityRegion);
        const sanitizedMunicipality = sanitizeForPath(supplyAuthorityName);
        const basePath = `Graphs/${sanitizedProvince}/${sanitizedMunicipality}`;

        // Chart types to fetch (use high season for energy/demand) - now SVG format
        const chartTypes = [
          { key: 'basic', filename: 'basic-charge' },
          { key: 'energy', filename: 'energy-high-season' },
          { key: 'demand', filename: 'demand-high-season' },
        ];

        for (const tariffName of uniqueTariffNames) {
          const sanitizedTariff = sanitizeForPath(tariffName);
          tariffChartImages[tariffName] = {};

          for (const { key, filename } of chartTypes) {
            try {
              // Try SVG first, fall back to PNG for backwards compatibility
              let filePath = `${basePath}/${sanitizedTariff}-${filename}.svg`;
              console.log(`Attempting to fetch chart: ${filePath}`);
              
              let { data, error } = await supabase.storage
                .from('tariff-files')
                .download(filePath);

              // Fallback to PNG if SVG not found
              if (error || !data) {
                console.log(`SVG not found for ${tariffName} - ${filename}, trying PNG fallback`);
                filePath = `${basePath}/${sanitizedTariff}-${filename}.png`;
                const fallbackResult = await supabase.storage
                  .from('tariff-files')
                  .download(filePath);
                data = fallbackResult.data;
                error = fallbackResult.error;
              }

              if (data && !error) {
                // For SVG, store as text; for PNG, convert to base64
                if (filePath.endsWith('.svg')) {
                  const svgText = await data.text();
                  console.log(`Successfully loaded SVG chart for ${tariffName} - ${filename}`);
                  (tariffChartImages[tariffName] as any)[key] = { type: 'svg', content: svgText };
                } else {
                  const base64 = await blobToBase64(data);
                  console.log(`Successfully loaded PNG chart for ${tariffName} - ${filename}`);
                  (tariffChartImages[tariffName] as any)[key] = { type: 'png', content: base64 };
                }
              } else {
                console.warn(`Chart not found in storage: ${tariffName} - ${filename}`, error?.message);
              }
            } catch (e) {
              console.error(`Error fetching chart for ${tariffName} - ${filename}:`, e);
            }
          }
        }
      }

      // 9. Prepare meter hierarchy from reconciliation data using saved schematic order
      const meterHierarchy = sortMetersBySchematicOrder(meterData).map(m => ({
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
        if (value == null || isNaN(value)) return '0.00';
        // Split on decimal, format integer part, then rejoin
        const fixed = value.toFixed(decimals);
        const [intPart, decPart] = fixed.split('.');
        const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return decPart ? `${formattedInt}.${decPart}` : formattedInt;
      };

      // Build tariff comparison content separately to avoid scoping issues
      let tariffComparisonContent = 'No rate comparison data available. Ensure meters have assigned tariffs and associated documents with line items.';
      
      // Initialize structure to store comparison charts for Section 6
      const rateComparisonCharts: Record<string, {
        meterNumber: string;
        meterName?: string;
        charts: Record<string, string>;
      }> = {};
      
      if (rateComparisonData && Object.keys(rateComparisonData).length > 0) {
        const comparisonSections = [];
        
        // Sort meters according to hierarchy order
        const meterOrder = selectedReconciliation?.meter_order || [];
        const sortedMeterEntries = Object.entries(rateComparisonData)
          .sort(([meterIdA], [meterIdB]) => {
            const indexA = meterOrder.indexOf(meterIdA);
            const indexB = meterOrder.indexOf(meterIdB);
            // If meter not in order array, put at end
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
          });
        
        for (const [meterId, meterComparisonData] of sortedMeterEntries as [string, any][]) {
          const meterTitle = `Meter: ${meterComparisonData.meterNumber}${meterComparisonData.meterName ? ` (${meterComparisonData.meterName})` : ''}`;
          let content = `### ${meterTitle}\n\n`;
          
          if (!meterComparisonData.documents || !Array.isArray(meterComparisonData.documents)) {
            content += 'No document comparisons available.\n\n';
            comparisonSections.push(content);
            continue;
          }
          
          // Collect chart data by charge type as we build the table
          const chartDataByType: Record<string, Array<{period: string; documentValue: number; assignedValue: number | null}>> = {};
          
          // Build table content separately
          let tableContent = '| Period | Item | Document | Assigned | Variance |\n';
          tableContent += '|--------|------|----------|----------|----------|\n';
          
          for (const doc of meterComparisonData.documents) {
            const periodStart = doc.periodStart ? format(new Date(doc.periodStart), "MMM yyyy") : 'N/A';
            const periodEnd = doc.periodEnd ? format(new Date(doc.periodEnd), "MMM yyyy") : 'N/A';
            const period = `${periodStart} - ${periodEnd}`;
            
            if (doc.lineItems && Array.isArray(doc.lineItems)) {
              for (const item of doc.lineItems) {
                // Skip Emergency supply items - they have no assigned tariff
                if (item.supply === 'Emergency') continue;
                
                const docVal = item.documentValue ? formatNumber(item.documentValue, 4) : '—';
                const assignedVal = item.assignedValue ? formatNumber(item.assignedValue, 4) : '—';
                const varPercent = item.variancePercent != null ? formatNumber(item.variancePercent, 1) + '%' : '—';
                
                tableContent += `| ${period} | ${item.chargeType} (${item.unit}) | ${docVal} | ${assignedVal} | ${varPercent} |\n`;
                
                // Collect data for charts (only if both values exist)
                if (item.documentValue != null && item.assignedValue != null) {
                  const chartKey = `${item.chargeType} (${item.unit})`;
                  if (!chartDataByType[chartKey]) {
                    chartDataByType[chartKey] = [];
                  }
                  chartDataByType[chartKey].push({
                    period,
                    documentValue: item.documentValue,
                    assignedValue: item.assignedValue
                  });
                }
              }
            }
          }
          tableContent += '\n';
          
          // Store charts in rateComparisonCharts for PDF rendering (Section 6)
          if (!rateComparisonCharts[meterId]) {
            rateComparisonCharts[meterId] = {
              meterNumber: meterComparisonData.meterNumber,
              meterName: meterComparisonData.meterName,
              charts: {}
            };
          }
          
          // Generate and store charts
          for (const [chargeType, chartData] of Object.entries(chartDataByType)) {
            if (chartData.length > 0) {
              try {
                // Sort chart data chronologically (oldest to newest / left to right)
                const sortedChartData = [...chartData].sort((a, b) => {
                  // Extract start date from period string "MMM yyyy - MMM yyyy"
                  const dateA = new Date(a.period.split(' - ')[0]);
                  const dateB = new Date(b.period.split(' - ')[0]);
                  return dateA.getTime() - dateB.getTime();
                });
                
                const chartImage = generateDocumentVsAssignedChart(
                  chargeType,
                  '',  // Unit is already in the title
                  sortedChartData,
                  500,
                  320
                );
                
                // Store in rateComparisonCharts for Section 6 PDF rendering
                rateComparisonCharts[meterId].charts[chargeType] = chartImage;
              } catch (err) {
                console.error(`Error generating chart for ${chargeType}:`, err);
              }
            }
          }
          
          // Only include table in Section 4 (charts moved to Section 6)
          content += tableContent;
          
          comparisonSections.push(content);
        }
        
        tariffComparisonContent = comparisonSections.join('\n\n');
      }

      // Fetch documents with extractions early for both tariff analysis and billing comparison
      setGenerationProgress(65);
      setGenerationStatus("Fetching document data...");
      
      const { data: docsWithExtractions } = await supabase
        .from('site_documents')
        .select('*, document_extractions(*)')
        .eq('site_id', siteId)
        .eq('is_folder', false)
        .order('upload_date', { ascending: true });

      // Generate billing comparison charts for Section 6 (Reconciliation Cost vs Document Billed)
      const billingComparisonCharts: Record<string, {
        meterNumber: string;
        meterName?: string;
        charts: Record<string, string>;
      }> = {};

      if (selectedReconciliation?.reconciliation_meter_results && docsWithExtractions) {
        // Group documents by meter
        const meterDocsMap = new Map<string, any[]>();
        docsWithExtractions.forEach(doc => {
          if (doc.meter_id && doc.document_extractions?.length > 0) {
            if (!meterDocsMap.has(doc.meter_id)) {
              meterDocsMap.set(doc.meter_id, []);
            }
            meterDocsMap.get(doc.meter_id)!.push(doc);
          }
        });

        // Sort meters according to hierarchy order
        const meterOrder = selectedReconciliation.meter_order || [];
        const sortedMeterResults = [...selectedReconciliation.reconciliation_meter_results]
          .sort((a, b) => {
            const indexA = meterOrder.indexOf(a.meter_id);
            const indexB = meterOrder.indexOf(b.meter_id);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
          });

        // Create lookup map for document_tariff_calculations
        const docCalcMap = new Map<string, any>();
        documentCalculations?.forEach(calc => {
          const key = `${calc.meter_id}_${calc.document_id}`;
          docCalcMap.set(key, calc);
        });

        for (const meterResult of sortedMeterResults) {
          const meterDocs = meterDocsMap.get(meterResult.meter_id) || [];
          if (meterDocs.length === 0) continue;

          billingComparisonCharts[meterResult.meter_id] = {
            meterNumber: meterResult.meter_number,
            meterName: meterResult.meter_name,
            charts: {}
          };

          // Metrics to compare
          const metrics = [
            { key: 'Total Costs', label: 'Total Costs' },
            { key: 'Basic Charge', label: 'Basic Charge' },
            { key: 'Demand Charge', label: 'Demand Charge' },
            { key: 'Energy Charge', label: 'Energy Charge' }
          ];

          for (const metric of metrics) {
            const chartData: { period: string; reconciliationValue: number; documentValue: number }[] = [];

            for (const doc of meterDocs) {
              const extraction = doc.document_extractions[0];
              if (!extraction) continue;

              const periodStart = extraction.period_start ? new Date(extraction.period_start) : null;
              const periodEnd = extraction.period_end ? new Date(extraction.period_end) : null;
              if (!periodStart || !periodEnd) continue;

              // Ensure consistent x-axis labels (always show date range)
              const startLabel = format(periodStart, "MMM yyyy");
              const endLabel = format(periodEnd, "MMM yyyy");
              const periodLabel = startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;

              // Get pre-calculated values from document_tariff_calculations
              const calcKey = `${meterResult.meter_id}_${doc.id}`;
              const docCalc = docCalcMap.get(calcKey);
              
              console.log(`📊 [Chart Debug] ${metric.key} - Period: ${periodLabel}`, {
                periodStart: periodStart.toISOString(),
                periodEnd: periodEnd.toISOString(),
                docCalc: docCalc ? {
                  total_cost: docCalc.total_cost,
                  fixed_charges: docCalc.fixed_charges,
                  demand_charges: docCalc.demand_charges,
                  energy_cost: docCalc.energy_cost
                } : 'NOT FOUND',
                documentId: doc.id
              });
              
              // Extract values based on metric
              let calculatedValue = 0;
              let documentValue = 0;

              const lineItems = extraction.extracted_data?.line_items || [];

              if (metric.key === 'Total Costs') {
                // Use pre-calculated total_cost vs document total_amount
                calculatedValue = docCalc?.total_cost || 0;
                documentValue = extraction.total_amount || 0;
              } else if (metric.key === 'Basic Charge') {
                // From docCalc: fixed_charges; From document: unit === 'Monthly' items
                calculatedValue = docCalc?.fixed_charges || 0;
                const basicItems = lineItems.filter((item: any) => 
                  item.unit === 'Monthly' || 
                  item.description?.toLowerCase().includes('basic')
                );
                documentValue = basicItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
              } else if (metric.key === 'Demand Charge') {
                // From docCalc: demand_charges; From document: unit === 'kVA' items
                calculatedValue = docCalc?.demand_charges || 0;
                const demandItems = lineItems.filter((item: any) => item.unit === 'kVA');
                documentValue = demandItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
              } else if (metric.key === 'Energy Charge') {
                // From docCalc: energy_cost; From document: unit === 'kWh' items
                calculatedValue = docCalc?.energy_cost || 0;
                const energyItems = lineItems.filter((item: any) => 
                  item.unit === 'kWh' && item.supply === 'Normal'
                );
                documentValue = energyItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
              }

              if (calculatedValue > 0 || documentValue > 0) {
                chartData.push({
                  period: periodLabel,
                  reconciliationValue: calculatedValue,
                  documentValue
                });
              }
            }

            if (chartData.length > 0) {
              try {
                // Sort chronologically
                const sortedChartData = [...chartData].sort((a, b) => {
                  const dateA = new Date(a.period.split(' - ')[0]);
                  const dateB = new Date(b.period.split(' - ')[0]);
                  return dateA.getTime() - dateB.getTime();
                });

                const chartImage = generateReconciliationVsDocumentChart(
                  metric.label,
                  sortedChartData,
                  500,
                  320
                );

                billingComparisonCharts[meterResult.meter_id].charts[metric.label] = chartImage;
              } catch (err) {
                console.error(`Error generating billing comparison chart for ${metric.label}:`, err);
              }
            }
          }
        }
      }

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
| Council Meters | ${reconciliationData.councilMeterCount} |
| Bulk Meters | ${reconciliationData.councilBulkCount} |
| Check Meters | ${reconciliationData.checkMeterCount} |
| Tenant Meters | ${reconciliationData.distributionCount} |
| Other Meters | ${reconciliationData.otherCount} |
| **Total** | **${reconciliationData.meterCount}** |

### All Meters

| NO | Name | Type | Area | Rating | Serial |
|----|------|------|------|--------|--------|
${meterBreakdown.map(m => `| ${m.meterNumber} | ${m.name || '—'} | ${formatMeterType(m.type)} | ${m.area ? `${m.area}m²` : '—'} | ${m.rating || '—'} | ${m.serialNumber || '—'} |`).join('\n')}`,

          tariffConfiguration: `### Tariff Structures

${Object.keys(tariffsByName).length > 0 ? Object.entries(tariffsByName).map(([tariffName, periods]) => {
  const latestPeriod = periods[periods.length - 1];
  const charges = latestPeriod?.tariff_charges || [];
  const blocks = latestPeriod?.tariff_blocks || [];
  
  return `#### ${tariffName}

**Tariff Overview**

| Attribute | Value |
|-----------|-------|
| Type | ${formatTariffType(latestPeriod?.tariff_type || 'N/A')} |
| Voltage Level | ${latestPeriod?.voltage_level || 'N/A'} |
| Meter Configuration | ${latestPeriod?.meter_configuration || 'N/A'} |
| Transmission Zone | ${latestPeriod?.transmission_zone || 'N/A'} |
| Effective From | ${format(new Date(latestPeriod.effective_from), "dd MMM yyyy")} |
| Effective To | ${latestPeriod.effective_to ? format(new Date(latestPeriod.effective_to), "dd MMM yyyy") : 'Current'} |
| Uses TOU | ${latestPeriod?.uses_tou ? 'Yes' : 'No'} |

${blocks.length > 0 ? `**Energy Blocks:**

| Block | From (kWh) | To (kWh) | Rate (c/kWh) |
|-------|------------|----------|--------------|
${blocks.map((block: any) => `| ${block.block_number} | ${formatNumber(block.kwh_from, 0)} | ${block.kwh_to ? formatNumber(block.kwh_to, 0) : 'Unlimited'} | ${formatNumber(block.energy_charge_cents / 100, 4)} |`).join('\n')}` : ''}

${charges.length > 0 ? `**Charges (Current Period):**

| Type | Description | Amount | Unit |
|------|-------------|--------|------|
${charges.map((charge: any) => `| ${formatChargeType(charge.charge_type)} | ${charge.description || '—'} | ${formatNumber(charge.charge_amount)} | ${charge.unit} |`).join('\n')}` : ''}
`;
}).join('\n\n') : 'No tariff structures configured for this site.'}`,

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
- Documents analyzed: ${documentExtractions.length}`,

          tariffComparison: tariffComparisonContent
        }
      };

      // Load pre-captured tariff analysis charts from storage (instead of generating on-the-fly)
      setGenerationProgress(80);
      setGenerationStatus("Loading captured analysis charts...");
      
      const tariffAnalysisCharts: Record<string, Record<string, string>> = {};
      
      // Get site and client names for storage path
      const { data: sitePathData } = await supabase
        .from('sites')
        .select('name, clients(name)')
        .eq('id', siteId)
        .single();
      
      if (sitePathData) {
        const sanitizeForStoragePath = (str: string) => str
          .trim()
          .replace(/[^a-zA-Z0-9\s-_]/g, '')
          .replace(/\s+/g, ' ');
        
        const clientName = sanitizeForStoragePath((sitePathData.clients as any)?.name || '');
        const siteNamePath = sanitizeForStoragePath(sitePathData.name);
        const analysisGraphsPath = `${clientName}/${siteNamePath}/Metering/Reconciliations/Graphs/Analysis`;
        
        // Metric mappings: chart filename to display name
        const chartMetrics = [
          { filename: 'total', displayName: 'Total Amount' },
          { filename: 'basic', displayName: 'Basic Charge' },
          { filename: 'kva-charge', displayName: 'kVA Charge' },
          { filename: 'kwh-charge', displayName: 'kWh Charge' },
          { filename: 'kva-consumption', displayName: 'kVA Consumption' },
          { filename: 'kwh-consumption', displayName: 'kWh Consumption' },
        ];
        
        // List files in the analysis charts folder
        console.log(`Looking for analysis charts in: ${analysisGraphsPath}`);
        const { data: chartFiles, error: listError } = await supabase.storage
          .from('client-files')
          .list(analysisGraphsPath, { limit: 1000 });
        
        if (listError) {
          console.warn('Could not list analysis chart files:', listError.message);
        } else if (chartFiles && chartFiles.length > 0) {
          console.log(`Found ${chartFiles.length} chart files in storage`);
          
          // Group chart files by meter (extract meter number from filename like "M-001-total.svg")
          const chartsByMeter = new Map<string, Map<string, string>>();
          
          for (const file of chartFiles) {
            if (!file.name.endsWith('.svg')) continue;
            
            // Parse filename: {meterNumber}-{metricFilename}.svg
            // e.g., "M-001-total.svg" -> meterNumber="M-001", metric="total"
            const nameWithoutExt = file.name.replace('.svg', '');
            
            // Find which metric this file is for
            for (const metric of chartMetrics) {
              if (nameWithoutExt.endsWith(`-${metric.filename}`)) {
                const meterNumber = nameWithoutExt.slice(0, -(metric.filename.length + 1));
                
                if (!chartsByMeter.has(meterNumber)) {
                  chartsByMeter.set(meterNumber, new Map());
                }
                
                // Download the SVG content
                const filePath = `${analysisGraphsPath}/${file.name}`;
                const { data: svgData, error: downloadError } = await supabase.storage
                  .from('client-files')
                  .download(filePath);
                
                if (svgData && !downloadError) {
                  const svgText = await svgData.text();
                  // Convert SVG to data URL for embedding in PDF
                  const encoded = encodeURIComponent(svgText)
                    .replace(/'/g, '%27')
                    .replace(/"/g, '%22');
                  const dataUrl = `data:image/svg+xml,${encoded}`;
                  chartsByMeter.get(meterNumber)!.set(metric.displayName, dataUrl);
                  console.log(`Loaded chart: ${meterNumber} - ${metric.displayName}`);
                }
                break;
              }
            }
          }
          
          // Convert chartsByMeter to tariffAnalysisCharts (keyed by meter ID)
          // We need to match meter_number back to meter.id
          for (const [meterNumber, metricsMap] of chartsByMeter.entries()) {
            // Find meter by meter_number
            const meter = meterData.find(m => m.meter_number === meterNumber);
            if (meter) {
              tariffAnalysisCharts[meter.id] = {};
              for (const [metricName, chartDataUrl] of metricsMap.entries()) {
                tariffAnalysisCharts[meter.id][metricName] = chartDataUrl;
              }
            }
          }
          
          console.log(`Loaded analysis charts for ${Object.keys(tariffAnalysisCharts).length} meters`);
        } else {
          console.log('No pre-captured analysis charts found in storage');
        }
      }

      // Generate other chart images for preview
      setGenerationProgress(85);
      setGenerationStatus("Generating chart visualizations...");
      
      const meterTypeChart = generateMeterTypeChart(meterData);
      const consumptionChart = generateConsumptionChart(meterData);

      // Store preview data with all charts including tariff analysis
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
        tariffChartImages,
        tariffsByName,
        tariffAnalysisCharts, // Add tariff analysis charts for PDF rendering
        rateComparisonCharts, // Add rate comparison charts for Section 4 PDF rendering
        billingComparisonCharts, // Add billing comparison charts for Section 6 PDF rendering
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
        
        // Section 4: Tariff Comparison
        if (reportData.sections.tariffComparison) {
          sections.push({
            id: 'tariff-comparison',
            title: '4. Tariff Comparison',
            content: reportData.sections.tariffComparison,
            type: 'text',
            editable: true
          });
        }

        // Section 5: Tariff Analysis (using pre-generated charts)
        let tariffAnalysisContent = '## 5. Tariff Analysis\n\n';
        tariffAnalysisContent += 'Analysis of billing trends and cost breakdowns for each meter.\n\n';
        
        if (tariffAnalysisCharts && Object.keys(tariffAnalysisCharts).length > 0) {
          for (const meterId of Object.keys(tariffAnalysisCharts)) {
            const meter = meterData.find(m => m.id === meterId);
            if (!meter) continue;
            
            tariffAnalysisContent += `### Meter: ${meter.meter_number}${meter.name ? ` (${meter.name})` : ''}\n\n`;
            
            const meterCharts = tariffAnalysisCharts[meterId];
            const metrics = ['Total Amount', 'Basic Charge', 'kVA Charge', 'kWh Charge', 'kVA Consumption', 'kWh Consumption'];
            
            for (const metric of metrics) {
              if (meterCharts[metric]) {
                tariffAnalysisContent += `#### ${metric}\n\n`;
                tariffAnalysisContent += `![${metric} chart](${meterCharts[metric]})\n`;
                tariffAnalysisContent += `*${metric} trends with seasonal averages*\n\n`;
              }
            }
          }
        }

        sections.push({
          id: 'tariff-analysis',
          title: '5. Tariff Analysis',
          content: tariffAnalysisContent,
          type: 'text',
          editable: true
        });
        
        // Section 6: Rate Comparison Charts (Document vs Assigned)
        let rateComparisonChartsContent = '## 6. Rate Comparison Charts\n\n';
        rateComparisonChartsContent += 'Document values compared against assigned tariff rates for each meter.\n\n';
        
        if (rateComparisonCharts && Object.keys(rateComparisonCharts).length > 0) {
          for (const meterId of Object.keys(rateComparisonCharts)) {
            const meterChartData = rateComparisonCharts[meterId];
            rateComparisonChartsContent += `### Meter: ${meterChartData.meterNumber}${meterChartData.meterName ? ` (${meterChartData.meterName})` : ''}\n\n`;
            
            for (const [chargeType, chartImage] of Object.entries(meterChartData.charts)) {
              rateComparisonChartsContent += `#### ${chargeType}\n`;
              rateComparisonChartsContent += `![${chargeType} Comparison](${chartImage})\n\n`;
            }
          }
        }
        
        sections.push({
          id: 'rate-comparison-charts',
          title: '6. Rate Comparison Charts',
          content: rateComparisonChartsContent,
          type: 'text',
          editable: true
        });
        
        // Section 7: Metering Data Analysis (renumbered from 6)
        if (reportData.sections.meteringDataAnalysis) {
          sections.push({
            id: 'metering-data-analysis',
            title: '7. Metering Data Analysis',
            content: `## 7. Metering Data Analysis\n\n${reportData.sections.meteringDataAnalysis}`,
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
        
        // Section 8: Document & Invoice Validation (renumbered from 7)
        if (reportData.sections.documentValidation) {
          sections.push({
            id: 'document-validation',
            title: '8. Document & Invoice Validation',
            content: `## 8. Document & Invoice Validation\n\n${reportData.sections.documentValidation}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 9: Reconciliation Results (renumbered from 8)
        if (reportData.sections.reconciliationResults) {
          sections.push({
            id: 'reconciliation-results',
            title: '9. Reconciliation Results',
            content: `## 9. Reconciliation Results\n\n${reportData.sections.reconciliationResults}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 10: Cost Analysis (renumbered from 9)
        if (reportData.sections.costAnalysis) {
          sections.push({
            id: 'cost-analysis',
            title: '10. Cost Analysis',
            content: `## 10. Cost Analysis\n\n${reportData.sections.costAnalysis}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 11: Findings & Anomalies (renumbered from 10)
        if (reportData.sections.findingsAnomalies) {
          sections.push({
            id: 'findings-anomalies',
            title: '11. Findings & Anomalies',
            content: `## 11. Findings & Anomalies\n\n${reportData.sections.findingsAnomalies}`,
            type: 'text',
            editable: true
          });
        }
        
        // Section 12: Recommendations (renumbered from 11)
        if (reportData.sections.recommendations) {
          sections.push({
            id: 'recommendations',
            title: '12. Recommendations',
            content: `## 12. Recommendations\n\n${reportData.sections.recommendations}`,
            type: 'text',
            editable: true
          });
        }
      }
      
      setEditableSections(sections);
      setIsEditingContent(true); // Go directly to editor
      setCurrentPage(1); // Reset to first page
      // Collapse all selections after generating preview
      setSnippetExpanded(false);
      setFoldersExpanded(false);
      setReconciliationsExpanded(false);

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
      // Use the same PDF generation as preview to ensure they're identical
      const pdfDataUrl = await generatePdfPreview(editableSections);
      
      if (!pdfDataUrl) {
        throw new Error("Failed to generate PDF");
      }

      // Convert data URL to blob
      const response = await fetch(pdfDataUrl);
      const blob = await response.blob();
      
      setPendingPdfBlob(blob);
      setShowSaveDialog(true);
      
      toast.success("Report generated successfully!");
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate report. Please try again.");
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
        {/* Schematic Snippet Selection */}
        <Collapsible open={snippetExpanded} onOpenChange={setSnippetExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between mb-2 hover:bg-muted/50">
              <span className="font-medium">Select Schematic Snippet *</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", snippetExpanded && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-4">
            <Select 
              value={selectedSchematicId} 
              onValueChange={setSelectedSchematicId}
              disabled={isLoadingOptions}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a schematic snippet for the report" />
              </SelectTrigger>
              <SelectContent className="bg-background">
                {availableSnippets.length === 0 ? (
                  <SelectItem value="no-snippets" disabled>No schematic snippets available</SelectItem>
                ) : (
                  availableSnippets.map((snippet) => (
                    <SelectItem key={snippet.id} value={snippet.id}>
                      {snippet.name} {snippet.total_pages > 1 ? `(Page ${snippet.page_number}/${snippet.total_pages})` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </CollapsibleContent>
        </Collapsible>

        {/* Document Folders Selection */}
        <Collapsible open={foldersExpanded} onOpenChange={setFoldersExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between mb-2 hover:bg-muted/50">
              <span className="font-medium">Select Document Folders * ({selectedFolderPaths.length} selected)</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", foldersExpanded && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-4">
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
          </CollapsibleContent>
        </Collapsible>

        {/* Reconciliation Runs Selection */}
        {!reconciliationRun && (
          <Collapsible open={reconciliationsExpanded} onOpenChange={setReconciliationsExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between mb-2 hover:bg-muted/50">
                <span className="font-medium">Select Reconciliation Runs * ({selectedReconciliationIds.length} selected)</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", reconciliationsExpanded && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pb-4">
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
            </CollapsibleContent>
          </Collapsible>
        )}

        {reconciliationRun && (
          <div className="p-4 border rounded-lg bg-muted/30">
            <p className="text-sm font-medium mb-2">Using Reconciliation:</p>
            <p className="text-sm text-muted-foreground">
              {reconciliationRun.run_name} - {format(new Date(reconciliationRun.run_date), "dd MMM yyyy")}
            </p>
          </div>
        )}

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

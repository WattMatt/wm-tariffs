import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Save, X, RefreshCw, Loader2, ZoomIn, ZoomOut, Wand2, ChevronLeft, ChevronRight, Activity, Database, Calendar, Zap, ChevronDown, ChevronUp, TrendingUp, BarChart3 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Document, Page, pdfjs } from 'react-pdf';
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfSection {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'page-break' | 'chart';
  editable: boolean;
}

interface SplitViewReportEditorProps {
  sections: PdfSection[];
  siteId: string;
  dateFrom?: string;
  dateTo?: string;
  onSave: (sections: PdfSection[]) => void;
  onCancel: () => void;
  generatePdfPreview: (sections: PdfSection[]) => Promise<string>;
  generateFinalPdf?: (sections: PdfSection[]) => Promise<void>;
}

interface SelectionArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SplitViewReportEditor({ 
  sections, 
  siteId,
  dateFrom,
  dateTo,
  onSave, 
  onCancel,
  generatePdfPreview,
  generateFinalPdf
}: SplitViewReportEditorProps) {
  const [localSections, setLocalSections] = useState<PdfSection[]>(sections);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionArea, setSelectionArea] = useState<SelectionArea | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // KPI Statistics State
  const [kpiStats, setKpiStats] = useState({
    totalReadings: 0,
    totalMeters: 0,
    dateRange: { earliest: '', latest: '' },
    totalConsumption: 0,
    isLoading: true
  });

  // Charts State
  const [showCharts, setShowCharts] = useState(false);
  const [chartData, setChartData] = useState<{
    consumption: Array<{ date: string; kwh: number }>;
    activity: Array<{ date: string; readings: number }>;
    isLoading: boolean;
  }>({
    consumption: [],
    activity: [],
    isLoading: false
  });

  // Fetch KPI statistics
  useEffect(() => {
    const fetchKPIs = async () => {
      try {
        // Get all meters for this site
        const { data: metersData, error: metersError } = await supabase
          .from('meters')
          .select('id')
          .eq('site_id', siteId);

        if (metersError) {
          console.error('Error fetching meters:', metersError);
          setKpiStats(prev => ({ ...prev, isLoading: false }));
          return;
        }

        const meterIds = (metersData || []).map(m => m.id);

        if (meterIds.length === 0) {
          setKpiStats({
            totalReadings: 0,
            totalMeters: 0,
            dateRange: { earliest: 'N/A', latest: 'N/A' },
            totalConsumption: 0,
            isLoading: false
          });
          return;
        }

        // Build query with optional date filtering
        let countQuery = supabase
          .from('meter_readings')
          .select('*', { count: 'exact', head: true })
          .in('meter_id', meterIds);

        let statsQuery = supabase
          .from('meter_readings')
          .select('reading_timestamp, kwh_value')
          .in('meter_id', meterIds);

        // Apply date range filter if provided
        if (dateFrom) {
          countQuery = countQuery.gte('reading_timestamp', dateFrom);
          statsQuery = statsQuery.gte('reading_timestamp', dateFrom);
        }
        if (dateTo) {
          countQuery = countQuery.lte('reading_timestamp', dateTo);
          statsQuery = statsQuery.lte('reading_timestamp', dateTo);
        }

        // Count total readings
        const { count: totalReadingsCount, error: countError } = await countQuery;

        if (countError) {
          console.error('Error counting readings:', countError);
        }

        // Get date range and total consumption
        statsQuery = statsQuery.order('reading_timestamp', { ascending: true });
        const { data: statsData, error: statsError } = await statsQuery;

        if (statsError) {
          console.error('Error fetching stats:', statsError);
        }

        const totalConsumption = (statsData || []).reduce((sum, r) => sum + (Number(r.kwh_value) || 0), 0);
        const earliest = statsData && statsData.length > 0 ? new Date(statsData[0].reading_timestamp).toLocaleDateString() : 'N/A';
        const latest = statsData && statsData.length > 0 ? new Date(statsData[statsData.length - 1].reading_timestamp).toLocaleDateString() : 'N/A';

        setKpiStats({
          totalReadings: totalReadingsCount || 0,
          totalMeters: metersData?.length || 0,
          dateRange: { earliest, latest },
          totalConsumption: Math.round(totalConsumption),
          isLoading: false
        });
      } catch (error) {
        console.error('Error loading KPIs:', error);
        setKpiStats(prev => ({ ...prev, isLoading: false }));
      }
    };

    fetchKPIs();
  }, [siteId, dateFrom, dateTo]);

  // Fetch chart data when charts are expanded
  useEffect(() => {
    if (!showCharts || chartData.consumption.length > 0) return;

    const fetchChartData = async () => {
      setChartData(prev => ({ ...prev, isLoading: true }));
      
      try {
        // Get all meters for this site
        const { data: metersData, error: metersError } = await supabase
          .from('meters')
          .select('id')
          .eq('site_id', siteId);

        if (metersError) throw metersError;

        const meterIds = (metersData || []).map(m => m.id);
        if (meterIds.length === 0) {
          setChartData({ consumption: [], activity: [], isLoading: false });
          return;
        }

        // Build query with optional date filtering
        let readingsQuery = supabase
          .from('meter_readings')
          .select('reading_timestamp, kwh_value')
          .in('meter_id', meterIds);

        // Apply date range filter if provided
        if (dateFrom) {
          readingsQuery = readingsQuery.gte('reading_timestamp', dateFrom);
        }
        if (dateTo) {
          readingsQuery = readingsQuery.lte('reading_timestamp', dateTo);
        }

        // Fetch all readings for these meters
        readingsQuery = readingsQuery.order('reading_timestamp', { ascending: true });
        const { data: readingsData, error: readingsError } = await readingsQuery;

        if (readingsError) throw readingsError;

        // Group by date for consumption trends
        const consumptionByDate = new Map<string, number>();
        const activityByDate = new Map<string, number>();

        (readingsData || []).forEach(reading => {
          const date = new Date(reading.reading_timestamp).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
          });
          
          // Sum consumption
          const currentConsumption = consumptionByDate.get(date) || 0;
          consumptionByDate.set(date, currentConsumption + Number(reading.kwh_value));
          
          // Count readings
          const currentCount = activityByDate.get(date) || 0;
          activityByDate.set(date, currentCount + 1);
        });

        // Convert to array format for charts (limit to last 30 days)
        const consumptionArray = Array.from(consumptionByDate.entries())
          .slice(-30)
          .map(([date, kwh]) => ({ date, kwh: Math.round(kwh) }));

        const activityArray = Array.from(activityByDate.entries())
          .slice(-30)
          .map(([date, readings]) => ({ date, readings }));

        setChartData({
          consumption: consumptionArray,
          activity: activityArray,
          isLoading: false
        });
      } catch (error) {
        console.error('Error loading chart data:', error);
        setChartData(prev => ({ ...prev, isLoading: false }));
      }
    };

    fetchChartData();
  }, [showCharts, siteId, dateFrom, dateTo]);

  // Generate initial PDF preview on mount
  useEffect(() => {
    const initPreview = async () => {
      setIsGenerating(true);
      try {
        console.log('Generating PDF preview...');
        const url = await generatePdfPreview(localSections);
        console.log('PDF URL generated:', url);
        console.log('PDF URL type:', typeof url);
        console.log('Is blob URL?', url.startsWith('blob:'));
        setPdfUrl(url);
        setInitialLoadDone(true);
      } catch (error) {
        console.error("Error generating initial PDF:", error);
      } finally {
        setIsGenerating(false);
      }
    };
    initPreview();
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsSelecting(true);
    setStartPoint({ x, y });
    setSelectionArea(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !startPoint || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const width = x - startPoint.x;
    const height = y - startPoint.y;
    
    // Draw selection rectangle
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(startPoint.x, startPoint.y, width, height);
    ctx.fillRect(startPoint.x, startPoint.y, width, height);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !startPoint) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const width = x - startPoint.x;
    const height = y - startPoint.y;
    
    if (Math.abs(width) > 10 && Math.abs(height) > 10) {
      setSelectionArea({
        x: Math.min(startPoint.x, x),
        y: Math.min(startPoint.y, y),
        width: Math.abs(width),
        height: Math.abs(height)
      });
    }
    
    setIsSelecting(false);
    setStartPoint(null);
  };

  const handleApplyChanges = async () => {
    if (!prompt.trim() || !selectionArea) return;
    
    setIsGenerating(true);
    const loadingToast = toast.loading("Processing your request with AI...");
    
    try {
      console.log('Applying changes:', { prompt, selectionArea });
      
      const { data, error } = await supabase.functions.invoke('process-pdf-edit', {
        body: {
          prompt: prompt,
          sections: localSections,
          selectionArea: selectionArea
        }
      });

      if (error) {
        console.error('Edge function error:', error);
        
        if (error.message?.includes('429') || error.message?.includes('rate limit')) {
          toast.error("Rate limit exceeded. Please try again in a moment.", { id: loadingToast });
        } else if (error.message?.includes('402') || error.message?.includes('credits')) {
          toast.error("AI credits exhausted. Please add credits to your workspace.", { id: loadingToast });
        } else {
          toast.error("Failed to process changes. Please try again.", { id: loadingToast });
        }
        return;
      }

      if (!data?.sections) {
        toast.error("Invalid response from AI service", { id: loadingToast });
        return;
      }

      // Update local sections with the AI-modified sections
      setLocalSections(data.sections);
      
      // Regenerate PDF with new sections
      const newUrl = await generatePdfPreview(data.sections);
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      setPdfUrl(newUrl);
      
      // Clear the selection and prompt
      handleClearSelection();
      
      toast.success("Changes applied successfully!", { id: loadingToast });
      
    } catch (err) {
      console.error('Error applying changes:', err);
      toast.error("An unexpected error occurred", { id: loadingToast });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearSelection = () => {
    setSelectionArea(null);
    setPrompt("");
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleSave = async () => {
    if (generateFinalPdf) {
      setIsGenerating(true);
      try {
        await generateFinalPdf(localSections);
      } catch (error) {
        console.error("Error generating final PDF:", error);
        toast.error("Failed to generate final PDF");
      } finally {
        setIsGenerating(false);
      }
    } else {
      onSave(localSections);
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 10, 50));
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(prev + 1, numPages));
  };

  const handleRefresh = async () => {
    setIsGenerating(true);
    try {
      const url = await generatePdfPreview(localSections);
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
      setPdfUrl(url);
    } catch (error) {
      console.error("Error refreshing PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Update canvas size to match PDF page dimensions
  useEffect(() => {
    const updateCanvasSize = () => {
      if (!pdfContainerRef.current || !canvasRef.current) return;
      
      // Find the actual PDF page element
      const pageElement = pdfContainerRef.current.querySelector('.react-pdf__Page__canvas');
      if (pageElement) {
        const rect = pageElement.getBoundingClientRect();
        const canvas = canvasRef.current;
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Position canvas to match the PDF page
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
    };
    
    // Use a slight delay to ensure PDF is rendered
    const timer = setTimeout(updateCanvasSize, 100);
    window.addEventListener('resize', updateCanvasSize);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [zoom, pdfUrl, pageNumber]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div className="h-14 border-b flex items-center justify-between px-4 bg-muted/10">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">AI Report Workshop</h2>
          {isGenerating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Processing...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} size="sm" disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                {generateFinalPdf ? 'Generate & Save PDF' : 'Save Changes'}
              </>
            )}
          </Button>
          <Button onClick={onCancel} variant="outline" size="sm" disabled={isGenerating}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>

      {/* KPI Statistics Bar */}
      <div className="border-b bg-muted/5">
        <div className="px-4 py-3">
          {kpiStats.isLoading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading statistics...</span>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Database className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Total Readings</div>
                  <div className="text-lg font-semibold">{kpiStats.totalReadings.toLocaleString()}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent/10">
                  <Activity className="w-4 h-4 text-accent-foreground" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Active Meters</div>
                  <div className="text-lg font-semibold">{kpiStats.totalMeters}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-secondary/10">
                  <Calendar className="w-4 h-4 text-secondary-foreground" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Date Range</div>
                  <div className="text-sm font-semibold">
                    {kpiStats.dateRange.earliest} - {kpiStats.dateRange.latest}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Total Consumption</div>
                  <div className="text-lg font-semibold">{kpiStats.totalConsumption.toLocaleString()} kWh</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Collapsible Charts Section */}
        <Collapsible open={showCharts} onOpenChange={setShowCharts}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full h-8 justify-center gap-2 hover:bg-muted/50 rounded-none border-t"
            >
              <BarChart3 className="w-4 h-4" />
              <span className="text-xs font-medium">
                {showCharts ? 'Hide Charts' : 'Show Consumption & Activity Charts'}
              </span>
              {showCharts ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-4 pt-2">
            {chartData.isLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading charts...</span>
              </div>
            ) : chartData.consumption.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No data available for charts
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {/* Consumption Trends Chart */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">Consumption Trends (Last 30 Days)</h3>
                  </div>
                  <ChartContainer
                    config={{
                      kwh: {
                        label: "Consumption (kWh)",
                        color: "hsl(var(--primary))",
                      },
                    }}
                    className="h-[200px]"
                  >
                    <AreaChart data={chartData.consumption}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="kwh"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary))"
                        fillOpacity={0.2}
                      />
                    </AreaChart>
                  </ChartContainer>
                </Card>

                {/* Meter Activity Chart */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-accent-foreground" />
                    <h3 className="text-sm font-semibold">Meter Activity (Last 30 Days)</h3>
                  </div>
                  <ChartContainer
                    config={{
                      readings: {
                        label: "Reading Count",
                        color: "hsl(var(--accent))",
                      },
                    }}
                    className="h-[200px]"
                  >
                    <BarChart data={chartData.activity}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="readings"
                        fill="hsl(var(--accent))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </Card>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Split View */}
      <div className="h-[800px]">
        <ResizablePanelGroup direction="horizontal">
          {/* Left Panel - AI Workshop */}
          <ResizablePanel defaultSize={35} minSize={25}>
            <div className="h-full flex flex-col">
              <div className="h-10 border-b flex items-center px-4 bg-muted/30">
                <Wand2 className="w-4 h-4 mr-2" />
                <span className="text-sm font-medium">AI Workshop</span>
              </div>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  <Card className="p-4 bg-muted/30">
                    <h3 className="text-sm font-semibold mb-2">How to use:</h3>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Select an area on the PDF by clicking and dragging</li>
                      <li>Describe what you want to change</li>
                      <li>Click "Apply Changes" to modify that section</li>
                    </ol>
                  </Card>

                  {selectionArea && (
                    <Card className="p-4 border-primary/50">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold">Area Selected</h3>
                        <Button 
                          onClick={handleClearSelection} 
                          variant="ghost" 
                          size="sm"
                          className="h-6"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Position: ({Math.round(selectionArea.x)}, {Math.round(selectionArea.y)})<br />
                        Size: {Math.round(selectionArea.width)} × {Math.round(selectionArea.height)}px
                      </p>
                      <div className="space-y-2">
                        <label className="text-xs font-medium">What would you like to change?</label>
                        <Textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="E.g., 'Make the text bold and increase font size' or 'Change this graph to a pie chart'"
                          className="min-h-[120px] text-sm"
                        />
                        <Button 
                          onClick={handleApplyChanges}
                          disabled={!prompt.trim() || isGenerating}
                          className="w-full"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Wand2 className="w-4 h-4 mr-2" />
                              Apply Changes
                            </>
                          )}
                        </Button>
                      </div>
                    </Card>
                  )}

                  {!selectionArea && (
                    <Card className="p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        Select an area on the PDF to get started
                      </p>
                    </Card>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel - PDF Viewer with Selection */}
          <ResizablePanel defaultSize={65} minSize={40}>
            <div className="h-full flex flex-col">
              <div className="h-10 border-b flex items-center justify-between px-4 bg-muted/30">
                <span className="text-sm font-medium">PDF Preview</span>
                <div className="flex items-center gap-2">
                  {numPages > 0 && (
                    <>
                      <Button 
                        onClick={goToPrevPage} 
                        variant="ghost" 
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber <= 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-xs font-medium min-w-[4rem] text-center">
                        {pageNumber} / {numPages}
                      </span>
                      <Button 
                        onClick={goToNextPage} 
                        variant="ghost" 
                        size="icon"
                        className="h-7 w-7"
                        disabled={pageNumber >= numPages}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <div className="w-px h-5 bg-border mx-1" />
                    </>
                  )}
                  <Button 
                    onClick={handleZoomOut} 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <span className="text-xs font-medium min-w-[3rem] text-center">
                    {zoom}%
                  </span>
                  <Button 
                    onClick={handleZoomIn} 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button onClick={handleRefresh} variant="ghost" size="icon" className="h-7 w-7">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 bg-muted/20">
                {pdfUrl ? (
                  <div className="p-4">
                    <div 
                      ref={pdfContainerRef}
                      className="relative mx-auto"
                    >
                      <Document
                        file={pdfUrl}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={(error) => {
                          console.error('PDF load error:', error);
                          console.error('PDF URL that failed:', pdfUrl);
                        }}
                        loading={
                          <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          </div>
                        }
                        error={
                          <div className="flex items-center justify-center py-20">
                            <div className="text-center space-y-4">
                              <p className="text-sm text-destructive">Failed to load PDF</p>
                              <Button onClick={handleRefresh} variant="outline" size="sm">
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Try Again
                              </Button>
                            </div>
                          </div>
                        }
                      >
                        <Page
                          pageNumber={pageNumber}
                          scale={zoom / 100}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          loading={
                            <div className="flex items-center justify-center py-20">
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                          }
                        />
                      </Document>
                      <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        className="absolute pointer-events-auto"
                        style={{ 
                          cursor: isSelecting ? 'crosshair' : 'default',
                          top: 0,
                          left: 0
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-2">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Loading PDF...</p>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

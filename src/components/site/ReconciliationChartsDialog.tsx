import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, RefreshCw, ImageIcon, Loader2, FolderOpen, Sparkles } from "lucide-react";
import { ChartCaptureContainer } from "./ChartCapture";
import { buildConnectionsMap, getHierarchyDepth } from '@/lib/reconciliation/hierarchyUtils';

interface ReconciliationChartsDialogProps {
  siteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChartFile {
  name: string;
  path: string;
  url: string;
  meterNumber: string;
  metric: string;
  metricLabel: string;
}

interface MeterWithHierarchy {
  id: string;
  meter_number: string;
  depth: number;
  order: number;
}

const METRIC_LABELS: Record<string, string> = {
  'total': 'Total Amount',
  'basic': 'Basic Charge',
  'kva-charge': 'kVA Charge',
  'kwh-charge': 'kWh Charge',
  'kva-consumption': 'kVA Consumption',
  'kwh-consumption': 'kWh Consumption',
};

const METRIC_ORDER = ['total', 'basic', 'kva-charge', 'kwh-charge', 'kva-consumption', 'kwh-consumption'];

// Sanitize name to match storage path format
const sanitizeName = (name: string): string => {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export default function ReconciliationChartsDialog({ 
  siteId, 
  open, 
  onOpenChange 
}: ReconciliationChartsDialogProps) {
  const [charts, setCharts] = useState<ChartFile[]>([]);
  const [groupedCharts, setGroupedCharts] = useState<Record<string, ChartFile[]>>({});
  const [meterOrder, setMeterOrder] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateTrigger, setGenerateTrigger] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ current: 0, total: 0, meterNumber: '' });

  const handleGenerateComplete = (result: { success: boolean; totalCharts: number; errors: string[] }) => {
    setIsGenerating(false);
    setGenerateTrigger(false);
    
    if (result.success && result.totalCharts > 0) {
      toast.success(`Successfully generated ${result.totalCharts} charts`);
      fetchCharts(); // Refresh the list
    } else if (result.totalCharts === 0) {
      toast.info('No charts were generated. Make sure meters have reconciliation data.');
    } else {
      toast.error(`Chart generation completed with ${result.errors.length} errors`);
    }
  };

  const handleGenerateProgress = (current: number, total: number, meterNumber: string) => {
    setGenerateProgress({ current, total, meterNumber });
  };

  const startGeneration = () => {
    setIsGenerating(true);
    setGenerateProgress({ current: 0, total: 0, meterNumber: '' });
    setGenerateTrigger(true);
  };

  // Fetch meter hierarchy order
  const fetchMeterHierarchy = async (): Promise<MeterWithHierarchy[]> => {
    try {
      // Get all meters for the site
      const { data: meters, error: metersError } = await supabase
        .from('meters')
        .select('id, meter_number')
        .eq('site_id', siteId);

      if (metersError || !meters) return [];

      // Get meter connections
      const { data: connections } = await supabase
        .from('meter_connections')
        .select('parent_meter_id, child_meter_id')
        .or(`parent_meter_id.in.(${meters.map(m => m.id).join(',')}),child_meter_id.in.(${meters.map(m => m.id).join(',')})`);

      const connectionsMap = buildConnectionsMap(connections || []);

      // Calculate hierarchy depth for each meter
      const metersWithDepth = meters.map(meter => ({
        ...meter,
        depth: getHierarchyDepth(meter.id, connectionsMap),
      }));

      // Sort: shallowest first (parents before children), then by meter number
      metersWithDepth.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.meter_number.localeCompare(b.meter_number);
      });

      return metersWithDepth.map((m, idx) => ({ ...m, order: idx }));
    } catch (err) {
      console.error('Error fetching meter hierarchy:', err);
      return [];
    }
  };

  const fetchCharts = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch meter hierarchy and chart files in parallel
      const [metersWithHierarchy, siteData] = await Promise.all([
        fetchMeterHierarchy(),
        supabase
          .from('sites')
          .select('name, clients(name)')
          .eq('id', siteId)
          .single()
          .then(res => res.data),
      ]);

      if (!siteData) {
        throw new Error('Failed to fetch site information');
      }

      // Build meter order map
      const meterOrderMap = new Map<string, number>();
      metersWithHierarchy.forEach(m => {
        meterOrderMap.set(m.meter_number, m.order);
      });

      const clientName = sanitizeName((siteData.clients as any)?.name || '');
      const siteName = sanitizeName(siteData.name);
      const graphsPath = `${clientName}/${siteName}/Metering/Reconciliations/Graphs`;

      // List all files in Graphs folder
      const { data: files, error: listError } = await supabase.storage
        .from('client-files')
        .list(graphsPath, { limit: 1000 });

      if (listError) {
        throw new Error('Failed to list chart files');
      }

      if (!files || files.length === 0) {
        setCharts([]);
        setGroupedCharts({});
        setMeterOrder([]);
        return;
      }

      // Filter for PNG files and parse names
      const chartFiles: ChartFile[] = [];
      
      for (const file of files) {
        if (!file.name.endsWith('.png')) continue;
        
        // Parse filename: {meter_number}-{metric}.png
        const nameWithoutExt = file.name.replace('.png', '');
        const lastDashIndex = nameWithoutExt.lastIndexOf('-');
        
        if (lastDashIndex === -1) continue;
        
        const meterNumber = nameWithoutExt.substring(0, lastDashIndex);
        const metric = nameWithoutExt.substring(lastDashIndex + 1);
        const metricLabel = METRIC_LABELS[metric] || metric;
        
        const filePath = `${graphsPath}/${file.name}`;
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('client-files')
          .getPublicUrl(filePath);

        chartFiles.push({
          name: file.name,
          path: filePath,
          url: urlData.publicUrl,
          meterNumber,
          metric,
          metricLabel,
        });
      }

      // Sort by hierarchy order, then by metric order
      chartFiles.sort((a, b) => {
        const orderA = meterOrderMap.get(a.meterNumber) ?? 9999;
        const orderB = meterOrderMap.get(b.meterNumber) ?? 9999;
        if (orderA !== orderB) return orderA - orderB;
        
        // Same meter - sort by metric order
        const metricOrderA = METRIC_ORDER.indexOf(a.metric);
        const metricOrderB = METRIC_ORDER.indexOf(b.metric);
        return metricOrderA - metricOrderB;
      });

      // Group by meter number preserving hierarchy order
      const grouped: Record<string, ChartFile[]> = {};
      const orderedMeterNumbers: string[] = [];
      
      for (const chart of chartFiles) {
        if (!grouped[chart.meterNumber]) {
          grouped[chart.meterNumber] = [];
          orderedMeterNumbers.push(chart.meterNumber);
        }
        grouped[chart.meterNumber].push(chart);
      }

      setCharts(chartFiles);
      setGroupedCharts(grouped);
      setMeterOrder(orderedMeterNumbers);
    } catch (err) {
      console.error('Error fetching charts:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch charts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchCharts();
    }
  }, [open, siteId]);

  const downloadChart = async (chart: ChartFile) => {
    try {
      const { data, error } = await supabase.storage
        .from('client-files')
        .download(chart.path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = chart.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading chart:', err);
      toast.error('Failed to download chart');
    }
  };

  const downloadAllCharts = async () => {
    toast.info(`Downloading ${charts.length} charts...`);
    
    for (const chart of charts) {
      await downloadChart(chart);
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    toast.success('All charts downloaded');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5" />
                Reconciliation Charts
              </DialogTitle>
              <DialogDescription>
                Generated charts from reconciliation analysis, grouped by meter hierarchy
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={startGeneration}
                disabled={isLoading || isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                {isGenerating ? 'Generating...' : 'Generate Charts'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchCharts}
                disabled={isLoading || isGenerating}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {charts.length > 0 && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={downloadAllCharts}
                  disabled={isGenerating}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download All ({charts.length})
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Generation Progress */}
        {isGenerating && generateProgress.total > 0 && (
          <div className="px-1 py-2 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Generating chart for {generateProgress.meterNumber}...
              </span>
              <span className="text-muted-foreground">
                {generateProgress.current}/{generateProgress.total}
              </span>
            </div>
            <Progress value={(generateProgress.current / generateProgress.total) * 100} />
          </div>
        )}

        <ScrollArea className="h-[calc(85vh-140px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-destructive mb-2">{error}</p>
              <Button variant="outline" onClick={fetchCharts}>
                Try Again
              </Button>
            </div>
          ) : charts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">No reconciliation charts found</p>
              <p className="text-sm text-muted-foreground">
                Click "Generate Charts" to create charts from reconciliation data
              </p>
            </div>
          ) : (
            <Accordion type="multiple" defaultValue={meterOrder} className="space-y-2">
              {meterOrder.map((meterNumber, index) => (
                <AccordionItem key={meterNumber} value={meterNumber} className="border rounded-lg px-4">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
                      <span className="font-semibold">{meterNumber}</span>
                      <span className="text-sm text-muted-foreground">
                        ({groupedCharts[meterNumber]?.length || 0} charts)
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
                      {groupedCharts[meterNumber]?.map((chart) => (
                        <Card key={chart.name} className="overflow-hidden">
                          <div className="aspect-[5/3] bg-muted relative">
                            <img
                              src={`${chart.url}?t=${Date.now()}`}
                              alt={`${chart.meterNumber} - ${chart.metricLabel}`}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          </div>
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium truncate">
                                {chart.metricLabel}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => downloadChart(chart)}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </ScrollArea>
      </DialogContent>

      {/* Hidden chart capture container */}
      <ChartCaptureContainer
        siteId={siteId}
        trigger={generateTrigger}
        onComplete={handleGenerateComplete}
        onProgress={handleGenerateProgress}
      />
    </Dialog>
  );
}

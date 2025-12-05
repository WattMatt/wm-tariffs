import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, RefreshCw, ImageIcon, Loader2, FolderOpen, Camera, X, CheckCircle2, AlertCircle, Play } from "lucide-react";

export interface MeterCaptureStatus {
  meterId: string;
  meterNumber: string;
  status: 'pending' | 'complete' | 'partial' | 'failed';
  chartsComplete: number;
  chartsTotal: number;
  failedMetrics: string[];
}

export type CaptureMode = 'all' | 'resume' | 'retryFailed';

interface BulkCaptureProgress {
  currentMeter: number;
  totalMeters: number;
  meterNumber: string;
  currentMetric: number;
  totalMetrics: number;
  metric: string;
}

interface ReconciliationChartsDialogProps {
  siteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBulkCapture?: (mode: CaptureMode) => void;
  onCancelBulkCapture?: () => void;
  isBulkCapturing?: boolean;
  bulkCaptureProgress?: BulkCaptureProgress | null;
  isBackgroundCapturing?: boolean;
  meterCaptureStatuses?: MeterCaptureStatus[];
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
  onOpenChange,
  onBulkCapture,
  onCancelBulkCapture,
  isBulkCapturing = false,
  bulkCaptureProgress,
  isBackgroundCapturing = false,
  meterCaptureStatuses = []
}: ReconciliationChartsDialogProps) {
  const [charts, setCharts] = useState<ChartFile[]>([]);
  const [groupedCharts, setGroupedCharts] = useState<Record<string, ChartFile[]>>({});
  const [meterOrder, setMeterOrder] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate meter categories for buttons
  const incompleteMeters = meterCaptureStatuses.filter(m => m.status !== 'complete');
  const completeMeters = meterCaptureStatuses.filter(m => m.status === 'complete');
  const failedMeters = meterCaptureStatuses.filter(m => m.status === 'failed' || m.status === 'partial');
  const hasIncomplete = incompleteMeters.length > 0 && completeMeters.length > 0;
  const hasFailed = failedMeters.length > 0;

  // Get status for a meter
  const getMeterStatus = (meterNumber: string): MeterCaptureStatus | undefined => {
    return meterCaptureStatuses.find(s => s.meterNumber === meterNumber);
  };

  // Fetch meter order from site_reconciliation_settings
  const fetchMeterOrder = async (): Promise<MeterWithHierarchy[]> => {
    try {
      // Get site reconciliation settings with saved meter order
      const { data: settings } = await supabase
        .from('site_reconciliation_settings')
        .select('meter_order')
        .eq('site_id', siteId)
        .single();

      // Get all meters for the site
      const { data: meters, error: metersError } = await supabase
        .from('meters')
        .select('id, meter_number')
        .eq('site_id', siteId);

      if (metersError || !meters) return [];

      // Create a map of meter_id to meter_number
      const meterIdToNumber = new Map<string, string>();
      meters.forEach(m => meterIdToNumber.set(m.id, m.meter_number));

      // If we have a saved meter_order, use it
      const savedOrder = settings?.meter_order as string[] | null;
      
      if (savedOrder && savedOrder.length > 0) {
        // Build ordered list based on saved meter_order (which contains meter IDs)
        const orderedMeters: MeterWithHierarchy[] = [];
        
        savedOrder.forEach((meterId, idx) => {
          const meterNumber = meterIdToNumber.get(meterId);
          if (meterNumber) {
            orderedMeters.push({
              id: meterId,
              meter_number: meterNumber,
              depth: 0,
              order: idx
            });
          }
        });

        // Add any meters not in the saved order at the end
        meters.forEach(m => {
          if (!savedOrder.includes(m.id)) {
            orderedMeters.push({
              id: m.id,
              meter_number: m.meter_number,
              depth: 0,
              order: orderedMeters.length
            });
          }
        });

        return orderedMeters;
      }

      // Fallback: sort by meter number
      const sortedMeters = [...meters].sort((a, b) => 
        a.meter_number.localeCompare(b.meter_number)
      );
      
      return sortedMeters.map((m, idx) => ({ 
        id: m.id, 
        meter_number: m.meter_number, 
        depth: 0, 
        order: idx 
      }));
    } catch (err) {
      console.error('Error fetching meter order:', err);
      return [];
    }
  };

  const fetchCharts = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch meter order and chart files in parallel
      const [metersWithOrder, siteData] = await Promise.all([
        fetchMeterOrder(),
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
      metersWithOrder.forEach(m => {
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
        // Must match against known metrics since metrics can contain dashes (e.g., kva-charge)
        const nameWithoutExt = file.name.replace('.png', '');
        
        let foundMetric = '';
        let foundMeterNumber = '';
        
        // Check each known metric suffix (try longer ones first)
        for (const metric of METRIC_ORDER) {
          const suffix = `-${metric}`;
          if (nameWithoutExt.endsWith(suffix)) {
            foundMetric = metric;
            foundMeterNumber = nameWithoutExt.slice(0, -suffix.length);
            break;
          }
        }
        
        // Skip if no known metric found
        if (!foundMetric || !foundMeterNumber) continue;
        
        const metricLabel = METRIC_LABELS[foundMetric] || foundMetric;
        
        const filePath = `${graphsPath}/${file.name}`;
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('client-files')
          .getPublicUrl(filePath);

        chartFiles.push({
          name: file.name,
          path: filePath,
          url: urlData.publicUrl,
          meterNumber: foundMeterNumber,
          metric: foundMetric,
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
                Charts captured from meter analysis. To capture new charts, click on a meter in the Comparison tab and use "Capture All Charts".
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {onBulkCapture && (
                <>
                  {hasFailed && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onBulkCapture('retryFailed')}
                      disabled={isBackgroundCapturing || isLoading}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retry Failed ({failedMeters.length})
                    </Button>
                  )}
                  {hasIncomplete && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onBulkCapture('resume')}
                      disabled={isBackgroundCapturing || isLoading}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Resume ({incompleteMeters.length} remaining)
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onBulkCapture('all')}
                    disabled={isBackgroundCapturing || isLoading}
                  >
                    {isBackgroundCapturing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Capturing...
                      </>
                    ) : (
                      <>
                        <Camera className="w-4 h-4 mr-2" />
                        {completeMeters.length > 0 ? 'Restart All' : 'Capture All'}
                      </>
                    )}
                  </Button>
                </>
              )}
              {isBackgroundCapturing && onCancelBulkCapture && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onCancelBulkCapture}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={fetchCharts}
                disabled={isLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {charts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadAllCharts}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download All ({charts.length})
                </Button>
              )}
            </div>
          </div>
          
          {/* Background capture indicator */}
          {isBackgroundCapturing && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                Charts are being captured in the background. You can close this dialog and continue working. Check the toast notification for progress.
              </span>
            </div>
          )}
        </DialogHeader>

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
                To capture charts, go to the Comparison tab, click on a meter, and use "Capture All Charts"
              </p>
            </div>
          ) : (
            <Accordion type="multiple" defaultValue={meterOrder} className="space-y-2">
              {meterOrder.map((meterNumber, index) => {
                const status = getMeterStatus(meterNumber);
                return (
                  <AccordionItem key={meterNumber} value={meterNumber} className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
                        <span className="font-semibold">{meterNumber}</span>
                        <span className="text-sm text-muted-foreground">
                          ({groupedCharts[meterNumber]?.length || 0} charts)
                        </span>
                        {status && (
                          <Badge 
                            variant={
                              status.status === 'complete' ? 'default' : 
                              status.status === 'partial' ? 'secondary' :
                              status.status === 'failed' ? 'destructive' : 'outline'
                            }
                            className="ml-2 text-xs"
                          >
                            {status.status === 'complete' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                            {status.status === 'failed' && <AlertCircle className="w-3 h-3 mr-1" />}
                            {status.status === 'complete' ? 'Complete' : 
                             status.status === 'partial' ? `${status.chartsComplete}/${status.chartsTotal}` :
                             status.status === 'failed' ? 'Failed' : 'Pending'}
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-3 gap-4 pb-4">
                        {groupedCharts[meterNumber]?.map((chart) => (
                          <Card key={chart.name} className="overflow-hidden group relative">
                            <div className="bg-white relative border-b h-24 cursor-zoom-in transition-all duration-300 hover:scale-[4] hover:z-50 hover:shadow-xl hover:rounded-md origin-center">
                              <img
                                src={`${chart.url}?t=${Date.now()}`}
                                alt={`${chart.meterNumber} - ${chart.metricLabel}`}
                                className="w-full h-full object-contain"
                                loading="lazy"
                              />
                            </div>
                            <CardContent className="p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium truncate">
                                  {chart.metricLabel}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => downloadChart(chart)}
                                >
                                  <Download className="w-3 h-3" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

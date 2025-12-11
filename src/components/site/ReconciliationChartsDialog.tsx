import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, RefreshCw, ImageIcon, Loader2, FolderOpen, Camera, X, CheckCircle2, AlertCircle, Play, Check } from "lucide-react";

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

// Chart type determines storage path
export type ChartDialogType = 'analysis' | 'comparison';

interface ReconciliationChartsDialogProps {
  siteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chartType?: ChartDialogType;
  onBulkCapture?: (mode: CaptureMode, confirmedChartPaths?: Set<string>) => void;
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

// Storage subfolder paths for each chart type
const CHART_STORAGE_PATHS = {
  analysis: 'Reconciliations/Graphs/Analysis',
  comparison: 'Reconciliations/Graphs/Comparison',
} as const;

export default function ReconciliationChartsDialog({ 
  siteId, 
  open, 
  onOpenChange,
  chartType = 'comparison',
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
  const [confirmedCharts, setConfirmedCharts] = useState<Set<string>>(new Set());
  const [selectedMeter, setSelectedMeter] = useState<string | null>(null);

  // Calculate meter status based on confirmation - unconfirmed = failed
  const getMeterConfirmationStatus = (meterNumber: string): 'complete' | 'partial' | 'pending' => {
    const meterCharts = groupedCharts[meterNumber] || [];
    if (meterCharts.length === 0) return 'pending';
    
    const confirmedCount = meterCharts.filter(c => confirmedCharts.has(c.path)).length;
    if (confirmedCount === meterCharts.length) return 'complete';
    if (confirmedCount > 0) return 'partial';
    return 'pending';
  };

  // Calculate overall meter categories for buttons based on confirmation status
  const getEffectiveStatus = (meterNumber: string): MeterCaptureStatus['status'] => {
    const captureStatus = meterCaptureStatuses.find(s => s.meterNumber === meterNumber);
    const confirmStatus = getMeterConfirmationStatus(meterNumber);
    
    // If capture failed, it's failed
    if (captureStatus?.status === 'failed') return 'failed';
    
    // If captured but not confirmed, treat as failed (needs retry)
    if (captureStatus?.status === 'complete' && confirmStatus !== 'complete') return 'partial';
    
    // Return capture status if available, otherwise pending
    return captureStatus?.status || 'pending';
  };

  const incompleteMeters = meterOrder.filter(m => getEffectiveStatus(m) !== 'complete');
  const completeMeters = meterOrder.filter(m => getEffectiveStatus(m) === 'complete');
  const failedMeters = meterOrder.filter(m => ['failed', 'partial'].includes(getEffectiveStatus(m)));
  const hasIncomplete = incompleteMeters.length > 0 && completeMeters.length > 0;
  const hasFailed = failedMeters.length > 0;

  // Get status for a meter (for badge display)
  const getMeterStatus = (meterNumber: string): MeterCaptureStatus | undefined => {
    return meterCaptureStatuses.find(s => s.meterNumber === meterNumber);
  };

  // Toggle chart confirmation
  const toggleChartConfirmation = (chartPath: string) => {
    setConfirmedCharts(prev => {
      const next = new Set(prev);
      if (next.has(chartPath)) {
        next.delete(chartPath);
      } else {
        next.add(chartPath);
      }
      return next;
    });
  };

  // Confirm all charts for a meter
  const confirmAllMeterCharts = (meterNumber: string, confirm: boolean) => {
    const meterCharts = groupedCharts[meterNumber] || [];
    setConfirmedCharts(prev => {
      const next = new Set(prev);
      meterCharts.forEach(c => {
        if (confirm) {
          next.add(c.path);
        } else {
          next.delete(c.path);
        }
      });
      return next;
    });
  };

  // Confirm all charts across all meters
  const confirmAllCharts = () => {
    setConfirmedCharts(new Set(charts.map(c => c.path)));
  };

  // Clear all confirmations
  const clearAllConfirmations = () => {
    setConfirmedCharts(new Set());
  };

  // Check if all charts are confirmed
  const allChartsConfirmed = charts.length > 0 && confirmedCharts.size === charts.length;

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
      const subPath = CHART_STORAGE_PATHS[chartType];
      const graphsPath = `${clientName}/${siteName}/Metering/${subPath}`;

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

      // Filter for SVG files and parse names
      const chartFiles: ChartFile[] = [];
      
      for (const file of files) {
        if (!file.name.endsWith('.svg')) continue;
        
        // Parse filename: {meter_number}-{metric}.svg
        // Must match against known metrics since metrics can contain dashes (e.g., kva-charge)
        const nameWithoutExt = file.name.replace('.svg', '');
        
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
  }, [open, siteId, chartType]);

  // Auto-select first meter when data loads
  useEffect(() => {
    if (meterOrder.length > 0 && !selectedMeter) {
      setSelectedMeter(meterOrder[0]);
    }
  }, [meterOrder, selectedMeter]);

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
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5" />
                {chartType === 'analysis' ? 'Analysis Charts' : 'Reconciliation Charts'}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2 flex-nowrap shrink-0">
              {onBulkCapture && (
                <>
                  {hasFailed && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onBulkCapture('retryFailed', confirmedCharts)}
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
                      onClick={() => onBulkCapture('resume', confirmedCharts)}
                      disabled={isBackgroundCapturing || isLoading}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Resume ({incompleteMeters.length} remaining)
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onBulkCapture('all', confirmedCharts)}
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
                <>
                  <Button
                    variant={allChartsConfirmed ? "outline" : "default"}
                    size="sm"
                    onClick={allChartsConfirmed ? clearAllConfirmations : confirmAllCharts}
                    className={allChartsConfirmed ? "" : "bg-green-600 hover:bg-green-700"}
                  >
                    <Check className="w-4 h-4 mr-2" />
                    {allChartsConfirmed ? 'Clear Confirmations' : `Confirm All (${charts.length})`}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadAllCharts}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download All ({charts.length})
                  </Button>
                </>
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
          
          {/* Confirmation summary bar */}
          {charts.length > 0 && (
            <div className="mt-4 p-3 bg-muted/30 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm font-medium">{confirmedCharts.size} Confirmed</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-destructive/50" />
                  <span className="text-sm font-medium">{charts.length - confirmedCharts.size} Unconfirmed</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ width: `${charts.length > 0 ? (confirmedCharts.size / charts.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {charts.length > 0 ? Math.round((confirmedCharts.size / charts.length) * 100) : 0}%
                </span>
              </div>
            </div>
          )}
        </DialogHeader>

        {/* Two-column layout: Left sidebar (1/5) + Right detail panel (4/5) */}
        <div className="flex h-[calc(85vh-180px)] border rounded-lg overflow-hidden">
          {/* Left sidebar - Meter list */}
          <div className="w-1/5 min-w-[180px] border-r bg-muted/20">
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : meterOrder.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No meters found
                  </div>
                ) : (
                  meterOrder.map((meterNumber, index) => {
                    const meterCharts = groupedCharts[meterNumber] || [];
                    const confirmStatus = getMeterConfirmationStatus(meterNumber);
                    const confirmedCount = meterCharts.filter(c => confirmedCharts.has(c.path)).length;
                    const allConfirmed = confirmedCount === meterCharts.length && meterCharts.length > 0;
                    const isSelected = selectedMeter === meterNumber;
                    
                    return (
                      <div
                        key={meterNumber}
                        className={`p-2 rounded-md cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-primary/10 border border-primary/30' 
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => setSelectedMeter(meterNumber)}
                      >
                        <div className="flex items-center gap-2">
                          {/* Meter confirmation checkbox */}
                          <Checkbox
                            id={`sidebar-confirm-${meterNumber}`}
                            checked={allConfirmed}
                            onCheckedChange={(checked) => {
                              confirmAllMeterCharts(meterNumber, !!checked);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">{index + 1}.</span>
                              <span className="text-sm font-medium truncate">{meterNumber}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {meterCharts.length} charts
                              </span>
                              {confirmStatus === 'complete' && (
                                <Check className="w-3 h-3 text-green-500" />
                              )}
                              {confirmStatus === 'partial' && (
                                <span className="text-xs text-amber-500">
                                  ({confirmedCount}/{meterCharts.length})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right detail panel - Charts for selected meter */}
          <div className="w-4/5 bg-background">
            <ScrollArea className="h-full">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <p className="text-destructive mb-2">{error}</p>
                  <Button variant="outline" onClick={fetchCharts}>
                    Try Again
                  </Button>
                </div>
              ) : !selectedMeter ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Select a meter from the list to view charts</p>
                </div>
              ) : charts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No reconciliation charts found</p>
                  <p className="text-sm text-muted-foreground">
                    Use "Capture All" to generate charts
                  </p>
                </div>
              ) : (
                <div className="p-4">
                  {/* Selected meter header */}
                  <div className="flex items-center justify-between mb-4 pb-3 border-b">
                    <div>
                      <h3 className="font-semibold text-lg">{selectedMeter}</h3>
                      <p className="text-sm text-muted-foreground">
                        {groupedCharts[selectedMeter]?.length || 0} charts
                      </p>
                    </div>
                    {/* Confirmation status for selected meter */}
                    {(() => {
                      const meterCharts = groupedCharts[selectedMeter] || [];
                      const confirmedCount = meterCharts.filter(c => confirmedCharts.has(c.path)).length;
                      const confirmStatus = getMeterConfirmationStatus(selectedMeter);
                      return (
                        <Badge 
                          variant={confirmStatus === 'complete' ? 'default' : confirmStatus === 'partial' ? 'secondary' : 'outline'}
                          className={confirmStatus === 'complete' ? 'bg-green-600' : ''}
                        >
                          {confirmStatus === 'complete' && <Check className="w-3 h-3 mr-1" />}
                          {confirmStatus === 'complete' ? 'All Confirmed' : 
                           confirmStatus === 'partial' ? `${confirmedCount}/${meterCharts.length} Confirmed` : 
                           'Unconfirmed'}
                        </Badge>
                      );
                    })()}
                  </div>

                  {/* Charts grid */}
                  <div className="grid grid-cols-3 gap-4 overflow-hidden">
                    {(groupedCharts[selectedMeter] || []).map((chart) => {
                      const isConfirmed = confirmedCharts.has(chart.path);
                      return (
                        <Card 
                          key={chart.name} 
                          className={`overflow-hidden group relative transition-all ${isConfirmed ? 'ring-2 ring-green-500' : 'ring-1 ring-destructive/30'}`}
                        >
                          <div className="bg-white relative border-b h-32 cursor-zoom-in transition-all duration-300 hover:scale-150 hover:z-50 hover:shadow-xl hover:rounded-md origin-center">
                            <img
                              src={`${chart.url}?t=${Date.now()}`}
                              alt={`${chart.meterNumber} - ${chart.metricLabel}`}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                            {/* Confirmation indicator overlay */}
                            {isConfirmed && (
                              <div className="absolute top-1 right-1 bg-green-500 rounded-full p-1">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`confirm-${chart.path}`}
                                checked={isConfirmed}
                                onCheckedChange={() => toggleChartConfirmation(chart.path)}
                              />
                              <label 
                                htmlFor={`confirm-${chart.path}`}
                                className="text-xs font-medium truncate flex-1 cursor-pointer"
                              >
                                {chart.metricLabel}
                              </label>
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
                      );
                    })}
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

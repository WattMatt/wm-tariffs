import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, RefreshCw, ImageIcon, Loader2, FolderOpen, Camera, X, Check } from "lucide-react";

export type CaptureMode = 'all' | 'resume' | 'retryFailed';

interface TariffChartsDialogProps {
  supplyAuthorityName: string;
  province: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBulkCapture?: (mode: CaptureMode, confirmedChartPaths?: Set<string>) => void;
  onCancelBulkCapture?: () => void;
  isBackgroundCapturing?: boolean;
}

interface ChartFile {
  name: string;
  path: string;
  url: string;
  tariffName: string;
  metric: string;
  metricLabel: string;
}

const METRIC_LABELS: Record<string, string> = {
  'basic-charge': 'Basic Charge',
  'energy-low-season': 'Energy (Low Season)',
  'energy-high-season': 'Energy (High Season)',
  'demand-low-season': 'Demand (Low Season)',
  'demand-high-season': 'Demand (High Season)',
};

const METRIC_ORDER = ['basic-charge', 'energy-low-season', 'energy-high-season', 'demand-low-season', 'demand-high-season'];

// Sanitize name to match storage path format
const sanitizeName = (str: string): string => {
  return str
    .replace(/≥/g, 'gte')
    .replace(/≤/g, 'lte')
    .replace(/&/g, 'and')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/[^\x00-\x7F]/g, '')
    .trim();
};

export default function TariffChartsDialog({ 
  supplyAuthorityName, 
  province,
  open, 
  onOpenChange,
  onBulkCapture,
  onCancelBulkCapture,
  isBackgroundCapturing = false,
}: TariffChartsDialogProps) {
  const [charts, setCharts] = useState<ChartFile[]>([]);
  const [groupedCharts, setGroupedCharts] = useState<Record<string, ChartFile[]>>({});
  const [tariffOrder, setTariffOrder] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTariff, setSelectedTariff] = useState<string | null>(null);
  const [confirmedCharts, setConfirmedCharts] = useState<Set<string>>(new Set());

  // Calculate tariff confirmation status
  const getTariffConfirmationStatus = (tariffName: string): 'complete' | 'partial' | 'pending' => {
    const tariffCharts = groupedCharts[tariffName] || [];
    if (tariffCharts.length === 0) return 'pending';
    
    const confirmedCount = tariffCharts.filter(c => confirmedCharts.has(c.path)).length;
    if (confirmedCount === tariffCharts.length) return 'complete';
    if (confirmedCount > 0) return 'partial';
    return 'pending';
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

  // Confirm all charts for a tariff
  const confirmAllTariffCharts = (tariffName: string, confirm: boolean) => {
    const tariffCharts = groupedCharts[tariffName] || [];
    setConfirmedCharts(prev => {
      const next = new Set(prev);
      tariffCharts.forEach(c => {
        if (confirm) {
          next.add(c.path);
        } else {
          next.delete(c.path);
        }
      });
      return next;
    });
  };

  // Confirm all charts across all tariffs
  const confirmAllCharts = () => {
    setConfirmedCharts(new Set(charts.map(c => c.path)));
  };

  // Clear all confirmations
  const clearAllConfirmations = () => {
    setConfirmedCharts(new Set());
  };

  // Check if all charts are confirmed
  const allChartsConfirmed = charts.length > 0 && confirmedCharts.size === charts.length;

  // Calculate tariff categories for buttons
  const completeTariffs = tariffOrder.filter(t => getTariffConfirmationStatus(t) === 'complete');
  const hasCaptures = completeTariffs.length > 0;

  const fetchCharts = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const sanitizedProvince = sanitizeName(province);
      const sanitizedMunicipality = sanitizeName(supplyAuthorityName);
      const chartsPath = `Tariffs/${sanitizedProvince}/${sanitizedMunicipality}`;

      // List all files in the tariff charts folder
      const { data: files, error: listError } = await supabase.storage
        .from('tariff-files')
        .list(chartsPath, { limit: 1000 });

      if (listError) {
        throw new Error('Failed to list chart files');
      }

      if (!files || files.length === 0) {
        setCharts([]);
        setGroupedCharts({});
        setTariffOrder([]);
        return;
      }

      // Filter for PNG files and parse names
      const chartFiles: ChartFile[] = [];
      
      for (const file of files) {
        if (!file.name.endsWith('.png')) continue;
        
        // Parse filename: {tariff_name}-{metric}.png
        const nameWithoutExt = file.name.replace('.png', '');
        
        let foundMetric = '';
        let foundTariffName = '';
        
        // Check each known metric suffix (try longer ones first)
        for (const metric of [...METRIC_ORDER].reverse()) {
          const suffix = `-${metric}`;
          if (nameWithoutExt.endsWith(suffix)) {
            foundMetric = metric;
            foundTariffName = nameWithoutExt.slice(0, -suffix.length);
            break;
          }
        }
        
        // Skip if no known metric found
        if (!foundMetric || !foundTariffName) continue;
        
        const metricLabel = METRIC_LABELS[foundMetric] || foundMetric;
        const filePath = `${chartsPath}/${file.name}`;
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('tariff-files')
          .getPublicUrl(filePath);

        chartFiles.push({
          name: file.name,
          path: filePath,
          url: urlData.publicUrl,
          tariffName: foundTariffName,
          metric: foundMetric,
          metricLabel,
        });
      }

      // Sort by tariff name, then by metric order
      chartFiles.sort((a, b) => {
        const nameCompare = a.tariffName.localeCompare(b.tariffName);
        if (nameCompare !== 0) return nameCompare;
        
        // Same tariff - sort by metric order
        const metricOrderA = METRIC_ORDER.indexOf(a.metric);
        const metricOrderB = METRIC_ORDER.indexOf(b.metric);
        return metricOrderA - metricOrderB;
      });

      // Group by tariff name
      const grouped: Record<string, ChartFile[]> = {};
      const orderedTariffNames: string[] = [];
      
      for (const chart of chartFiles) {
        if (!grouped[chart.tariffName]) {
          grouped[chart.tariffName] = [];
          orderedTariffNames.push(chart.tariffName);
        }
        grouped[chart.tariffName].push(chart);
      }

      setCharts(chartFiles);
      setGroupedCharts(grouped);
      setTariffOrder(orderedTariffNames);
    } catch (err) {
      console.error('Error fetching charts:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch charts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open && supplyAuthorityName && province) {
      fetchCharts();
    }
  }, [open, supplyAuthorityName, province]);

  // Auto-select first tariff when data loads
  useEffect(() => {
    if (tariffOrder.length > 0 && !selectedTariff) {
      setSelectedTariff(tariffOrder[0]);
    }
  }, [tariffOrder, selectedTariff]);

  // Reset selection when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedTariff(null);
    }
  }, [open]);

  const downloadChart = async (chart: ChartFile) => {
    try {
      const { data, error } = await supabase.storage
        .from('tariff-files')
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
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    toast.success('All charts downloaded');
  };

  const selectedCharts = selectedTariff ? groupedCharts[selectedTariff] || [] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5" />
                Tariff Comparison Charts - {supplyAuthorityName}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2 flex-nowrap shrink-0">
              {onBulkCapture && (
                <>
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
                        {hasCaptures ? 'Restart All' : 'Capture All'}
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
          {/* Left sidebar - Tariff list */}
          <div className="w-1/5 min-w-[180px] border-r bg-muted/20">
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : tariffOrder.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No tariffs found
                  </div>
                ) : (
                  tariffOrder.map((tariffName, index) => {
                    const tariffCharts = groupedCharts[tariffName] || [];
                    const confirmStatus = getTariffConfirmationStatus(tariffName);
                    const confirmedCount = tariffCharts.filter(c => confirmedCharts.has(c.path)).length;
                    const allConfirmed = confirmedCount === tariffCharts.length && tariffCharts.length > 0;
                    const isSelected = selectedTariff === tariffName;
                    
                    return (
                      <div
                        key={tariffName}
                        className={`p-2 rounded-md cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-primary/10 border border-primary/30' 
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => setSelectedTariff(tariffName)}
                      >
                        <div className="flex items-center gap-2">
                          {/* Tariff confirmation checkbox */}
                          <Checkbox
                            id={`sidebar-confirm-${tariffName}`}
                            checked={allConfirmed}
                            onCheckedChange={(checked) => {
                              confirmAllTariffCharts(tariffName, !!checked);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">{index + 1}.</span>
                              <span className="text-sm font-medium truncate">{tariffName}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {tariffCharts.length} charts
                              </span>
                              {confirmStatus === 'complete' && (
                                <Check className="w-3 h-3 text-green-500" />
                              )}
                              {confirmStatus === 'partial' && (
                                <span className="text-xs text-amber-500">
                                  ({confirmedCount}/{tariffCharts.length})
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

          {/* Right detail panel - Charts for selected tariff */}
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
              ) : !selectedTariff ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Select a tariff from the list to view charts</p>
                </div>
              ) : charts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">No tariff charts found</p>
                  <p className="text-sm text-muted-foreground">
                    Use "Capture All" to generate charts
                  </p>
                </div>
              ) : (
                <div className="p-4">
                  {/* Selected tariff header */}
                  <div className="flex items-center justify-between mb-4 pb-3 border-b">
                    <div>
                      <h3 className="font-semibold text-lg">{selectedTariff}</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedCharts.length} charts
                      </p>
                    </div>
                    {/* Confirmation status for selected tariff */}
                    {(() => {
                      const tariffCharts = groupedCharts[selectedTariff] || [];
                      const confirmedCount = tariffCharts.filter(c => confirmedCharts.has(c.path)).length;
                      const confirmStatus = getTariffConfirmationStatus(selectedTariff);
                      return (
                        <Badge 
                          variant={confirmStatus === 'complete' ? 'default' : confirmStatus === 'partial' ? 'secondary' : 'outline'}
                          className={confirmStatus === 'complete' ? 'bg-green-600' : ''}
                        >
                          {confirmStatus === 'complete' && <Check className="w-3 h-3 mr-1" />}
                          {confirmStatus === 'complete' ? 'All Confirmed' : 
                           confirmStatus === 'partial' ? `${confirmedCount}/${tariffCharts.length} Confirmed` : 
                           'Unconfirmed'}
                        </Badge>
                      );
                    })()}
                  </div>

                  {/* Charts grid */}
                  <div className="grid grid-cols-3 gap-4 overflow-hidden">
                    {selectedCharts.map((chart) => {
                      const isConfirmed = confirmedCharts.has(chart.path);
                      return (
                        <Card 
                          key={chart.name} 
                          className={`overflow-hidden group relative transition-all ${isConfirmed ? 'ring-2 ring-green-500' : 'ring-1 ring-destructive/30'}`}
                        >
                          <div className="bg-white relative border-b h-32 cursor-zoom-in transition-all duration-300 hover:scale-150 hover:z-50 hover:shadow-xl hover:rounded-md origin-center">
                            <img
                              src={`${chart.url}?t=${Date.now()}`}
                              alt={`${chart.tariffName} - ${chart.metricLabel}`}
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

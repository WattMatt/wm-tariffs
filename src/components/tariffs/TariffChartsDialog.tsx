import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, RefreshCw, ImageIcon, Loader2, FolderOpen } from "lucide-react";

interface TariffChartsDialogProps {
  supplyAuthorityName: string;
  province: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  onOpenChange 
}: TariffChartsDialogProps) {
  const [charts, setCharts] = useState<ChartFile[]>([]);
  const [groupedCharts, setGroupedCharts] = useState<Record<string, ChartFile[]>>({});
  const [tariffOrder, setTariffOrder] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTariff, setSelectedTariff] = useState<string | null>(null);

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
            <div className="flex items-center gap-2">
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
                  Download All
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">
            <p>{error}</p>
            <Button variant="outline" className="mt-4" onClick={fetchCharts}>
              Try Again
            </Button>
          </div>
        ) : charts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No charts captured yet</p>
            <p className="text-sm mt-2">Use the capture button to generate tariff comparison charts</p>
          </div>
        ) : (
          <div className="flex gap-4 h-[calc(85vh-120px)]">
            {/* Left sidebar - tariff list */}
            <div className="w-1/4 border-r pr-4">
              <ScrollArea className="h-full">
                <div className="space-y-1">
                  {tariffOrder.map((tariffName) => {
                    const tariffCharts = groupedCharts[tariffName] || [];
                    const isSelected = selectedTariff === tariffName;
                    
                    return (
                      <button
                        key={tariffName}
                        onClick={() => setSelectedTariff(tariffName)}
                        className={`w-full text-left px-3 py-2 rounded-md transition-colors flex items-center justify-between ${
                          isSelected 
                            ? 'bg-primary text-primary-foreground' 
                            : 'hover:bg-muted'
                        }`}
                      >
                        <span className="text-sm font-medium truncate flex-1 mr-2">
                          {tariffName}
                        </span>
                        <Badge 
                          variant={isSelected ? "secondary" : "outline"} 
                          className="shrink-0"
                        >
                          {tariffCharts.length}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Right panel - chart grid */}
            <div className="flex-1">
              <ScrollArea className="h-full">
                {selectedTariff && selectedCharts.length > 0 ? (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 pr-4">
                    {selectedCharts.map((chart) => (
                      <Card key={chart.path} className="overflow-hidden">
                        <CardContent className="p-2">
                          <div className="aspect-[4/3] relative bg-muted rounded overflow-hidden mb-2">
                            <img
                              src={`${chart.url}?t=${Date.now()}`}
                              alt={`${chart.tariffName} - ${chart.metricLabel}`}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium truncate">
                              {chart.metricLabel}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => downloadChart(chart)}
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Select a tariff to view its charts
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

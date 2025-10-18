import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Site {
  id: string;
  name: string;
  clients: { name: string } | null;
}

export default function Reconciliation() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [reconciliationData, setReconciliationData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSites();
  }, []);

  const fetchSites = async () => {
    const { data } = await supabase
      .from("sites")
      .select("id, name, clients(name)")
      .order("name");
    setSites(data || []);
  };

  const handleReconcile = async () => {
    if (!selectedSite || !dateFrom || !dateTo) {
      toast.error("Please select a site and date range");
      return;
    }

    setIsLoading(true);

    // Fetch all meters for the site
    const { data: meters } = await supabase
      .from("meters")
      .select("id, meter_number, meter_type")
      .eq("site_id", selectedSite);

    if (!meters || meters.length === 0) {
      toast.error("No meters found for this site");
      setIsLoading(false);
      return;
    }

    // Fetch readings for each meter within date range
    const meterData = await Promise.all(
      meters.map(async (meter) => {
        const { data: readings } = await supabase
          .from("meter_readings")
          .select("kwh_value")
          .eq("meter_id", meter.id)
          .gte("reading_timestamp", dateFrom.toISOString())
          .lte("reading_timestamp", dateTo.toISOString())
          .order("reading_timestamp");

        const totalKwh = readings?.reduce((sum, r) => sum + Number(r.kwh_value), 0) || 0;

        return {
          ...meter,
          totalKwh,
          readingsCount: readings?.length || 0,
        };
      })
    );

    const councilBulk = meterData.filter((m) => m.meter_type === "council_bulk");
    const checkMeters = meterData.filter((m) => m.meter_type === "check_meter");
    const distribution = meterData.filter((m) => m.meter_type === "distribution");

    const councilTotal = councilBulk.reduce((sum, m) => sum + m.totalKwh, 0);
    const distributionTotal = distribution.reduce((sum, m) => sum + m.totalKwh, 0);
    const recoveryRate = councilTotal > 0 ? (distributionTotal / councilTotal) * 100 : 0;
    const discrepancy = councilTotal - distributionTotal;

    setReconciliationData({
      councilBulk,
      checkMeters,
      distribution,
      councilTotal,
      distributionTotal,
      recoveryRate,
      discrepancy,
    });

    setIsLoading(false);
    toast.success("Reconciliation complete");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">Reconciliation</h1>
          <p className="text-muted-foreground">
            Compare council supply against recovered consumption
          </p>
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Analysis Parameters</CardTitle>
            <CardDescription>Select site and date range for reconciliation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Site</Label>
                <Select value={selectedSite} onValueChange={setSelectedSite}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name} {site.clients && `(${site.clients.name})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>From Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dateFrom && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>To Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dateTo && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={dateTo} onSelect={setDateTo} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <Button onClick={handleReconcile} disabled={isLoading} className="w-full">
              {isLoading ? "Analyzing..." : "Run Reconciliation"}
            </Button>
          </CardContent>
        </Card>

        {reconciliationData && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Council Supply
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {reconciliationData.councilTotal.toFixed(2)} kWh
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Recovered
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {reconciliationData.distributionTotal.toFixed(2)} kWh
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Recovery Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {reconciliationData.recoveryRate.toFixed(1)}%
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Discrepancy
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn(
                    "text-2xl font-bold",
                    reconciliationData.discrepancy > 0 ? "text-warning" : "text-accent"
                  )}>
                    {reconciliationData.discrepancy.toFixed(2)} kWh
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Detailed Breakdown</CardTitle>
                  <CardDescription>Meter-by-meter consumption analysis</CardDescription>
                </div>
                <Button variant="outline" className="gap-2">
                  <Download className="w-4 h-4" />
                  Export Report
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                {reconciliationData.councilBulk.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">Council Bulk Supply</h3>
                    <div className="space-y-2">
                      {reconciliationData.councilBulk.map((meter: any) => (
                        <div key={meter.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <span className="font-mono text-sm">{meter.meter_number}</span>
                          <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {reconciliationData.distribution.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">Distribution Meters</h3>
                    <div className="space-y-2">
                      {reconciliationData.distribution.map((meter: any) => (
                        <div key={meter.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <span className="font-mono text-sm">{meter.meter_number}</span>
                          <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {!reconciliationData && (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-muted-foreground">
                Select parameters and run reconciliation to see results
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

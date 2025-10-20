import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, Download } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReconciliationTabProps {
  siteId: string;
}

export default function ReconciliationTab({ siteId }: ReconciliationTabProps) {
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [reconciliationData, setReconciliationData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleReconcile = async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    setIsLoading(true);

    try {
      // Fetch all meters for the site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("site_id", siteId);

      if (metersError) {
        console.error("Error fetching meters:", metersError);
        throw new Error("Failed to fetch meters");
      }

      if (!meters || meters.length === 0) {
        toast.error("No meters found for this site");
        setIsLoading(false);
        return;
      }

      // Fetch readings for each meter within date range (deduplicated by timestamp)
      const meterData = await Promise.all(
        meters.map(async (meter) => {
          // First get distinct timestamps with their max value (in case of duplicates)
          const { data: readings, error: readingsError } = await supabase
            .from("meter_readings")
            .select("kwh_value, reading_timestamp")
            .eq("meter_id", meter.id)
            .gte("reading_timestamp", dateFrom.toISOString())
            .lte("reading_timestamp", dateTo.toISOString())
            .order("reading_timestamp", { ascending: true });

          if (readingsError) {
            console.error(`Error fetching readings for meter ${meter.meter_number}:`, readingsError);
          }

          // Deduplicate by timestamp (take first occurrence of each unique timestamp)
          const uniqueReadings = readings ? 
            Array.from(
              new Map(
                readings.map(r => [r.reading_timestamp, r])
              ).values()
            ) : [];

          // Sum all interval readings (each represents consumption for that period)
          let totalKwh = 0;
          if (uniqueReadings.length > 0) {
            totalKwh = uniqueReadings.reduce((sum, r) => sum + Number(r.kwh_value), 0);
            
            // Debug logging
            console.log(`Meter ${meter.meter_number} (${meter.meter_type}):`, {
              originalReadings: readings?.length || 0,
              uniqueReadings: uniqueReadings.length,
              duplicatesRemoved: (readings?.length || 0) - uniqueReadings.length,
              totalKwh: totalKwh.toFixed(2),
              firstTimestamp: uniqueReadings[0].reading_timestamp,
              lastTimestamp: uniqueReadings[uniqueReadings.length - 1].reading_timestamp
            });
          } else {
            console.log(`Meter ${meter.meter_number}: No readings in date range`);
          }

          return {
            ...meter,
            totalKwh,
            readingsCount: uniqueReadings.length,
          };
        })
      );

      const councilBulk = meterData.filter((m) => m.meter_type === "council_bulk");
      const checkMeters = meterData.filter((m) => m.meter_type === "check_meter");
      const solarMeters = meterData.filter((m) => m.meter_type === "solar");
      const distribution = meterData.filter((m) => m.meter_type === "distribution");

      const councilTotal = councilBulk.reduce((sum, m) => sum + m.totalKwh, 0);
      const solarTotal = solarMeters.reduce((sum, m) => sum + m.totalKwh, 0);
      const distributionTotal = distribution.reduce((sum, m) => sum + m.totalKwh, 0);
      
      // Total supply = Council (from grid) + Solar (on-site generation)
      const totalSupply = councilTotal + solarTotal;
      const recoveryRate = totalSupply > 0 ? (distributionTotal / totalSupply) * 100 : 0;
      const discrepancy = totalSupply - distributionTotal;

      setReconciliationData({
        councilBulk,
        checkMeters,
        solarMeters,
        distribution,
        councilTotal,
        solarTotal,
        totalSupply,
        distributionTotal,
        recoveryRate,
        discrepancy,
      });

      toast.success("Reconciliation complete");
    } catch (error) {
      console.error("Reconciliation error:", error);
      toast.error("Failed to complete reconciliation. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Energy Reconciliation</h2>
        <p className="text-muted-foreground">
          Balance total supply (grid + solar) against downstream distribution
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Bulk Check Meter + Solar Generation = Total Supply ≈ Sum of all Distribution Meters
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Analysis Parameters</CardTitle>
          <CardDescription>Select date range for reconciliation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Council (Grid)
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
                  Solar (Generated)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {reconciliationData.solarTotal.toFixed(2)} kWh
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Supply
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {reconciliationData.totalSupply.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Grid + Solar
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reconciliationData.distributionTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Recovery: {reconciliationData.recoveryRate.toFixed(1)}%
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
                <div
                  className={cn(
                    "text-2xl font-bold",
                    reconciliationData.discrepancy > 0 ? "text-warning" : "text-accent"
                  )}
                >
                  {reconciliationData.discrepancy.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {reconciliationData.discrepancy > 0 ? "Unaccounted" : "Over-recovered"}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Supply Sources */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b pb-2">Supply Sources</h3>
                  
                  {reconciliationData.councilBulk.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Council Bulk (Grid)</h4>
                      <div className="space-y-2">
                        {reconciliationData.councilBulk.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                          >
                            <span className="font-mono text-sm">{meter.meter_number}</span>
                            <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reconciliationData.solarMeters?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Solar Generation</h4>
                      <div className="space-y-2">
                        {reconciliationData.solarMeters.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-200"
                          >
                            <span className="font-mono text-sm">{meter.meter_number}</span>
                            <span className="font-semibold text-green-700">{meter.totalKwh.toFixed(2)} kWh</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reconciliationData.checkMeters?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Check Meters</h4>
                      <div className="space-y-2">
                        {reconciliationData.checkMeters.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="flex items-center justify-between p-3 rounded-lg bg-blue-50 border border-blue-200"
                          >
                            <span className="font-mono text-sm">{meter.meter_number}</span>
                            <span className="font-semibold text-blue-700">{meter.totalKwh.toFixed(2)} kWh</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Distribution / Consumption */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b pb-2">Distribution / Consumption</h3>
                  
              {reconciliationData.distribution.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">
                        Downstream Meters
                        <span className="ml-2 text-xs font-normal">
                          (Total: {reconciliationData.distributionTotal.toFixed(2)} kWh)
                        </span>
                      </h4>
                      <div className="space-y-2">
                        {reconciliationData.distribution.map((meter: any) => {
                          const percentage = reconciliationData.distributionTotal > 0 
                            ? (meter.totalKwh / reconciliationData.distributionTotal) * 100 
                            : 0;
                          
                          return (
                            <div
                              key={meter.id}
                              className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                            >
                              <span className="font-mono text-sm">{meter.meter_number}</span>
                              <div className="flex items-center gap-3">
                                <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                                <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded border border-border">
                                  {percentage.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
              )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!reconciliationData && (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-muted-foreground">
              Select date range and run reconciliation to see results
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

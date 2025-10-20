import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, Sun, TrendingDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface MeterWithNegatives {
  meter_id: string;
  meter_number: string;
  meter_name: string | null;
  meter_type: string;
  negative_count: number;
  total_readings: number;
  min_value: number;
  avg_value: number;
  latest_negative_date: string;
}

interface NegativeReadingsDetectorProps {
  siteId: string;
}

export default function NegativeReadingsDetector({ siteId }: NegativeReadingsDetectorProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState<MeterWithNegatives[]>([]);
  const [hasScanned, setHasScanned] = useState(false);

  const scanForNegativeReadings = async () => {
    setIsScanning(true);
    setHasScanned(false);
    
    try {
      // Get all meters for this site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, name, meter_type")
        .eq("site_id", siteId);

      if (metersError) throw metersError;
      if (!meters || meters.length === 0) {
        toast.info("No meters found for this site");
        setIsScanning(false);
        setHasScanned(true);
        return;
      }

      // Analyze readings for each meter
      const metersWithNegatives: MeterWithNegatives[] = [];

      for (const meter of meters) {
        // Get all readings for this meter
        const { data: readings, error: readingsError } = await supabase
          .from("meter_readings")
          .select("kwh_value, reading_timestamp")
          .eq("meter_id", meter.id)
          .order("reading_timestamp", { ascending: false });

        if (readingsError) {
          console.error(`Error fetching readings for meter ${meter.meter_number}:`, readingsError);
          continue;
        }

        if (!readings || readings.length === 0) continue;

        // Find negative readings
        const negativeReadings = readings.filter(r => r.kwh_value < 0);
        
        if (negativeReadings.length > 0) {
          const allNegativeValues = negativeReadings.map(r => r.kwh_value);
          const minValue = Math.min(...allNegativeValues);
          const avgValue = allNegativeValues.reduce((a, b) => a + b, 0) / allNegativeValues.length;

          metersWithNegatives.push({
            meter_id: meter.id,
            meter_number: meter.meter_number,
            meter_name: meter.name,
            meter_type: meter.meter_type,
            negative_count: negativeReadings.length,
            total_readings: readings.length,
            min_value: minValue,
            avg_value: avgValue,
            latest_negative_date: negativeReadings[0].reading_timestamp
          });
        }
      }

      // Sort by number of negative readings (descending)
      metersWithNegatives.sort((a, b) => b.negative_count - a.negative_count);

      setResults(metersWithNegatives);
      setHasScanned(true);

      if (metersWithNegatives.length > 0) {
        toast.success(`Found ${metersWithNegatives.length} meter(s) with negative readings`);
      } else {
        toast.info("No meters with negative readings detected");
      }

    } catch (error) {
      console.error("Error scanning for negative readings:", error);
      toast.error("Failed to scan for negative readings");
    } finally {
      setIsScanning(false);
    }
  };

  const getMeterTypeLabel = (type: string) => {
    switch (type) {
      case "council_bulk": return "Council Bulk";
      case "check_meter": return "Check Meter";
      case "solar": return "Solar";
      case "distribution": return "Distribution";
      default: return type;
    }
  };

  const getSeverityColor = (percentage: number) => {
    if (percentage > 50) return "bg-destructive text-destructive-foreground";
    if (percentage > 25) return "bg-warning text-warning-foreground";
    return "bg-accent text-accent-foreground";
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-destructive" />
              Negative Readings Detection
            </CardTitle>
            <CardDescription>
              Identify meters with negative kWh values indicating reverse power flow (solar generation or other sources)
            </CardDescription>
          </div>
          <Button 
            onClick={scanForNegativeReadings}
            disabled={isScanning}
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 mr-2" />
                Scan for Negative Readings
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {hasScanned && (
        <CardContent>
          {results.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sun className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No Negative Readings Detected</p>
              <p className="text-sm">All meters show positive consumption values</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg border border-border/50">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-sm">
                      {results.length} meter{results.length !== 1 ? 's' : ''} detected with negative readings
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Negative values indicate reverse power flow, typically from solar generation or other on-site power sources
                      feeding back into the meter. These meters may need to be reconfigured or marked as solar generation points.
                    </p>
                  </div>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Meter</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Negative Readings</TableHead>
                    <TableHead>Min Value</TableHead>
                    <TableHead>Avg Negative</TableHead>
                    <TableHead>Latest Occurrence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((result) => {
                    const percentage = (result.negative_count / result.total_readings) * 100;
                    return (
                      <TableRow key={result.meter_id}>
                        <TableCell>
                          <div>
                            <p className="font-mono font-medium">{result.meter_number}</p>
                            {result.meter_name && (
                              <p className="text-xs text-muted-foreground">{result.meter_name}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getMeterTypeLabel(result.meter_type)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge className={getSeverityColor(percentage)}>
                              {result.negative_count} / {result.total_readings}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              ({percentage.toFixed(1)}%)
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-destructive font-medium">
                          {result.min_value.toFixed(2)} kWh
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {result.avg_value.toFixed(2)} kWh
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(result.latest_negative_date), "dd MMM yyyy HH:mm")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="bg-muted/30 p-4 rounded-lg text-sm space-y-2">
                <p className="font-medium flex items-center gap-2">
                  <Sun className="w-4 h-4" />
                  Recommended Actions:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-6">
                  <li>Verify if these meters have solar panels or other generation sources connected</li>
                  <li>Consider changing meter type to "Solar Generation" if confirmed</li>
                  <li>Review meter connections to ensure proper hierarchy</li>
                  <li>Check if these meters should be excluded from consumption reconciliation</li>
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

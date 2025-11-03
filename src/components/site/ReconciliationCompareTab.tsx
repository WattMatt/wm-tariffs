import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface ReconciliationCompareTabProps {
  siteId: string;
}

interface ReconciliationRun {
  id: string;
  run_name: string;
  run_date: string;
  date_from: string;
  date_to: string;
  bulk_total: number;
  solar_total: number;
  tenant_total: number;
  total_supply: number;
  recovery_rate: number;
  discrepancy: number;
  reconciliation_meter_results: MeterResult[];
}

interface MeterResult {
  meter_number: string;
  meter_name: string | null;
  meter_type: string;
  assignment: string;
  total_kwh: number;
  readings_count: number;
}

export default function ReconciliationCompareTab({ siteId }: ReconciliationCompareTabProps) {
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set());
  const [comparisonData, setComparisonData] = useState<ReconciliationRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchReconciliationHistory();
  }, [siteId]);

  const fetchReconciliationHistory = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("reconciliation_runs")
        .select(`
          *,
          reconciliation_meter_results (*)
        `)
        .eq("site_id", siteId)
        .order("run_date", { ascending: false })
        .limit(20);

      if (error) throw error;
      setRuns(data || []);
    } catch (error) {
      console.error("Error fetching reconciliation history:", error);
      toast.error("Failed to load reconciliation history");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRunSelection = (runId: string) => {
    const newSelection = new Set(selectedRuns);
    if (newSelection.has(runId)) {
      newSelection.delete(runId);
    } else {
      if (newSelection.size >= 4) {
        toast.error("You can compare up to 4 reconciliations at once");
        return;
      }
      newSelection.add(runId);
    }
    setSelectedRuns(newSelection);
  };

  const handleCompare = () => {
    if (selectedRuns.size < 2) {
      toast.error("Please select at least 2 reconciliations to compare");
      return;
    }

    const selectedData = runs.filter(r => selectedRuns.has(r.id));
    setComparisonData(selectedData);
  };

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return { value: 0, percentage: 0 };
    const diff = current - previous;
    const percentage = (diff / previous) * 100;
    return { value: diff, percentage };
  };

  const renderChangeIndicator = (change: { value: number; percentage: number }) => {
    if (Math.abs(change.percentage) < 0.1) {
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Minus className="h-3 w-3" />
          <span className="text-xs">No change</span>
        </span>
      );
    }

    const isIncrease = change.value > 0;
    return (
      <span className={`flex items-center gap-1 ${isIncrease ? "text-green-600" : "text-red-600"}`}>
        {isIncrease ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        <span className="text-xs font-medium">
          {isIncrease ? "+" : ""}{change.percentage.toFixed(1)}%
        </span>
      </span>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Compare Reconciliations</CardTitle>
          <CardDescription>Loading reconciliations...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Select Reconciliations to Compare</CardTitle>
          <CardDescription>Choose 2-4 reconciliation runs to compare their results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              {runs.map((run) => (
                <div key={run.id} className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50">
                  <Checkbox
                    checked={selectedRuns.has(run.id)}
                    onCheckedChange={() => toggleRunSelection(run.id)}
                  />
                  <div className="flex-1">
                    <p className="font-medium">{run.run_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(run.date_from), "dd MMM yyyy")} - {format(new Date(run.date_to), "dd MMM yyyy")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono">{run.bulk_total.toFixed(2)} kWh</p>
                    <Badge variant={run.recovery_rate >= 95 ? "default" : "secondary"} className="text-xs">
                      {run.recovery_rate.toFixed(2)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            <Button onClick={handleCompare} disabled={selectedRuns.size < 2}>
              Compare Selected ({selectedRuns.size})
            </Button>
          </div>
        </CardContent>
      </Card>

      {comparisonData.length > 0 && (
        <>
          {/* Summary Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Summary Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    {comparisonData.map((run) => (
                      <TableHead key={run.id} className="text-right">
                        <div className="flex flex-col items-end">
                          <span className="font-medium">{run.run_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(run.run_date), "dd MMM yyyy")}
                          </span>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Grid Supply</TableCell>
                    {comparisonData.map((run, idx) => (
                      <TableCell key={run.id} className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono">{run.bulk_total.toFixed(2)} kWh</span>
                          {idx > 0 && renderChangeIndicator(calculateChange(run.bulk_total, comparisonData[idx - 1].bulk_total))}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Solar Energy</TableCell>
                    {comparisonData.map((run, idx) => (
                      <TableCell key={run.id} className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono">{run.solar_total.toFixed(2)} kWh</span>
                          {idx > 0 && renderChangeIndicator(calculateChange(run.solar_total, comparisonData[idx - 1].solar_total))}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Total Supply</TableCell>
                    {comparisonData.map((run, idx) => (
                      <TableCell key={run.id} className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono">{run.total_supply.toFixed(2)} kWh</span>
                          {idx > 0 && renderChangeIndicator(calculateChange(run.total_supply, comparisonData[idx - 1].total_supply))}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Recovery Rate</TableCell>
                    {comparisonData.map((run, idx) => (
                      <TableCell key={run.id} className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={run.recovery_rate >= 95 ? "default" : "secondary"}>
                            {run.recovery_rate.toFixed(2)}%
                          </Badge>
                          {idx > 0 && renderChangeIndicator(calculateChange(run.recovery_rate, comparisonData[idx - 1].recovery_rate))}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Discrepancy</TableCell>
                    {comparisonData.map((run, idx) => (
                      <TableCell key={run.id} className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono">{run.discrepancy.toFixed(2)} kWh</span>
                          {idx > 0 && renderChangeIndicator(calculateChange(run.discrepancy, comparisonData[idx - 1].discrepancy))}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Meter-Level Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Meter-Level Comparison</CardTitle>
              <CardDescription>Consumption changes for each meter across selected reconciliations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground mb-4">
                Showing meters that appear in at least one of the selected reconciliations
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Meter Number</TableHead>
                    <TableHead>Type</TableHead>
                    {comparisonData.map((run) => (
                      <TableHead key={run.id} className="text-right">
                        {format(new Date(run.run_date), "dd MMM")}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(
                    new Set(
                      comparisonData.flatMap(run =>
                        run.reconciliation_meter_results.map(m => m.meter_number)
                      )
                    )
                  ).map((meterNumber) => {
                    const meterData = comparisonData.map(run =>
                      run.reconciliation_meter_results.find(m => m.meter_number === meterNumber)
                    );
                    const meterType = meterData.find(m => m)?.meter_type || "";

                    return (
                      <TableRow key={meterNumber}>
                        <TableCell className="font-mono text-sm">{meterNumber}</TableCell>
                        <TableCell className="text-sm">{meterType}</TableCell>
                        {meterData.map((meter, idx) => (
                          <TableCell key={idx} className="text-right">
                            {meter ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="font-mono text-sm">{meter.total_kwh.toFixed(2)} kWh</span>
                                {idx > 0 && meterData[idx - 1] && renderChangeIndicator(
                                  calculateChange(meter.total_kwh, meterData[idx - 1]!.total_kwh)
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

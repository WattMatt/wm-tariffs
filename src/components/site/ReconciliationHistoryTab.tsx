import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileDown, Eye, Trash2, Download, FileText, Zap, DollarSign } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import ReconciliationResultsView from "./ReconciliationResultsView";
import SiteReportExport from "./SiteReportExport";
import { cn } from "@/lib/utils";

interface ReconciliationHistoryTabProps {
  siteId: string;
  siteName: string;
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
  notes: string | null;
  revenue_enabled: boolean;
  grid_supply_cost: number;
  solar_cost: number;
  tenant_cost: number;
  total_revenue: number;
  avg_cost_per_kwh: number;
  reconciliation_meter_results: MeterResult[];
}

interface MeterResult {
  id: string;
  meter_id: string;
  meter_number: string;
  meter_name: string | null;
  meter_type: string;
  location: string | null;
  assignment: string;
  total_kwh: number;
  total_kwh_positive: number;
  total_kwh_negative: number;
  readings_count: number;
  column_totals: any;
  column_max_values: any;
  has_error: boolean;
  error_message: string | null;
  tariff_name: string | null;
  energy_cost: number;
  fixed_charges: number;
  total_cost: number;
  avg_cost_per_kwh: number;
  cost_calculation_error: string | null;
}

export default function ReconciliationHistoryTab({ siteId, siteName }: ReconciliationHistoryTabProps) {
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<ReconciliationRun | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [reportRun, setReportRun] = useState<ReconciliationRun | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);

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
        .order("run_date", { ascending: false });

      if (error) throw error;
      setRuns(data || []);
    } catch (error) {
      console.error("Error fetching reconciliation history:", error);
      toast.error("Failed to load reconciliation history");
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewDetails = (run: ReconciliationRun) => {
    setSelectedRun(run);
    setIsDetailOpen(true);
  };

  const handleGenerateReport = (run: ReconciliationRun) => {
    setReportRun(run);
    setIsReportOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteRunId) return;

    try {
      const { error } = await supabase
        .from("reconciliation_runs")
        .delete()
        .eq("id", deleteRunId);

      if (error) throw error;

      toast.success("Reconciliation deleted successfully");
      setRuns(runs.filter(r => r.id !== deleteRunId));
      setDeleteRunId(null);
    } catch (error) {
      console.error("Error deleting reconciliation:", error);
      toast.error("Failed to delete reconciliation");
    }
  };

  const exportToCSV = (run: ReconciliationRun) => {
    const csvData = run.reconciliation_meter_results.map(m => {
      const baseData: any = {
        "Meter Number": m.meter_number,
        "Meter Name": m.meter_name || "",
        "Type": m.meter_type,
        "Assignment": m.assignment,
        "Location": m.location || "",
        "Total kWh": m.total_kwh.toFixed(2),
        "Positive kWh": m.total_kwh_positive.toFixed(2),
        "Negative kWh": m.total_kwh_negative.toFixed(2),
        "Readings Count": m.readings_count,
      };
      
      // Add revenue columns if available
      if (run.revenue_enabled && m.tariff_name) {
        baseData["Tariff"] = m.tariff_name;
        baseData["Energy Cost (R)"] = m.energy_cost.toFixed(2);
        baseData["Fixed Charges (R)"] = m.fixed_charges.toFixed(2);
        baseData["Total Cost (R)"] = m.total_cost.toFixed(2);
        baseData["Avg Cost/kWh (R)"] = m.avg_cost_per_kwh.toFixed(4);
      }
      
      return baseData;
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.run_name}_${format(new Date(run.run_date), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportToExcel = (run: ReconciliationRun) => {
    const wb = XLSX.utils.book_new();

    // Summary sheet - Energy
    const energySummaryData = [
      ["Energy Reconciliation Summary"],
      ["Run Name", run.run_name],
      ["Date Range", `${format(new Date(run.date_from), "PP")} to ${format(new Date(run.date_to), "PP")}`],
      ["Run Date", format(new Date(run.run_date), "PPpp")],
      [],
      ["Metric", "Value", "Unit"],
      ["Grid Supply", run.bulk_total.toFixed(2), "kWh"],
      ["Solar Energy", run.solar_total.toFixed(2), "kWh"],
      ["Tenant Consumption", run.tenant_total.toFixed(2), "kWh"],
      ["Total Supply", run.total_supply.toFixed(2), "kWh"],
      ["Recovery Rate", run.recovery_rate.toFixed(2), "%"],
      ["Discrepancy", run.discrepancy.toFixed(2), "kWh"],
    ];

    if (run.notes) {
      energySummaryData.push([], ["Notes", run.notes]);
    }

    const energySummarySheet = XLSX.utils.aoa_to_sheet(energySummaryData);
    XLSX.utils.book_append_sheet(wb, energySummarySheet, "Energy Summary");

    // Revenue summary sheet (if available)
    if (run.revenue_enabled) {
      const revenueSummaryData = [
        ["Revenue Reconciliation Summary"],
        ["Run Name", run.run_name],
        ["Date Range", `${format(new Date(run.date_from), "PP")} to ${format(new Date(run.date_to), "PP")}`],
        ["Run Date", format(new Date(run.run_date), "PPpp")],
        [],
        ["Metric", "Value (R)", "Percentage"],
        ["Grid Supply Cost", run.grid_supply_cost.toFixed(2), `${((run.grid_supply_cost / (run.grid_supply_cost + run.solar_cost)) * 100).toFixed(2)}%`],
        ["Solar Cost", run.solar_cost.toFixed(2), `${((run.solar_cost / (run.grid_supply_cost + run.solar_cost)) * 100).toFixed(2)}%`],
        ["Total Supply Cost", (run.grid_supply_cost + run.solar_cost).toFixed(2), "100.00%"],
        ["Metered Revenue", run.tenant_cost.toFixed(2), `${((run.tenant_cost / (run.grid_supply_cost + run.solar_cost)) * 100).toFixed(2)}%`],
        ["Avg Cost/kWh", run.avg_cost_per_kwh.toFixed(4), ""],
      ];

      const revenueSummarySheet = XLSX.utils.aoa_to_sheet(revenueSummaryData);
      XLSX.utils.book_append_sheet(wb, revenueSummarySheet, "Revenue Summary");
    }

    // Meter details sheet
    const meterData = run.reconciliation_meter_results.map(m => {
      const baseData: any = {
        "Meter Number": m.meter_number,
        "Meter Name": m.meter_name || "",
        "Type": m.meter_type,
        "Assignment": m.assignment,
        "Location": m.location || "",
        "Total kWh": m.total_kwh.toFixed(2),
        "Positive kWh": m.total_kwh_positive.toFixed(2),
        "Negative kWh": m.total_kwh_negative.toFixed(2),
        "Readings Count": m.readings_count,
      };
      
      // Add revenue columns if available
      if (run.revenue_enabled && m.tariff_name) {
        baseData["Tariff"] = m.tariff_name;
        baseData["Energy Cost (R)"] = m.energy_cost.toFixed(2);
        baseData["Fixed Charges (R)"] = m.fixed_charges.toFixed(2);
        baseData["Total Cost (R)"] = m.total_cost.toFixed(2);
        baseData["Avg Cost/kWh (R)"] = m.avg_cost_per_kwh.toFixed(4);
      }
      
      return baseData;
    });

    const meterSheet = XLSX.utils.json_to_sheet(meterData);
    XLSX.utils.book_append_sheet(wb, meterSheet, "Meter Details");

    XLSX.writeFile(wb, `${run.run_name}_${format(new Date(run.run_date), "yyyy-MM-dd")}.xlsx`);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation History</CardTitle>
          <CardDescription>Loading saved reconciliations...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation History</CardTitle>
          <CardDescription>View and manage saved reconciliation runs</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No saved reconciliations yet. Run a reconciliation and save the results.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run Name</TableHead>
                  <TableHead>Date Range</TableHead>
                  <TableHead>Run Date</TableHead>
                  <TableHead className="text-right">Grid Supply</TableHead>
                  <TableHead className="text-right">Recovery Rate</TableHead>
                  <TableHead className="text-right">Data</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.run_name}</TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(run.date_from), "dd MMM yyyy")} - {format(new Date(run.date_to), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-sm">{format(new Date(run.run_date), "PPpp")}</TableCell>
                    <TableCell className="text-right font-mono">{run.bulk_total.toFixed(2)} kWh</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={run.recovery_rate >= 95 ? "default" : run.recovery_rate >= 85 ? "secondary" : "destructive"}>
                        {run.recovery_rate.toFixed(2)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Badge variant="outline" className="gap-1">
                          <Zap className="h-3 w-3" />
                        </Badge>
                        <Badge variant="outline" className={cn("gap-1", !run.revenue_enabled && "opacity-30")}>
                          <DollarSign className="h-3 w-3" />
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleGenerateReport(run)}
                          title="Generate report"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleViewDetails(run)}
                          title="View details"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => exportToCSV(run)}
                          title="Export to CSV"
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => exportToExcel(run)}
                          title="Export to Excel"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteRunId(run.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedRun?.run_name}</DialogTitle>
            <DialogDescription>
              {selectedRun && `${format(new Date(selectedRun.date_from), "PP")} - ${format(new Date(selectedRun.date_to), "PP")}`}
            </DialogDescription>
          </DialogHeader>

          {selectedRun && (
            <>
              <ReconciliationResultsView
                bulkTotal={selectedRun.bulk_total}
                solarTotal={selectedRun.solar_total}
                tenantTotal={selectedRun.tenant_total}
                totalSupply={selectedRun.total_supply}
                recoveryRate={selectedRun.recovery_rate}
                discrepancy={selectedRun.discrepancy}
                distributionTotal={selectedRun.total_supply - selectedRun.bulk_total - selectedRun.solar_total}
                meters={selectedRun.reconciliation_meter_results.map(m => ({
                  id: m.meter_id,
                  meter_number: m.meter_number,
                  meter_name: m.meter_name || undefined,
                  meter_type: m.meter_type,
                  location: m.location || undefined,
                  assignment: m.assignment,
                  totalKwh: m.total_kwh,
                  totalKwhPositive: m.total_kwh_positive,
                  totalKwhNegative: m.total_kwh_negative,
                  readingsCount: m.readings_count,
                  columnTotals: m.column_totals || undefined,
                  columnMaxValues: m.column_max_values || undefined,
                  hasData: m.readings_count > 0,
                  hasError: m.has_error,
                  errorMessage: m.error_message || undefined,
                  tariffName: m.tariff_name || undefined,
                  energyCost: m.energy_cost,
                  fixedCharges: m.fixed_charges,
                  totalCost: m.total_cost,
                  avgCostPerKwh: m.avg_cost_per_kwh,
                  costCalculationError: m.cost_calculation_error || undefined,
                }))}
                meterAssignments={new Map(
                  selectedRun.reconciliation_meter_results.map(m => [
                    m.meter_id,
                    m.assignment
                  ])
                )}
                revenueData={selectedRun.revenue_enabled ? {
                  meterRevenues: new Map(
                    selectedRun.reconciliation_meter_results.map(m => [
                      m.meter_id,
                      {
                        energyCost: m.energy_cost,
                        fixedCharges: m.fixed_charges,
                        totalCost: m.total_cost,
                        avgCostPerKwh: m.avg_cost_per_kwh,
                        tariffName: m.tariff_name || 'Unknown',
                        hasError: !!m.cost_calculation_error,
                        errorMessage: m.cost_calculation_error || undefined,
                      }
                    ])
                  ),
                  gridSupplyCost: selectedRun.grid_supply_cost,
                  solarCost: selectedRun.solar_cost,
                  tenantCost: selectedRun.tenant_cost,
                  totalRevenue: selectedRun.total_revenue,
                  avgCostPerKwh: selectedRun.avg_cost_per_kwh,
                } : null}
                showDownloadButtons={false}
                hasPreviewData={true}
                canReconcile={true}
              />

              {/* Notes Section */}
              {selectedRun.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{selectedRun.notes}</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => selectedRun && exportToCSV(selectedRun)}>
              <FileDown className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => selectedRun && exportToExcel(selectedRun)}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Generation Dialog */}
      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Audit Report</DialogTitle>
            <DialogDescription>
              {reportRun && `Using reconciliation: ${reportRun.run_name}`}
            </DialogDescription>
          </DialogHeader>
          
          {reportRun && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Grid Supply Card */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between border-b pb-3">
                        <div className="flex-1">
                          <div className="text-2xl font-bold">{reportRun.bulk_total.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div className="text-xs text-muted-foreground mt-1">kWh</div>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <Badge variant="outline">S/N</Badge>
                          <Badge variant="outline">P</Badge>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="font-semibold text-sm">Bulk Check</div>
                        <div className="text-xs text-muted-foreground">
                          <div>Type: {reportRun.reconciliation_meter_results.find(m => m.assignment === 'grid_supply')?.meter_type || 'Bulk Meter'}</div>
                          <div>Serial No: {reportRun.reconciliation_meter_results.find(m => m.assignment === 'grid_supply')?.meter_number || 'N/A'}</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Combined Supply Card */}
                <Card className="border-primary/50">
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between border-b pb-3">
                        <div className="flex-1">
                          <div className="text-2xl font-bold">{reportRun.total_supply.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div className="text-xs text-muted-foreground mt-1">kWh</div>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <Badge variant="outline">S/N</Badge>
                          <Badge variant="outline">P</Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="font-semibold text-sm">VIRTUAL - TOTAL INJECTION</div>
                        <div className="text-xs bg-muted p-2 rounded">
                          <div className="font-medium">OVER/UNDER</div>
                          <div className="text-lg font-bold mt-1">{reportRun.discrepancy.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh</div>
                          <div className="text-muted-foreground mt-1">% OF TOTAL</div>
                          <div className="font-semibold">{((Math.abs(reportRun.discrepancy) / reportRun.total_supply) * 100).toFixed(2)}%</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Solar Energy Card */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between border-b pb-3">
                        <div className="flex-1">
                          <div className="text-2xl font-bold">{reportRun.solar_total.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div className="text-xs text-muted-foreground mt-1">kWh</div>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <Badge variant="outline">S/N</Badge>
                          <Badge variant="outline">P</Badge>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="font-semibold text-sm">PV Tie In</div>
                        <div className="text-xs text-muted-foreground">
                          <div>Type: {reportRun.reconciliation_meter_results.find(m => m.assignment === 'solar_energy')?.meter_type || 'Solar Meter'}</div>
                          <div>Serial No: {reportRun.reconciliation_meter_results.find(m => m.assignment === 'solar_energy')?.meter_number || 'N/A'}</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Report Export Component */}
              <SiteReportExport 
                siteId={siteId}
                siteName={siteName}
                reconciliationRun={reportRun}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteRunId} onOpenChange={() => setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reconciliation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this reconciliation? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

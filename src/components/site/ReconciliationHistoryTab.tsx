import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileDown, Eye, Trash2, Download, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import ReconciliationResultsView from "./ReconciliationResultsView";
import SiteReportExport from "./SiteReportExport";

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
  reconciliation_meter_results: MeterResult[];
}

interface MeterResult {
  id: string;
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
    const csvData = run.reconciliation_meter_results.map(m => ({
      "Meter Number": m.meter_number,
      "Meter Name": m.meter_name || "",
      "Type": m.meter_type,
      "Assignment": m.assignment,
      "Location": m.location || "",
      "Total kWh": m.total_kwh.toFixed(2),
      "Positive kWh": m.total_kwh_positive.toFixed(2),
      "Negative kWh": m.total_kwh_negative.toFixed(2),
      "Readings Count": m.readings_count,
    }));

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

    // Summary sheet
    const summaryData = [
      ["Reconciliation Summary"],
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
      summaryData.push([], ["Notes", run.notes]);
    }

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    // Meter details sheet
    const meterData = run.reconciliation_meter_results.map(m => ({
      "Meter Number": m.meter_number,
      "Meter Name": m.meter_name || "",
      "Type": m.meter_type,
      "Assignment": m.assignment,
      "Location": m.location || "",
      "Total kWh": m.total_kwh.toFixed(2),
      "Positive kWh": m.total_kwh_positive.toFixed(2),
      "Negative kWh": m.total_kwh_negative.toFixed(2),
      "Readings Count": m.readings_count,
    }));

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
                  id: m.id,
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
                }))}
                showDownloadButtons={false}
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Audit Report</DialogTitle>
            <DialogDescription>
              {reportRun && `Using reconciliation: ${reportRun.run_name}`}
            </DialogDescription>
          </DialogHeader>
          
          {reportRun && (
            <SiteReportExport 
              siteId={siteId}
              siteName={siteName}
              reconciliationRun={reportRun}
            />
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

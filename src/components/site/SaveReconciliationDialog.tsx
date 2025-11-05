import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

interface SaveReconciliationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (runName: string, notes: string) => Promise<string | void>;
  dateFrom?: Date;
  dateTo?: Date;
  reconciliationData: any;
}

export default function SaveReconciliationDialog({
  open,
  onOpenChange,
  onSave,
  dateFrom,
  dateTo,
  reconciliationData,
}: SaveReconciliationDialogProps) {
  const defaultName = dateFrom && dateTo 
    ? `Reconciliation - ${format(dateFrom, "dd MMM yyyy")} to ${format(dateTo, "dd MMM yyyy")}`
    : "Reconciliation";
  const [runName, setRunName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Update default name when dates change or dialog opens
  useEffect(() => {
    if (open && dateFrom && dateTo) {
      setRunName(`Reconciliation - ${format(dateFrom, "dd MMM yyyy")} to ${format(dateTo, "dd MMM yyyy")}`);
    }
  }, [open, dateFrom, dateTo]);

  const handleSave = async () => {
    if (!runName.trim()) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave(runName, notes);
      onOpenChange(false);
      setRunName(defaultName);
      setNotes("");
    } catch (error) {
      console.error("Failed to save:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Save Reconciliation Results</DialogTitle>
          <DialogDescription>
            Save this reconciliation run for future reference and comparison
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="run-name">Run Name</Label>
            <Input
              id="run-name"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Enter a name for this reconciliation"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this reconciliation"
              rows={3}
            />
          </div>

          {reconciliationData && (
            <div className="rounded-lg border p-4 space-y-3 bg-muted/50">
              <p className="text-sm font-medium">Energy Summary</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Grid Supply:</span>
                  <span className="ml-2 font-mono">{reconciliationData.bulkTotal.toFixed(2)} kWh</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Solar:</span>
                  <span className="ml-2 font-mono">{reconciliationData.solarTotal.toFixed(2)} kWh</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Recovery Rate:</span>
                  <span className="ml-2 font-mono">{reconciliationData.recoveryRate.toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Discrepancy:</span>
                  <span className="ml-2 font-mono">{reconciliationData.discrepancy.toFixed(2)} kWh</span>
                </div>
              </div>
              
              {reconciliationData.revenueData && (
                <>
                  <div className="border-t pt-2 mt-2">
                    <p className="text-sm font-medium">Revenue Summary</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Grid Supply Cost:</span>
                      <span className="ml-2 font-mono text-warning">R {reconciliationData.revenueData.gridSupplyCost.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Solar Cost:</span>
                      <span className="ml-2 font-mono">R {reconciliationData.revenueData.solarCost.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Revenue:</span>
                      <span className="ml-2 font-mono text-primary">R {reconciliationData.revenueData.totalRevenue.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Avg Cost/kWh:</span>
                      <span className="ml-2 font-mono">R {reconciliationData.revenueData.avgCostPerKwh.toFixed(4)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!runName.trim() || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

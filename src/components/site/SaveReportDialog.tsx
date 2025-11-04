import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface SaveReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (fileName: string) => Promise<void>;
  defaultFileName: string;
}

export default function SaveReportDialog({ open, onOpenChange, onSave, defaultFileName }: SaveReportDialogProps) {
  const [fileName, setFileName] = useState(defaultFileName);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!fileName.trim()) return;

    setIsSaving(true);
    try {
      await onSave(fileName.trim());
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Report</DialogTitle>
          <DialogDescription>
            Enter a name for your report. The file will be saved with a .pdf extension.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="fileName">Report Name</Label>
            <Input
              id="fileName"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Enter report name"
              disabled={isSaving}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isSaving) {
                  handleSave();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !fileName.trim()}>
            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

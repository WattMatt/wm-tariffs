import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database, Upload, Trash2 } from "lucide-react";
import Papa from "papaparse";

interface DatabaseManagementDialogProps {
  siteId: string;
}

export default function DatabaseManagementDialog({ siteId }: DatabaseManagementDialogProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  const handleClearDatabase = async () => {
    setIsClearing(true);
    try {
      // Get all meters for this site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id")
        .eq("site_id", siteId);

      if (metersError) throw metersError;

      if (!meters || meters.length === 0) {
        toast.info("No meters found for this site");
        setShowClearConfirm(false);
        setIsClearing(false);
        return;
      }

      const meterIds = meters.map((m) => m.id);

      // Delete all readings for these meters
      const { error: deleteError } = await supabase
        .from("meter_readings")
        .delete()
        .in("meter_id", meterIds);

      if (deleteError) throw deleteError;

      toast.success("Database cleared successfully");
      setShowClearConfirm(false);
    } catch (error) {
      console.error("Error clearing database:", error);
      toast.error("Failed to clear database");
    } finally {
      setIsClearing(false);
    }
  };

  const handleBulkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress("Fetching meters...");

    try {
      // Get all meters for this site with their serial numbers
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, serial_number, name")
        .eq("site_id", siteId);

      if (metersError) throw metersError;

      if (!meters || meters.length === 0) {
        toast.error("No meters found for this site");
        setIsUploading(false);
        return;
      }

      let totalReadingsInserted = 0;
      const filesArray = Array.from(files);

      for (let fileIndex = 0; fileIndex < filesArray.length; fileIndex++) {
        const file = filesArray[fileIndex];
        setUploadProgress(`Processing file ${fileIndex + 1}/${filesArray.length}: ${file.name}`);

        // Try to match file name to meter serial number (with flexible matching)
        const fileName = file.name.replace(/\.csv$/i, "");
        
        // Extract potential meter number (numbers only)
        const numberMatch = fileName.match(/\d+/);
        const fileNumber = numberMatch ? numberMatch[0] : null;
        
        const matchedMeter = meters.find((m) => {
          const serialLower = m.serial_number?.toLowerCase() || "";
          const meterNumLower = m.meter_number?.toLowerCase() || "";
          const nameLower = m.name?.toLowerCase() || "";
          const fileNameLower = fileName.toLowerCase();
          
          // Exact matches
          if (serialLower === fileNameLower || meterNumLower === fileNameLower || nameLower === fileNameLower) {
            return true;
          }
          
          // Number-based matching
          if (fileNumber) {
            if (serialLower === fileNumber || meterNumLower === fileNumber || nameLower === fileNumber) {
              return true;
            }
            // Check if meter identifiers contain the number
            if (serialLower.includes(fileNumber) || meterNumLower.includes(fileNumber) || nameLower.includes(fileNumber)) {
              return true;
            }
          }
          
          // Partial match (filename contains meter identifier)
          if (fileNameLower.includes(serialLower) || fileNameLower.includes(meterNumLower) || fileNameLower.includes(nameLower)) {
            return true;
          }
          
          return false;
        });

        if (!matchedMeter) {
          toast.warning(`No meter match found for file: ${file.name}`);
          continue;
        }

        // Parse CSV
        const csvText = await file.text();
        const parsed = Papa.parse(csvText, {
          header: false,
          skipEmptyLines: true,
          dynamicTyping: false,
        });

        const rows = parsed.data as string[][];

        // Process rows
        const readings: any[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 3) continue;

          try {
            // Assuming format: Date, Time, Value
            const dateStr = row[0]?.trim();
            const timeStr = row[1]?.trim();
            const valueStr = row[2]?.trim()?.replace(",", ".");

            if (!dateStr || !timeStr || !valueStr) continue;

            // Parse date and time
            const timestamp = `${dateStr} ${timeStr}`;
            const date = new Date(timestamp);

            if (isNaN(date.getTime())) continue;

            const value = parseFloat(valueStr);
            if (isNaN(value)) continue;

            readings.push({
              meter_id: matchedMeter.id,
              reading_timestamp: date.toISOString(),
              kwh_value: value,
              uploaded_by: (await supabase.auth.getUser()).data.user?.id,
            });
          } catch (err) {
            console.error(`Error parsing row ${i} in ${file.name}:`, err);
          }
        }

        if (readings.length === 0) {
          toast.warning(`No valid readings found in ${file.name}`);
          continue;
        }

        // Insert in batches
        const batchSize = 1000;
        for (let i = 0; i < readings.length; i += batchSize) {
          const batch = readings.slice(i, i + batchSize);
          setUploadProgress(
            `Inserting readings ${i + 1}-${Math.min(i + batchSize, readings.length)}/${readings.length} for ${
              matchedMeter.meter_number
            }`
          );

          const { error: insertError } = await supabase.from("meter_readings").insert(batch);

          if (insertError) {
            console.error("Insert error:", insertError);
            throw insertError;
          }
        }

        totalReadingsInserted += readings.length;
        toast.success(`Imported ${readings.length} readings for meter ${matchedMeter.meter_number}`);
      }

      toast.success(`Bulk upload complete! Total readings imported: ${totalReadingsInserted}`);
      event.target.value = "";
    } catch (error) {
      console.error("Bulk upload error:", error);
      toast.error("Failed to complete bulk upload");
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }
  };

  return (
    <>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Database className="w-4 h-4" />
            Database Management
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Database Management</DialogTitle>
            <DialogDescription>Manage meter readings data for this site</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <h3 className="font-semibold flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Bulk Upload CSV Files
              </h3>
              <p className="text-sm text-muted-foreground">
                Upload multiple CSV files. File names should match meter serial numbers, meter numbers, or meter names.
                CSV format: Date, Time, Value
              </p>
              <input
                type="file"
                accept=".csv"
                multiple
                onChange={handleBulkUpload}
                disabled={isUploading}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              {isUploading && <p className="text-sm text-muted-foreground animate-pulse">{uploadProgress}</p>}
            </div>

            <div className="border-t pt-4 space-y-2">
              <h3 className="font-semibold flex items-center gap-2 text-destructive">
                <Trash2 className="w-4 h-4" />
                Clear All Readings
              </h3>
              <p className="text-sm text-muted-foreground">
                Delete all meter readings for this site. This action cannot be undone.
              </p>
              <Button
                variant="destructive"
                onClick={() => setShowClearConfirm(true)}
                disabled={isClearing || isUploading}
                className="w-full"
              >
                Clear Database
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all meter readings for this site. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearDatabase} disabled={isClearing} className="bg-destructive">
              {isClearing ? "Clearing..." : "Yes, clear database"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
